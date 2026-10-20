/**
 * The vector table keeps a copy of the entry metadata so a backend can filter
 * without joining the pages. The chunk hash covers text and model only, so a
 * metadata-only change used to be skipped by the queue and the copy stayed
 * stale (16.10.2026). These tests pin both halves: the copy follows the entry,
 * and the embedding provider is *not* called again for a metadata-only change.
 */
import { mkdtempSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { cleanupRoot, trackResource } from './helpers'

import { MemoryEngine } from '@llm-memory/core/application/engine'
import { FakeEmbeddingProvider } from './helpers/fake-embeddings'

const roots: string[] = []

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'llm-memory-meta-'))
  roots.push(root)
  return root
}

/** Engine on a fake provider, so embedding calls can be counted. */
function makeEngine(): { engine: MemoryEngine; provider: FakeEmbeddingProvider; root: string } {
  const root = makeRoot()
  const provider = new FakeEmbeddingProvider()
  const engine = trackResource(new MemoryEngine({
    storageRoot: root,
    project: 'demo',
    embeddingProvider: provider,
    config: { embeddings: { provider: 'local', chunkChars: 200, chunkOverlap: 0 } },
  }))
  return { engine, provider, root }
}

/** Metadata copy stored next to the vectors, read straight from SQLite. */
function vectorMetadata(root: string, entryId: string): Array<Record<string, unknown>> {
  const db = new DatabaseSync(join(root, '_db', 'memory.db'), { readOnly: true })
  try {
    return db
      .prepare('SELECT chunk_ix, scope, project, kind, tier, status FROM memory_vectors WHERE entry_id = ? ORDER BY chunk_ix')
      .all(entryId) as Array<Record<string, unknown>>
  } finally {
    db.close()
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) cleanupRoot(root)
})

describe('vector metadata copy', () => {
  it('follows status, tier and kind changes without embedding again', async () => {
    const { engine, provider, root } = makeEngine()
    const saved = engine.save({ title: 'Проба метаданных', text: 'Текст про метаданные и очередь индексации.' })
    await engine.embedPending()

    const before = provider.embeddedCount
    expect(before).toBeGreaterThan(0)
    expect(vectorMetadata(root, saved.id)[0]).toMatchObject({ scope: 'project', kind: 'facts', tier: 'normal', status: 'active' })

    engine.update(saved.id, { status: 'superseded', tier: 'important', kind: 'decisions' })
    await engine.embedPending()

    const rows = vectorMetadata(root, saved.id)
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row).toMatchObject({ scope: 'project', kind: 'decisions', tier: 'important', status: 'superseded' })
    }
    // The text did not change, so the vectors are still valid: no second call.
    expect(provider.embeddedCount).toBe(before)
  })

  it('leaves a metadata-free entry alone and does not crash on missing rows', async () => {
    const { engine, provider, root } = makeEngine()
    const saved = engine.save({ title: 'Без векторов', text: 'Запись, которую ещё не индексировали.' })
    // No embedPending yet: the entry has no stored rows at all.
    engine.update(saved.id, { status: 'archived' })
    expect(vectorMetadata(root, saved.id)).toEqual([])

    await engine.embedPending()
    expect(provider.embeddedCount).toBeGreaterThan(0)
    expect(vectorMetadata(root, saved.id)[0]).toMatchObject({ status: 'archived' })
  })

  it('still re-embeds when the text changes', async () => {
    const { engine, provider, root } = makeEngine()
    const saved = engine.save({ title: 'Проба текста', text: 'Первый вариант текста про индексацию памяти.' })
    await engine.embedPending()
    const before = provider.embeddedCount

    engine.update(saved.id, { text: 'Совсем другой текст: теперь про fingerprint и reconcileFromDisk.' })
    await engine.embedPending()

    expect(provider.embeddedCount).toBeGreaterThan(before)
    expect(vectorMetadata(root, saved.id).length).toBeGreaterThan(0)
  })
})
