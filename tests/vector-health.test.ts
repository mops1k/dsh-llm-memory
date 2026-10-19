/**
 * Vector-side heal: the vector table is derived data, so it can drift from the
 * pages (leftovers of removed entries, stale metadata copies, gaps, foreign
 * models, damaged vectors). `heal` compares the two sides, repairs what is cheap
 * and hands the re-embedding to the background queue — these tests build every
 * kind of drift by hand and check both the report and the table afterwards.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { MemoryEngine } from '@llm-memory/core/application/engine'
import { FakeEmbeddingProvider } from './helpers/fake-embeddings'

const roots: string[] = []
const MODEL = 'fake-vocab-3'

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'llm-memory-heal-'))
  roots.push(root)
  return root
}

function dbPath(root: string): string {
  return join(root, '_db', 'memory.db')
}

/** Engine with the fake provider (its model id is stable) and two vectors of room. */
function makeEngine(): { engine: MemoryEngine; provider: FakeEmbeddingProvider; root: string } {
  const root = makeRoot()
  const provider = new FakeEmbeddingProvider()
  const engine = new MemoryEngine({
    storageRoot: root,
    project: 'demo',
    embeddingProvider: provider,
    config: { embeddings: { provider: 'local', chunkChars: 200, chunkOverlap: 0 } },
  })
  return { engine, provider, root }
}

/** Writes a vector row straight into the table, bypassing the queue. */
function insertRow(
  root: string,
  row: {
    entryId: string
    chunkIndex?: number
    model?: string
    status?: string
    vector: number[]
    dim?: number
  },
): void {
  const db = new DatabaseSync(dbPath(root))
  try {
    const vector = Float32Array.from(row.vector)
    const dim = row.dim ?? vector.length
    db.prepare(
      `INSERT OR REPLACE INTO memory_vectors
         (entry_id, chunk_ix, model, dim, hash, scope, project, kind, tier, status, vector, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      row.entryId,
      row.chunkIndex ?? 0,
      row.model ?? MODEL,
      dim,
      `hash-${row.entryId}-${row.chunkIndex ?? 0}`,
      'project',
      'demo',
      'facts',
      'normal',
      row.status ?? 'active',
      new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength),
      new Date().toISOString(),
    )
  } finally {
    db.close()
  }
}

function storedStatus(root: string, entryId: string): string | null {
  const db = new DatabaseSync(dbPath(root), { readOnly: true })
  try {
    const rows = db.prepare('SELECT status FROM memory_vectors WHERE entry_id = ?').all(entryId) as Array<
      Record<string, unknown>
    >
    return rows.length > 0 ? String(rows[0]!['status']) : null
  } finally {
    db.close()
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('vector health', () => {
  it('reports a healthy store as clean and repairs nothing', async () => {
    const { engine } = makeEngine()
    engine.save({ title: 'Здоровая запись', text: 'Текст про индексацию и fingerprint.' })
    await engine.embedPending()

    const health = engine.vectorHealth()
    expect(health).not.toBeNull()
    expect(health!.checked).toBe(1)
    expect(health!.orphans).toEqual([])
    expect(health!.metadataStale).toEqual([])
    expect(health!.missing).toEqual([])
    expect(health!.partial).toEqual([])
    expect(health!.foreign).toEqual([])
    expect(health!.badDim).toEqual([])
    expect(health!.broken).toEqual([])

    const report = engine.repairVectors()
    expect(report).toMatchObject({ checked: 1, orphansRemoved: 0, metadataFixed: 0, badRemoved: 0, queued: 0 })
  })

  it('finds a stale metadata copy and rewrites it without embedding again', async () => {
    const { engine, provider, root } = makeEngine()
    const saved = engine.save({ title: 'Метаданные', text: 'Текст про статус записи и слой памяти.' })
    await engine.embedPending()
    // Simulate a row written before the queue learned to refresh the copy.
    insertRow(root, { entryId: saved.id, status: 'archived', vector: [1, 0, 0] })
    const before = provider.embeddedCount

    const health = engine.vectorHealth()
    expect(health!.metadataStale).toContain(saved.id)
    const report = engine.repairVectors()
    expect(report.metadataFixed).toBe(1)
    expect(storedStatus(root, saved.id)).toBe('active')
    expect(provider.embeddedCount).toBe(before)
  })

  it('removes leftover rows of a page that is gone', async () => {
    const { engine, root } = makeEngine()
    // Embed one page first so the table exists, then leave a row without a page.
    engine.save({ title: 'Живая запись', text: 'Текст про живое хранилище и fingerprint.' })
    await engine.embedPending()
    insertRow(root, { entryId: 'm_ghost000000', vector: [1, 0, 0] })

    const health = engine.vectorHealth()
    expect(health!.orphans).toEqual(['m_ghost000000'])
    expect(engine.repairVectors().orphansRemoved).toBe(1)
    expect(engine.vectorHealth()!.orphans).toEqual([])
  })

  it('queues pages without vectors and pages with a partial chunk set', async () => {
    const { engine, root } = makeEngine()
    const partial = engine.save({ title: 'Частичная', text: 'Запись с лишним чанком в таблице.' })
    await engine.embedPending()
    insertRow(root, { entryId: partial.id, chunkIndex: 7, vector: [0, 1, 0] })
    // Saved and never embedded: no await follows before the check, so the
    // background queue cannot race the assertion.
    const never = engine.save({ title: 'Без векторов', text: 'Запись, которую не индексировали.' })

    const health = engine.vectorHealth()
    expect(health!.missing).toContain(never.id)
    expect(health!.partial).toContain(partial.id)

    const report = engine.repairVectors()
    expect(report.queued).toBeGreaterThanOrEqual(2)
    await engine.embedPending()
    const after = engine.vectorHealth()
    expect(after!.missing).toEqual([])
    expect(after!.partial).toEqual([])
  })

  it('drops foreign-model rows and the pages behind them go back to the queue', async () => {
    const { engine, root } = makeEngine()
    const saved = engine.save({ title: 'Другая модель', text: 'Текст про чужую модель и эмбеддинги.' })
    await engine.embedPending()
    insertRow(root, { entryId: saved.id, model: 'other-model', vector: [1, 0, 0], dim: 3 })

    const health = engine.vectorHealth()
    expect(health!.foreign).toContain(saved.id)
    const report = engine.repairVectors()
    expect(report.foreignRemoved).toBe(1)

    await engine.embedPending()
    const after = engine.vectorHealth()
    expect(after!.foreign).toEqual([])
    // The entry is indexed again under the current model.
    expect(storedStatus(root, saved.id)).toBe('active')
  })

  it('drops wrong-length and zero vectors', async () => {
    const { engine, root } = makeEngine()
    const bad = engine.save({ title: 'Битая длина', text: 'Текст про длину вектора.' })
    const zero = engine.save({ title: 'Нулевой вектор', text: 'Текст про нулевой вектор.' })
    await engine.embedPending()
    insertRow(root, { entryId: bad.id, vector: [1, 2] })
    insertRow(root, { entryId: zero.id, vector: [0, 0, 0] })

    const health = engine.vectorHealth()
    expect(health!.badDim).toContain(bad.id)
    expect(health!.broken).toContain(zero.id)

    const report = engine.repairVectors()
    expect(report.badRemoved).toBe(2)
    expect(report.queued).toBeGreaterThanOrEqual(2)
    // The damaged rows are gone at once; the queue writes fresh ones later.
    expect(storedStatus(root, bad.id)).toBe(null)
    expect(storedStatus(root, zero.id)).toBe(null)
  })

  it('sweeps leftover download files and reports the ANN rebuild as a no-op', async () => {
    const { engine, root } = makeEngine()
    engine.save({ title: 'Мусор', text: 'Текст про временные файлы модели.' })
    await engine.embedPending()
    const onnxDir = join(root, '_models', 'fake-vocab-3', 'onnx')
    mkdirSync(onnxDir, { recursive: true })
    writeFileSync(join(onnxDir, 'model_quantized.onnx.tmp.123.abc'), 'x'.repeat(16))

    expect(engine.repairVectors().tempFilesSwept).toBe(1)
    // The in-process scan reads the table itself, so there is no ANN to rebuild.
    expect(engine.rebuildAnnIndex()).toBe(false)
  })

  it('carries the vector block inside the heal report', async () => {
    const { engine, root } = makeEngine()
    engine.save({ title: 'Отчёт', text: 'Текст про отчёт heal и ссылки.' })
    await engine.embedPending()
    insertRow(root, { entryId: 'm_ghost111111', vector: [1, 0, 0] })

    const report = engine.heal()
    expect(report.vectors.orphansRemoved).toBe(1)
    expect(report.vectors.checked).toBeGreaterThan(0)
    // The link side of the report still works as before.
    expect(typeof report.removedLinks).toBe('number')
  })
})
