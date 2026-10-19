import { describe, expect, it } from 'vitest'

import { computeScore, DEFAULT_RANKING, KILO_RANKING_WEIGHTS } from '@llm-memory/core/application/ranking'
import { newMemoryEntry } from '@llm-memory/core/infrastructure/store'
import type { MemoryEntry } from '@llm-memory/core/domain/types'

function entry(patch: Partial<MemoryEntry> = {}): MemoryEntry {
  return newMemoryEntry({
    scope: 'user',
    text: 'fixture body about pnpm builds',
    title: 'fixture',
    updatedAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...patch,
  })
}

describe('ranking superset', () => {
  it('uses the access counter (Kilo accessCount) with default weights', () => {
    const cold = computeScore(entry({ accessCount: 0 }), ['pnpm'])
    const hot = computeScore(entry({ accessCount: 8 }), ['pnpm'])
    expect(hot).toBeGreaterThan(cold)
  })

  it('keeps Kilo factors opt-in: defaults are backward compatible', () => {
    const a = entry({ consolidation: 'procedural' })
    const b = entry({ consolidation: 'episodic' })
    expect(computeScore(a, ['pnpm'])).toBeCloseTo(computeScore(b, ['pnpm']), 10)
    expect(DEFAULT_RANKING.weights.consolidation).toBe(0)
    expect(DEFAULT_RANKING.weights.conflict).toBe(0)
  })

  it('orders consolidation levels under Kilo weights', () => {
    const weights = { ...DEFAULT_RANKING.weights, ...KILO_RANKING_WEIGHTS, acc: 0 }
    const opts = { ...DEFAULT_RANKING, weights }
    const procedural = computeScore(entry({ consolidation: 'procedural' }), ['pnpm'], opts)
    const semantic = computeScore(entry({ consolidation: 'semantic' }), ['pnpm'], opts)
    const episodic = computeScore(entry({ consolidation: 'episodic' }), ['pnpm'], opts)
    expect(procedural).toBeGreaterThan(semantic)
    expect(semantic).toBeGreaterThan(episodic)
  })

  it('penalizes entries that already have a replacement under Kilo weights', () => {
    const weights = { ...DEFAULT_RANKING.weights, ...KILO_RANKING_WEIGHTS }
    const opts = { ...DEFAULT_RANKING, weights }
    const plain = computeScore(entry(), ['pnpm'], opts)
    const replaced = computeScore(entry({ supersededBy: ['m_000000000002'] }), ['pnpm'], opts)
    expect(replaced).toBeLessThan(plain)
    // The penalty is a Kilo factor: DSH defaults must not apply it.
    expect(computeScore(entry({ supersededBy: ['m_000000000002'] }), ['pnpm'])).toBeCloseTo(
      computeScore(entry(), ['pnpm']),
      10,
    )
  })
})
