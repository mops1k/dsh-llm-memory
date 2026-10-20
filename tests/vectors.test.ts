/**
 * Vector plumbing without the model: a deterministic fake provider maps words
 * to dimensions, so these tests prove that the index, the queue and the rank
 * fusion work — and that the semantic leg finds what FTS5 cannot.
 *
 * The real model is exercised by `tests/embeddings-e2e.test.ts`, enabled
 * explicitly with `DSH_LLM_MEMORY_E2E_EMBEDDINGS=1`.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { cleanupRoot, trackResource } from './helpers'

import { EmbeddingQueue } from '@llm-memory/core/infrastructure/embed-queue'
import { MemoryEngine } from '@llm-memory/core/application/engine'
import { MemoryStore, newMemoryEntry } from '@llm-memory/core/infrastructure/store'
import type { EmbeddingBatch, EmbeddingProvider, EmbeddingRole, VectorRecord } from '@llm-memory/core/domain/types'

/** Word groups: a text gets 1 in dimension i when it contains a word of group i. */
const VOCABULARY: string[][] = [
  ['индекс', 'инкремент', 'переиндексац', 'fingerprint', 'reconcile'],
  ['язык', 'русск', 'language'],
  ['план', 'approval', 'согласован'],
]

/** Deterministic provider over a fixed vocabulary, normalized like the real one. */
class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly id = 'fake'
  readonly model = 'fake-vocab-3'
  readonly dim = VOCABULARY.length
  readonly ready = true
  embeddedCount = 0
  lastTexts: string[] = []

  async prewarm(): Promise<void> {}

  async embed(texts: string[], _role: EmbeddingRole): Promise<EmbeddingBatch> {
    this.embeddedCount += texts.length
    this.lastTexts = [...texts]
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
  const root = mkdtempSync(join(tmpdir(), 'llm-memory-vectors-'))
  roots.push(root)
  return root
}

/** Embedding config used by these tests, with vectors enabled. */
function embeddingsConfig() {
  return {
    provider: 'local' as const,
    model: 'fake-vocab-3',
    dim: VOCABULARY.length,
    queryPrefix: 'query: ',
    passagePrefix: 'passage: ',
    batchSize: 16,
    topK: 50,
    minScore: 0,
    chunkChars: 400,
    chunkOverlap: 60,
    backend: 'js' as const,
    prewarm: false,
  }
}

function makeEngine(options: { provider?: EmbeddingProvider } = {}): MemoryEngine {
  return trackResource(new MemoryEngine({
    storageRoot: makeRoot(),
    project: 'demo',
    manualEmbeddings: true,
    ...(options.provider ? { embeddingProvider: options.provider } : {}),
    config: { embeddings: { chunkChars: 400, chunkOverlap: 60 } },
  }))
}

function record(entryId: string, vector: number[], overrides: Partial<VectorRecord> = {}): VectorRecord {
  return {
    entryId,
    chunkIndex: 0,
    scope: 'project',
    project: 'demo',
    kind: 'facts',
    tier: 'normal',
    status: 'active',
    hash: `h-${entryId}`,
    vector: Float32Array.from(vector),
    ...overrides,
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) cleanupRoot(root)
})

describe('JsVectorIndex', () => {
  it('indexes chunks and searches by cosine with filters', () => {
    const store = trackResource(new MemoryStore({ storageRoot: makeRoot() }))
    const index = store.initVectorIndex({ model: 'test-model', dim: 2, backend: 'js' })
    expect(index).not.toBeNull()
    index!.upsert([
      record('a', [1, 0]),
      record('b', [0, 1], { kind: 'rules', tier: 'immutable' }),
      record('b', [0.6, 0.8], { chunkIndex: 1 }),
    ])
    expect(index!.size()).toBe(3)

    const nearest = index!.search({ vector: Float32Array.from([0.9, 0.1]), limit: 5 })
    expect(nearest.map((match) => match.entryId)).toEqual(['a', 'b', 'b'])
    expect(nearest[0]!.score).toBeCloseTo(0.9, 5)
    expect(nearest[0]!.chunkIndex).toBe(0)

    // Metadata filters are translated into SQL predicates over the vector rows.
    expect(index!.search({ vector: Float32Array.from([0.9, 0.1]), limit: 5, filter: { kind: 'rules' } })[0]!.entryId).toBe('b')
    expect(index!.search({ vector: Float32Array.from([0.9, 0.1]), limit: 5, filter: { tier: 'immutable' } })[0]!.entryId).toBe('b')
    expect(index!.search({ vector: Float32Array.from([0.9, 0.1]), limit: 5, filter: { scope: 'user' } })).toEqual([])
    // `entryIds` restricts the scan to the given entries.
    expect(index!.search({ vector: Float32Array.from([0.9, 0.1]), limit: 5, entryIds: ['b'] })).toHaveLength(2)
    expect(index!.search({ vector: Float32Array.from([0.9, 0.1]), limit: 5, entryIds: [] })).toEqual([])
    // `minScore` drops weak hits and `limit` bounds the result.
    expect(index!.search({ vector: Float32Array.from([0.9, 0.1]), limit: 5, minScore: 0.95 })).toEqual([])
    expect(index!.search({ vector: Float32Array.from([0.9, 0.1]), limit: 1 })).toHaveLength(1)

    expect(index!.storedHashes('b')).toEqual(new Map([[0, 'h-b'], [1, 'h-b']]))
    expect(index!.stats()).toMatchObject({ backend: 'js', chunks: 3, entries: 2, model: 'test-model', dim: 2 })
    expect(index!.stats().bytes).toBe(24)

    index!.remove('a')
    expect(index!.size()).toBe(2)
    index!.clear('test-model')
    expect(index!.size()).toBe(2)
    index!.clear()
    expect(index!.size()).toBe(0)
    store.close()
  })

  it('keeps vectors of different models apart', () => {
    const store = trackResource(new MemoryStore({ storageRoot: makeRoot() }))
    const first = store.initVectorIndex({ model: 'model-one', dim: 2, backend: 'js' })!
    first.upsert([record('a', [1, 0])])
    const second = store.initVectorIndex({ model: 'model-two', dim: 2, backend: 'js' })!
    expect(second.size()).toBe(0)
    expect(second.search({ vector: Float32Array.from([1, 0]), limit: 5 })).toEqual([])

    // `clear(model)` drops the vectors of other models and keeps the given one.
    second.upsert([record('b', [0, 1])])
    expect(second.size()).toBe(1)
    second.clear('model-two')
    expect(second.size()).toBe(1)
    expect(first.size()).toBe(0)
    store.close()
  })

  it('rejects vectors of the wrong length', () => {
    const store = trackResource(new MemoryStore({ storageRoot: makeRoot() }))
    const index = store.initVectorIndex({ model: 'test-model', dim: 2, backend: 'js' })!
    expect(() => index.upsert([record('a', [1, 0, 0])])).toThrow(/dimensions/)
    expect(index.size()).toBe(0)
    store.close()
  })

  it('is disabled for the off backend', () => {
    const store = trackResource(new MemoryStore({ storageRoot: makeRoot() }))
    expect(store.initVectorIndex({ model: 'test-model', dim: 2, backend: 'off' })).toBeNull()
    store.close()
  })
})

describe('EmbeddingQueue', () => {
  it('embeds entries, skips unchanged ones and re-embeds edits', async () => {
    const provider = new FakeEmbeddingProvider()
    const engine = makeEngine({ provider })
    const saved = engine.save({
      title: 'Инкрементальный индекс',
      text: 'Fingerprint size+mtime и reconcile вместо полного reindex.',
    })

    await engine.embedPending()
    const first = engine.vectorStatus()
    expect(first?.chunks).toBeGreaterThan(0)
    expect(first?.entries).toBe(1)
    const afterFirst = provider.embeddedCount
    expect(afterFirst).toBeGreaterThan(0)
    expect(provider.lastTexts[0]!.startsWith('Инкрементальный индекс\n')).toBe(true)

    // A second pass over unchanged entries embeds nothing.
    await engine.embedPending()
    expect(provider.embeddedCount).toBe(afterFirst)

    // An edit invalidates the chunk hashes of that entry only.
    engine.update(saved.id, { text: 'Fingerprint size+mtime, reconcile и heal подробнее.' })
    await engine.embedPending()
    expect(provider.embeddedCount).toBeGreaterThan(afterFirst)
  })

  it('drops the vectors of a deleted entry', async () => {
    const provider = new FakeEmbeddingProvider()
    const engine = makeEngine({ provider })
    const saved = engine.save({ title: 'Запись', text: 'Текст про план и согласование.' })
    await engine.embedPending()
    expect(engine.vectorStatus()?.entries).toBe(1)

    engine.delete(saved.id)
    expect(engine.vectorStatus()?.entries).toBe(0)
    expect(engine.vectorStatus()?.chunks).toBe(0)
  })

  it('survives a failing provider and reports the error', async () => {
    const failing: EmbeddingProvider = {
      id: 'failing',
      model: 'failing-1',
      dim: VOCABULARY.length,
      ready: true,
      async prewarm() {},
      async embed() {
        throw new Error('model unavailable')
      },
    }
    const engine = makeEngine({ provider: failing })
    engine.save({ title: 'Запись', text: 'Текст записи про индексацию.' })
    await engine.embedPending()
    const status = engine.vectorStatus()
    expect(status?.lastError).toBe('model unavailable')
    expect(status?.entries).toBe(0)
  })

  it('is inert when no provider is configured', async () => {
    const engine = makeEngine()
    engine.save({ title: 'Запись', text: 'Текст записи.' })
    await engine.embedPending()
    expect(engine.vectorStatus()).toBeNull()
  })

  it('can be driven by hand over a store', async () => {
    const store = trackResource(new MemoryStore({ storageRoot: makeRoot() }))
    const index = store.initVectorIndex({ model: 'fake-vocab-3', dim: VOCABULARY.length, backend: 'js' })!
    const queue = new EmbeddingQueue({
      store,
      index,
      provider: new FakeEmbeddingProvider(),
      config: embeddingsConfig(),
      debug: () => {},
      manual: true,
    })
    store.upsert(
      newMemoryEntry({
        id: 'm_manual',
        scope: 'user',
        title: 'Запись про язык',
        text: 'Общение только на русском языке.',
      }),
    )
    await queue.processAll()
    expect(queue.status().entries).toBe(1)
    queue.stop()
    store.close()
  })
})

describe('semantic recall', () => {
  it('finds an entry that the lexical leg cannot match', async () => {
    const provider = new FakeEmbeddingProvider()
    const engine = makeEngine({ provider })
    const target = engine.save({
      title: 'Инкрементальный индекс',
      text: 'Fingerprint size+mtime, reconcileFromDisk вместо полного reindex.',
    })
    const decoy = engine.save({ title: 'Правило про язык', text: 'Общение только на русском языке.' })
    await engine.embedPending()

    // "переиндексация" shares no FTS token with the stored text, so only the
    // vector leg can put the target on top of the fused ranking.
    const result = await engine.recall('переиндексация')
    expect(result.items[0]?.id).toBe(target.id)
    expect(result.items.map((item) => item.id)).toContain(target.id)
    expect(result.items.map((item) => item.id)).toContain(decoy.id)

    // The same query matches nothing without the vector leg.
    const lexicalOnly = makeEngine()
    expect((await lexicalOnly.recall('переиндексация')).items).toEqual([])
  })

  it('keeps lexical recall working when vectors are off', async () => {
    const engine = makeEngine()
    engine.save({ title: 'Запись про индексацию', text: 'Fingerprint и reconcile.' })
    const result = await engine.recall('fingerprint')
    expect(result.items).toHaveLength(1)
  })
})
