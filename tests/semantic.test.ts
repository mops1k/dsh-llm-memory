/**
 * Semantic layer without a model: relative neighbour selection, the graph edges
 * it feeds, the duplicate report and the excerpt rendering of recall.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { cleanupRoot, trackResource } from './helpers'

import { MemoryEngine } from '@llm-memory/core/application/engine'
import { semanticPairs } from '@llm-memory/core/application/ranking'
import { FakeEmbeddingProvider, VOCABULARY } from './helpers/fake-embeddings'

const roots: string[] = []

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'llm-memory-semantic-'))
  roots.push(root)
  return root
}

function makeEngine(options: { embeddings?: Record<string, unknown> } = {}): MemoryEngine {
  return trackResource(new MemoryEngine({
    storageRoot: makeRoot(),
    project: 'demo',
    manualEmbeddings: true,
    embeddingProvider: new FakeEmbeddingProvider(),
    config: {
      embeddings: {
        chunkChars: 200,
        chunkOverlap: 0,
        semanticEdgesPerEntry: 2,
        semanticMaxEdges: 50,
        ...(options.embeddings ?? {}),
      },
    },
  }))
}

function unit(...values: number[]): Float32Array {
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0)) || 1
  return Float32Array.from(values.map((value) => value / norm))
}

afterEach(() => {
  for (const root of roots.splice(0)) cleanupRoot(root)
})

describe('semanticPairs', () => {
  const vectors = new Map<string, Float32Array>([
    ['a', unit(1, 0, 0)],
    ['b', unit(0.98, 0.02, 0)],
    ['c', unit(0.97, 0.03, 0)],
    ['d', unit(0, 0, 1)],
  ])

  it('keeps the closest neighbours per entry without duplicates', () => {
    const pairs = semanticPairs(vectors, { perEntry: 1, maxPairs: 10 })
    // One neighbour per entry: a→b, b→a (same pair), c→b, and d→a because d is
    // orthogonal to everything and still needs its closest — scored ~0.
    expect(pairs.map((pair) => `${pair.left}|${pair.right}`)).toEqual(['b|c', 'a|b', 'a|d'])
    expect(pairs[0]!.score).toBeGreaterThan(pairs[1]!.score)
    expect(pairs[2]!.score).toBeCloseTo(0, 5)
    for (const pair of pairs) expect(pair.left < pair.right).toBe(true)

    // Two neighbours per entry also link a and c, whose closest is b.
    const wider = semanticPairs(vectors, { perEntry: 2, maxPairs: 10 })
    const linked = wider.find((pair) => `${pair.left}|${pair.right}` === 'a|c')
    expect(linked).toBeDefined()
    expect(linked!.score).toBeGreaterThan(0.9)
    // d is orthogonal to everything, so its two neighbours both score ~0.
    expect(wider.filter((pair) => pair.score < 0.5)).toHaveLength(2)
  })

  it('applies the overall cap and the score floor', () => {
    expect(semanticPairs(vectors, { perEntry: 3, maxPairs: 2 })).toHaveLength(2)
    const high = semanticPairs(vectors, { perEntry: 3, maxPairs: 10, minScore: 0.999 })
    expect(high.every((pair) => pair.score >= 0.999)).toBe(true)
    expect(semanticPairs(new Map(), {})).toEqual([])
    expect(semanticPairs(new Map([['only', unit(1, 0, 0)]]), {})).toEqual([])
  })
})

describe('graph and lint', () => {
  it('adds semantic related edges and duplicate candidates', async () => {
    const engine = makeEngine()
    const index = engine.save({
      title: 'Инкрементальный индекс',
      text: 'Fingerprint и reconcileFromDisk вместо полного reindex.',
    })
    const twin = engine.save({
      title: 'Индексация памяти',
      text: 'Fingerprint, reconcileFromDisk и heal вместо полного reindex.',
    })
    engine.save({ title: 'Язык общения', text: 'Ответы только на русском языке.' })
    await engine.embedPending()

    const graph = engine.graph()
    const semantic = graph.edges.filter((edge) => edge.type === 'related')
    expect(semantic.length).toBeGreaterThan(0)
    expect(semantic.some((edge) => edge.weight > 50)).toBe(true)
    const pair = semantic.find(
      (edge) =>
        (edge.source === index.id && edge.target === twin.id) || (edge.source === twin.id && edge.target === index.id),
    )
    expect(pair).toBeDefined()

    const lint = engine.lintReport()
    expect(lint.duplicates.length).toBeGreaterThan(0)
    expect(lint.duplicates[0]!.score).toBeGreaterThan(0.5)
    expect(typeof lint.promptDigestChars).toBe('number')
  })

  it('reports no semantic edges when vectors are off', async () => {
    const engine = trackResource(new MemoryEngine({ storageRoot: makeRoot(), project: 'demo' }))
    engine.save({ title: 'Инкрементальный индекс', text: 'Fingerprint и reconcileFromDisk.' })
    engine.save({ title: 'Индексация памяти', text: 'Fingerprint и reconcileFromDisk, ещё раз.' })
    expect(engine.graph().edges.filter((edge) => edge.type === 'related')).toEqual([])
    expect(engine.lintReport().duplicates).toEqual([])
  })
})

describe('recall excerpt mode', () => {
  it('returns the matched passage instead of the head of the body', async () => {
    const engine = makeEngine({ embeddings: { chunkChars: 120, chunkOverlap: 0 } })
    const long = [
      'Первая часть записи рассказывает про устройство хранилища памяти и его каталоги.',
      'Вторая часть описывает формат страниц, frontmatter и раскладку по папкам категорий.',
      'Третья часть говорит про fingerprint и reconcileFromDisk, то есть про индексацию.',
    ].join(' ')
    const saved = engine.save({ title: 'Память: устройство', text: long })
    await engine.embedPending()

    const digest = await engine.recall('индексация памяти')
    const excerpt = await engine.recall('индексация памяти', { detail: 'excerpt' })
    expect(digest.items[0]!.id).toBe(saved.id)
    expect(excerpt.text).toContain('fingerprint')
    expect(excerpt.text).toContain('matched the query')
    // The per-entry budget is the same in both modes.
    const body = (text: string): string => text.split('\n\n')[1] ?? ''
    expect(body(excerpt.text).length).toBeLessThanOrEqual(engine.config.recallTextChars + 2)
    expect(digest.text.length).toBeLessThanOrEqual(engine.config.recallTotalChars)

    // Full mode still returns the whole body.
    const full = await engine.recall('индексация памяти', { detail: 'full' })
    expect(full.text).toContain('Вторая часть')
    expect(excerpt.text.length).toBeLessThan(full.text.length)
  })

  it('falls back to the entry body when the match has no passage', async () => {
    const engine = makeEngine()
    engine.save({ title: 'Запись про инкрементальный индекс', text: 'Fingerprint и reconcileFromDisk.' })
    await engine.embedPending()
    // A lexical-only hit (no vector match) still renders through the excerpt path.
    const result = await engine.recall('Fingerprint', { detail: 'excerpt' })
    expect(result.items).toHaveLength(1)
    expect(result.text).toContain('Fingerprint')
  })
})

describe('vocabulary sanity', () => {
  it('has one dimension per word group', () => {
    expect(VOCABULARY).toHaveLength(3)
  })
})
