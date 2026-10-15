import { describe, expect, it } from 'vitest'

import { newMemoryEntry } from '../src/core/store'
import {
  DEFAULT_RANKING,
  computeScore,
  rankItemsHybrid,
  rankRulesBase,
  significantOverlapPairs,
  tokenize,
} from '../src/core/ranking'

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
