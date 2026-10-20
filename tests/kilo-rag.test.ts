/**
 * RAG in Kilo: the shared VectorLeg on the Kilo store.
 *
 * Covers the contract the panel and recall depend on — a semantic leg next to
 * the lexical one, the map, health and rebuild — without the real model: a
 * deterministic fake provider maps word groups to dimensions.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { resolveKiloConfig } from '@llm-memory/adapter/kilo/config'
import { KiloService } from '@llm-memory/adapter/kilo/service'
import { startKiloWebServer, type KiloWebHandle } from '@llm-memory/adapter/kilo/web-server'
import type { EmbeddingBatch, EmbeddingProvider, EmbeddingRole } from '@llm-memory/core/domain/types'

/** Word groups: a text gets 1 in dimension i when it contains a word of group i. */
const VOCABULARY: string[][] = [
  ['индекс', 'инкремент', 'fingerprint', 'reconcile'],
  ['язык', 'русск', 'language', 'локализац'],
  ['план', 'согласован', 'approval'],
]

class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly id = 'fake'
  readonly model = 'fake-vocab-3'
  readonly dim = VOCABULARY.length
  readonly ready = true
  embeddedCount = 0

  async prewarm(): Promise<void> {}

  async embed(texts: string[], _role: EmbeddingRole): Promise<EmbeddingBatch> {
    this.embeddedCount += texts.length
    const vectors = texts.map((text) => {
      const lower = text.toLowerCase()
      const values = VOCABULARY.map((group) => (group.some((word) => lower.includes(word)) ? 1 : 0))
      const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0)) || 1
      return Float32Array.from(values.map((value) => value / norm))
    })
    return { vectors, model: this.model, dim: this.dim }
  }
}

const dirs: string[] = []
let handle: KiloWebHandle | null = null
let service: KiloService | null = null

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'kilo-rag-'))
  dirs.push(root)
  return root
}

function makeService(options: { vector?: boolean; provider?: EmbeddingProvider } = {}): KiloService {
  const vector = options.vector !== false
  const config = resolveKiloConfig({
    memory: { storageRoot: makeRoot() },
    web: { enabled: false },
    embeddings: vector
      ? { provider: 'local', model: 'fake-vocab-3', dim: VOCABULARY.length, topK: 50, minScore: 0 }
      : { provider: 'off' },
  })
  const created = new KiloService({
    config,
    ...(options.provider ? { embeddingProvider: options.provider } : {}),
    ...(options.provider ? { manualEmbeddings: true } : {}),
  })
  created.init()
  service = created
  return created
}

afterEach(async () => {
  await handle?.close()
  handle = null
  service?.close()
  service = null
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('Kilo RAG', () => {
  it('adds a semantic leg to recall and reports it in the provenance', async () => {
    const provider = new FakeEmbeddingProvider()
    const created = makeService({ provider })
    const localized = created.save({ text: 'Русский язык интерфейса: подписи и подсказки переведены.' })
    created.save({ text: 'Fingerprint и reconcile инкрементального индекса.' })
    await created.embedPending()
    expect(created.vectorStatus()?.entries).toBe(2)

    // "language" shares no token with the Russian text: only the vector leg can
    // connect them, so this proves the semantic leg is wired into recall.
    const result = await created.recall('language')
    expect(result.items[0]?.id).toBe(localized.id)
    expect(result.sources?.get(localized.id)).toContain('vector')
    expect(provider.embeddedCount).toBeGreaterThan(0)
  })

  it('keeps lexical recall working when vectors are off', async () => {
    const created = makeService({ vector: false })
    const saved = created.save({ text: 'Инкрементальный индекс и fingerprint.' })
    expect(created.vectorStatus()).toBeNull()
    const result = await created.recall('fingerprint')
    expect(result.items.map(item => item.id)).toContain(saved.id)
  })

  it('exposes the semantic map, health and rebuild', async () => {
    const created = makeService({ provider: new FakeEmbeddingProvider() })
    created.save({ text: 'Индекс и reconcile.' })
    created.save({ text: 'План и согласование.' })
    await created.embedPending()

    const map = created.vectorsMap()
    expect(map?.points).toHaveLength(2)
    expect(map?.entries).toBe(2)
    expect(created.vectorHealth()?.missing).toEqual([])

    const pending = created.save({ text: 'Язык и локализация.' })
    expect(created.vectorHealth()?.missing).toContain(pending.id)

    created.rebuildVectors()
    expect(created.vectorStatus()?.entries).toBe(0)
    await created.embedPending()
    expect(created.vectorStatus()?.entries).toBe(3)
  })

  it('reports the model as enabled and the settings as configured', async () => {
    const created = makeService({ provider: new FakeEmbeddingProvider() })
    const status = created.modelStatus()
    expect(status.configured).toBe(true)
    expect(status.enabled).toBe(true)
    expect(status.model).toBe('fake-vocab-3')
  })

  it('serves vectors.health, vectors.map and vectors.rebuild over the panel API', async () => {
    const created = makeService({ provider: new FakeEmbeddingProvider() })
    created.save({ text: 'Индекс и reconcile.' })
    await created.embedPending()
    handle = await startKiloWebServer({
      service: created,
      config: resolveKiloConfig({ memory: { storageRoot: created.store.root }, web: { enabled: true } }),
      port: 0,
    })
    const base = handle.url as string

    const health = await (await fetch(`${base}api/legacy/vectors/health`)).json()
    expect(health.ok).toBe(true)
    expect(health.health.missing).toEqual([])

    const map = await (await fetch(`${base}api/legacy/vectors/map`)).json()
    expect(map.ok).toBe(true)
    expect(map.map.points.length).toBe(1)

    const rebuilt = await (await fetch(`${base}api/legacy/vectors/rebuild`, { method: 'POST' })).json()
    expect(rebuilt.ok).toBe(true)
    expect(rebuilt.status.entries).toBe(0)
  })
})
