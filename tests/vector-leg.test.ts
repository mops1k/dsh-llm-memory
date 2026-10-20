/**
 * Vector leg: the reusable vector stack extracted from the engine — provider,
 * index, queue, semantic ranks, map and health — so every harness shares one
 * implementation instead of growing its own.
 *
 * A deterministic fake provider keeps the test model-free: it maps word groups
 * to dimensions, which is enough to prove the plumbing.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { VectorLeg } from '@llm-memory/core/application/vector-leg'
import { DEFAULT_EMBEDDINGS, type EmbeddingConfig } from '@llm-memory/core/domain/config'
import { MemoryStore, newMemoryEntry } from '@llm-memory/core/infrastructure/store'
import type { FetchLike } from '@llm-memory/core/infrastructure/model-download'
import type { EmbeddingBatch, EmbeddingProvider, EmbeddingRole } from '@llm-memory/core/domain/types'

/** Word groups: a text gets 1 in dimension i when it contains a word of group i. */
const VOCABULARY: string[][] = [
  ['индекс', 'инкремент', 'fingerprint', 'reconcile'],
  ['план', 'согласован', 'approval'],
  ['язык', 'русск', 'language'],
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

const roots: string[] = []

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'llm-memory-vector-leg-'))
  roots.push(root)
  return root
}

function settings(overrides: Partial<EmbeddingConfig> = {}): EmbeddingConfig {
  return {
    ...DEFAULT_EMBEDDINGS,
    provider: 'local',
    model: 'fake-vocab-3',
    dim: VOCABULARY.length,
    backend: 'js',
    prewarm: false,
    batchSize: 16,
    topK: 50,
    minScore: 0,
    chunkChars: 400,
    chunkOverlap: 60,
    ...overrides,
  }
}

function makeLeg(
  provider?: EmbeddingProvider,
  overrides: Partial<ConstructorParameters<typeof VectorLeg>[0]> = {},
): { store: MemoryStore; leg: VectorLeg; root: string } {
  const root = makeRoot()
  const store = new MemoryStore({ storageRoot: root })
  const leg = new VectorLeg({
    store,
    settings: settings(),
    cacheDir: join(root, '_models'),
    manual: true,
    ...(provider ? { injectedProvider: provider } : {}),
    ...overrides,
  })
  return { store, leg, root }
}

function saveEntry(store: MemoryStore, text: string, title?: string): string {
  const entry = store.upsert(newMemoryEntry({ project: 'demo', text, ...(title ? { title } : {}) }))
  return entry.id
}

async function waitFor(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('waitFor timed out')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

/** Minimal Hub stub: one listing call plus the files, no HEAD support needed. */
function fakeFetch(files: Record<string, string>): FetchLike {
  return async (input, init) => {
    if (input.endsWith('/api/models/org/model')) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        arrayBuffer: async () =>
          new TextEncoder().encode(JSON.stringify({ siblings: Object.keys(files).map(rfilename => ({ rfilename })) }))
            .buffer,
      }
    }
    if (init?.method === 'HEAD') {
      const name = input.split('/resolve/main/')[1] ?? ''
      const body = files[name]
      return {
        ok: body !== undefined,
        status: body === undefined ? 404 : 200,
        headers: { get: (header: string) => (header === 'content-length' && body !== undefined ? String(Buffer.byteLength(body)) : null) },
        arrayBuffer: async () => new ArrayBuffer(0),
      }
    }
    const name = input.split('/resolve/main/')[1] ?? ''
    const body = files[name]
    if (body === undefined) {
      return { ok: false, status: 404, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) }
    }
    const bytes = Buffer.from(body, 'utf8')
    return {
      ok: true,
      status: 200,
      headers: { get: (header: string) => (header === 'content-length' ? String(bytes.length) : null) },
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    }
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('VectorLeg', () => {
  it('builds lazily and reports the queue status', () => {
    const { store, leg } = makeLeg(new FakeEmbeddingProvider())
    expect(leg.enabled).toBe(false)

    leg.start()
    expect(leg.enabled).toBe(true)
    expect(leg.status()).toMatchObject({ model: 'fake-vocab-3', backend: 'js', chunks: 0, entries: 0 })
    store.close()
  })

  it('embeds pending entries and ranks a query semantically', async () => {
    const provider = new FakeEmbeddingProvider()
    const { store, leg } = makeLeg(provider)
    const indexEntry = saveEntry(store, 'Инкрементальный индекс: fingerprint и reconcile вместо полного reindex.')
    const planEntry = saveEntry(store, 'План и согласование шага.')

    await leg.embedPending()
    expect(leg.status()?.entries).toBe(2)

    const ranks = await leg.semanticRanks('индекс', { status: 'active' })
    expect(ranks.scores.get(indexEntry)).toBeGreaterThan(0)
    // An unrelated entry may still be listed with a zero score (minScore 0);
    // what matters is the order of the semantic ranks.
    expect(ranks.scores.get(indexEntry)!).toBeGreaterThan(ranks.scores.get(planEntry) ?? 0)
    expect(ranks.chunks.get(indexEntry)).toBe(0)
    store.close()
  })

  it('returns a map with cached coordinates and projects a query onto it', async () => {
    const { store, leg } = makeLeg(new FakeEmbeddingProvider())
    const indexEntry = saveEntry(store, 'Индекс и fingerprint.')
    const planEntry = saveEntry(store, 'План и согласование.')
    await leg.embedPending()

    const map = leg.map()
    expect(map?.points.map(point => point.id).sort()).toEqual([indexEntry, planEntry].sort())
    expect(map?.cached).toBe(false)
    expect(leg.map()?.cached).toBe(true)

    const query = await leg.projectQuery('план', 1)
    expect(query?.hits[0]?.id).toBe(planEntry)
    store.close()
  })

  it('rebuilds the index from scratch', async () => {
    const { store, leg } = makeLeg(new FakeEmbeddingProvider())
    saveEntry(store, 'Индекс.')
    saveEntry(store, 'План.')
    await leg.embedPending()
    expect(leg.status()?.entries).toBe(2)

    leg.rebuild()
    expect(leg.status()?.entries).toBe(0)

    await leg.embedPending()
    expect(leg.status()?.entries).toBe(2)
    store.close()
  })

  it('reports missing vectors and requeues them in repair', async () => {
    const { store, leg } = makeLeg(new FakeEmbeddingProvider())
    saveEntry(store, 'Индекс и reconcile.')
    await leg.embedPending()
    const extra = saveEntry(store, 'Язык и русский текст.')

    const health = leg.health()
    expect(health?.missing).toContain(extra)

    const report = leg.repair()
    expect(report.queued).toBeGreaterThanOrEqual(1)
    await leg.embedPending()
    expect(leg.health()?.missing).toEqual([])
    store.close()
  })

  it('refuses to download when the vector leg is off', () => {
    const { store, leg } = makeLeg(undefined, { settings: settings({ provider: 'off' }) })
    expect(leg.configured()).toBe(false)
    expect(() => leg.downloadModel()).toThrow(/disabled/)
    store.close()
  })

  it('downloads the weights without a runtime when the provider is unavailable', async () => {
    const { store, leg } = makeLeg(undefined, {
      settings: settings({ model: 'org/model' }),
      createProvider: () => null,
      fallbackDownload: true,
      fetchImpl: fakeFetch({ 'config.json': '{"model":"x"}', 'onnx/model.onnx': 'weights' }),
    })
    expect(leg.enabled).toBe(false)
    const started = leg.downloadModel()
    expect(started.downloading).toBe(true)

    await waitFor(() => !leg.modelStatus().downloading)
    const status = leg.modelStatus()
    expect(status.cached).toBe(true)
    expect(status.files).toBeGreaterThanOrEqual(2)
    expect(status.error).toBeNull()
    expect(leg.enabled).toBe(false)
    store.close()
  })
})
