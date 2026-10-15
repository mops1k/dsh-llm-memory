import { describe, expect, it } from 'vitest'

import { newMemoryEntry } from '../src/core/store'
import { renderRecall } from '../src/core/engine'
import {
  DEFAULT_RANKING,
  IDENTIFIER_RANKING,
  computeScore,
  looksLikeIdentifierQuery,
  rankItemsHybridDetailed,
  rankItemsHybrid,
  rankRulesBase,
  significantOverlapPairs,
  tokenize,
} from '../src/core/ranking'

describe('identifier queries', () => {
  it('recognises literals and leaves phrases alone', () => {
    for (const query of [
      'ERR_PNPM_IGNORED_BUILDS',
      '0.2.0-rc.2',
      'm_97f3c2deac12',
      'Xenova/multilingual-e5-small',
      '48f21c948536a0257dbb508a8c88a6a8',
      'sqlite-vec',
      'looksLikeIdentifierQuery',
    ]) {
      expect(looksLikeIdentifierQuery(query)).toBe(true)
    }
    for (const query of [
      'почему зависал интерфейс',
      'memory map visualization',
      'как работает память',
      'векторы',
      'recall',
      '',
    ]) {
      expect(looksLikeIdentifierQuery(query)).toBe(false)
    }
    // A sentence containing a literal is still a phrase, not a lookup.
    expect(looksLikeIdentifierQuery('ошибка ERR_PNPM_IGNORED_BUILDS при удалении плагина')).toBe(false)
  })

  it('gives the lexical leg a heavier vote without touching the default ranking', () => {
    const exact = newMemoryEntry({ id: 'm_i1', kind: 'facts', title: 'err_pnpm_ignored_builds', text: 'text' })
    const semantic = newMemoryEntry({ id: 'm_i2', kind: 'facts', title: 'Semantic', text: 'text' })
    const items = [semantic, exact]
    // The lexical leg knows the literal; the vector leg prefers the other entry.
    const bm25 = new Map([['m_i1', 12]])
    const vectors = new Map([
      ['m_i2', 0.93],
      ['m_i1', 0.7],
    ])

    const byDefault = rankItemsHybridDetailed(items, 'err_pnpm_ignored_builds', DEFAULT_RANKING, 'all', bm25, vectors)
    const boosted = rankItemsHybridDetailed(items, 'err_pnpm_ignored_builds', IDENTIFIER_RANKING, 'all', bm25, vectors)
    expect(boosted.items[0]?.id).toBe('m_i1')
    // Provenance is unchanged by the weights: it reports the legs, not the score.
    expect(boosted.provenance.get('m_i1')).toMatchObject({ bm25: 0, vector: 1 })
    // The default ranking must keep its own (unweighted) order for other queries.
    expect(rankItemsHybridDetailed(items, 'текст', DEFAULT_RANKING, 'all', bm25, vectors).items.length).toBe(
      byDefault.items.length,
    )
    expect(IDENTIFIER_RANKING.rrfK).toBe(DEFAULT_RANKING.rrfK)
  })
})

describe('recall provenance', () => {
  it('reports the legs that pulled each entry in, without changing the order', () => {
    const lexicalOnly = newMemoryEntry({ id: 'm_p1', kind: 'facts', title: 'Lexical', text: 'text' })
    const semanticOnly = newMemoryEntry({ id: 'm_p2', kind: 'facts', title: 'Semantic', text: 'text' })
    const both = newMemoryEntry({ id: 'm_p3', kind: 'facts', title: 'Both', text: 'text' })
    const items = [lexicalOnly, semanticOnly, both]
    const bm25 = new Map([
      ['m_p1', 9],
      ['m_p3', 4],
    ])
    const vectors = new Map([
      ['m_p2', 0.91],
      ['m_p3', 0.88],
    ])

    const detailed = rankItemsHybridDetailed(items, 'text', DEFAULT_RANKING, 'all', bm25, vectors)
    expect(detailed.provenance.get('m_p1')).toMatchObject({ bm25: 0 })
    expect(detailed.provenance.get('m_p1')?.vector).toBeUndefined()
    expect(detailed.provenance.get('m_p2')).toMatchObject({ vector: 0 })
    expect(detailed.provenance.get('m_p2')?.bm25).toBeUndefined()
    expect(detailed.provenance.get('m_p3')).toMatchObject({ bm25: 1, vector: 1 })
    for (const entry of items) {
      expect(detailed.provenance.get(entry.id)?.metadata).toBeGreaterThanOrEqual(0)
      expect(detailed.provenance.get(entry.id)?.score).toBeGreaterThan(0)
    }
    // The order must stay exactly what the plain hybrid call returns.
    expect(detailed.items.map((entry) => entry.id)).toEqual(
      rankItemsHybrid(items, 'text', DEFAULT_RANKING, 'all', bm25, vectors).map((entry) => entry.id),
    )
  })

  it('renders the legs in the json format only', () => {
    const entry = newMemoryEntry({ id: 'm_p4', kind: 'facts', title: 'Entry', text: 'text' })
    const sources = new Map([['m_p4', ['bm25', 'vector', 'metadata']]])

    const json = JSON.parse(renderRecall([entry], 'json', { sources })) as Array<Record<string, unknown>>
    expect(json[0]?.['sources']).toEqual(['bm25', 'vector', 'metadata'])
    // The text formats stay clean: markers there would only cost prompt tokens.
    const markdown = renderRecall([entry], 'markdown', { sources })
    expect(markdown).not.toContain('vector')
    expect(renderRecall([entry], 'json').startsWith('[')).toBe(true)
  })
})

describe('ranking', () => {
  it('tokenizes and deduplicates lowercase words', () => {
    expect(tokenize('Hello, HELLO world! a')).toEqual(['hello', 'world'])
  })

  it('scores relevant and immutable entries higher', () => {
    const relevant = newMemoryEntry({ id: 'm_r1', kind: 'facts', title: 'Needle', text: 'contains needle', tier: 'normal' })
    const irrelevant = newMemoryEntry({ id: 'm_r2', kind: 'facts', title: 'Other', text: 'nothing here', tier: 'normal' })
    const immutable = newMemoryEntry({ id: 'm_r3', kind: 'facts', title: 'Other', text: 'nothing here', tier: 'immutable' })

    const relScore = computeScore(relevant, ['needle'], DEFAULT_RANKING)
    expect(relScore).toBeGreaterThan(computeScore(irrelevant, ['needle'], DEFAULT_RANKING))
    expect(computeScore(immutable, [], DEFAULT_RANKING)).toBeGreaterThan(computeScore(irrelevant, [], DEFAULT_RANKING))
  })

  it('orders the rules base by tier', () => {
    const normal = newMemoryEntry({ id: 'm_b1', kind: 'rules', title: 'Normal rule', importance: 3 })
    const immutable = newMemoryEntry({ id: 'm_b2', kind: 'rules', title: 'Immutable rule', tier: 'immutable', importance: 3 })
    const ranked = rankRulesBase([normal, immutable], DEFAULT_RANKING)
    expect(ranked[0]?.id).toBe('m_b2')
  })

  it('fuses BM25 and metadata ranks', () => {
    const metaBest = newMemoryEntry({ id: 'm_h1', kind: 'facts', title: 'A', text: 'a', importance: 5 })
    const balanced = newMemoryEntry({ id: 'm_h2', kind: 'facts', title: 'B', text: 'b', importance: 3 })
    const bm25Middle = newMemoryEntry({ id: 'm_h3', kind: 'facts', title: 'C', text: 'c', importance: 1 })
    const ranks = new Map<string, number>([
      ['m_h2', 10],
      ['m_h3', 5],
    ])
    const ranked = rankItemsHybrid([metaBest, balanced, bm25Middle], 'query', DEFAULT_RANKING, 'all', ranks)
    expect(ranked[0]?.id).toBe('m_h2')
  })

  it('lets the relevance legs outvote query-independent metadata', () => {
    const metadataOnly = newMemoryEntry({
      id: 'm_f1',
      kind: 'rules',
      tier: 'immutable',
      title: 'Old important rule',
      text: 'unrelated',
      importance: 5,
    })
    const lexicalHit = newMemoryEntry({ id: 'm_f2', kind: 'facts', title: 'Plain fact', text: 'needle' })
    const semanticHit = newMemoryEntry({ id: 'm_f3', kind: 'facts', title: 'Semantic fact', text: 'other' })

    const lexical = rankItemsHybrid(
      [metadataOnly, lexicalHit, semanticHit],
      'needle',
      DEFAULT_RANKING,
      'all',
      new Map([['m_f2', -1]]),
    )
    expect(lexical[0]?.id).toBe('m_f2')

    const semantic = rankItemsHybrid(
      [metadataOnly, lexicalHit, semanticHit],
      'needle',
      DEFAULT_RANKING,
      'all',
      new Map(),
      new Map([['m_f3', 0.9]]),
    )
    expect(semantic[0]?.id).toBe('m_f3')

    // With no relevance signal at all, metadata still decides.
    const metadataWins = rankItemsHybrid([metadataOnly, lexicalHit], 'nothing', DEFAULT_RANKING, 'all', new Map())
    expect(metadataWins[0]?.id).toBe('m_f1')
  })

  it('finds significant lexical overlap pairs', () => {
    const a = newMemoryEntry({ id: 'm_o1', title: 'Alpha', text: 'tabs indentation default' })
    const b = newMemoryEntry({ id: 'm_o2', title: 'Beta', text: 'tabs indentation settings' })
    const c = newMemoryEntry({ id: 'm_o3', title: 'Gamma', text: 'unrelated content here' })

    const pairs = significantOverlapPairs([a, b, c], { minCommonWords: 2, minScore: 0.1 })
    expect(pairs).toHaveLength(1)
    expect([pairs[0]?.a.id, pairs[0]?.b.id].sort()).toEqual(['m_o1', 'm_o2'])
  })
})
