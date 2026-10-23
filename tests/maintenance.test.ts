import { describe, expect, it } from 'vitest'

import {
  consolidate,
  crystallize,
  DEFAULT_MAINTENANCE,
  reinforce,
  selfHeal,
} from '@llm-memory/core/application/maintenance'
import { entryFromKiloRow } from '@llm-memory/core/domain/mapping'
import type { MemoryEntry } from '@llm-memory/core/domain/types'
import { newMemoryEntry } from '@llm-memory/core/infrastructure/store'

function entry(patch: Partial<MemoryEntry> = {}): MemoryEntry {
  return newMemoryEntry({
    scope: 'user',
    title: 'fixture entry',
    text: 'first line\nsecond line',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...patch,
  })
}

describe('maintenance', () => {
  it('reinforce bumps the counter, lastAccess and confidence, capped at 1', () => {
    const hot = reinforce(entry({ confidence: 0.99 }), DEFAULT_MAINTENANCE, '2026-03-01T00:00:00.000Z')
    expect(hot.accessCount).toBe(1)
    expect(hot.lastAccess).toBe('2026-03-01T00:00:00.000Z')
    expect(hot.confidence).toBe(1)
  })

  it('reinforce promotes consolidation on thresholds', () => {
    const eligible = entry({ confidence: 0.8, accessCount: 4, consolidation: 'episodic' })
    expect(reinforce(eligible).consolidation).toBe('semantic')
    const notYet = entry({ confidence: 0.8, accessCount: 3, consolidation: 'episodic' })
    expect(reinforce(notYet).consolidation).toBe('episodic')
    const toProcedural = entry({ confidence: 0.8, accessCount: 9, consolidation: 'semantic' })
    expect(reinforce(toProcedural).consolidation).toBe('procedural')
    const lowConfidence = entry({ confidence: 0.2, accessCount: 10, consolidation: 'episodic' })
    expect(reinforce(lowConfidence).consolidation).toBe('episodic')
  })

  it('consolidate promotes only eligible entries and reports changes', () => {
    const items = [
      entry({ id: 'm_1', consolidation: 'episodic', confidence: 0.9, accessCount: 6 }),
      entry({ id: 'm_2', consolidation: 'episodic', confidence: 0.1, accessCount: 1 }),
      entry({ id: 'm_3', consolidation: 'procedural', confidence: 1, accessCount: 10 }),
    ]
    const { items: next, changed } = consolidate(items, DEFAULT_MAINTENANCE, '2026-04-01T00:00:00.000Z')
    expect(changed.map(item => item.id)).toEqual(['m_1'])
    expect(next[0]?.consolidation).toBe('semantic')
    expect(next[0]?.updatedAt).toBe('2026-04-01T00:00:00.000Z')
    expect(next[1]?.consolidation).toBe('episodic')
    expect(next[2]?.consolidation).toBe('procedural')
  })

  it('crystallize builds a digest of significant active entries', () => {
    const items = [
      entry({ id: 'm_1', kind: 'rules', title: 'Rule one' }),
      entry({ id: 'm_2', kind: 'facts', importance: 3 }),
      entry({ id: 'm_3', kind: 'preferences', title: 'Pref' }),
      entry({ id: 'm_4', kind: 'facts', status: 'superseded' }),
    ]
    const result = crystallize(items, 'session/1', DEFAULT_MAINTENANCE)
    expect(result.disabled).toBe(false)
    expect(result.items.map(item => item.id)).toEqual(['m_1', 'm_3'])
    expect(result.markdown).toContain('# Crystallization: session-1')
    expect(result.markdown).toContain('Rule one')
    expect(result.markdown).toContain('— first line')
    const disabled = crystallize(items, 's', { ...DEFAULT_MAINTENANCE, crystallizationEnabled: false })
    expect(disabled.disabled).toBe(true)
    expect(disabled.markdown).toBe('')
  })

  it('selfHeal reports broken references, stale and duplicate titles', () => {
    const items = [
      entry({ id: 'm_1', title: 'Same', related: ['m_missing'], updatedAt: '2020-01-01T00:00:00.000Z' }),
      entry({ id: 'm_2', title: 'same', updatedAt: '2026-01-01T00:00:00.000Z' }),
    ]
    const report = selfHeal(items, 'report', DEFAULT_MAINTENANCE, Date.parse('2026-06-01T00:00:00.000Z'))
    expect(report.issues.filter(issue => issue.kind === 'broken-reference')).toHaveLength(1)
    expect(report.issues.filter(issue => issue.kind === 'stale')).toHaveLength(1)
    expect(report.issues.filter(issue => issue.kind === 'duplicate-title')).toHaveLength(1)
    expect(report.issues.every(issue => issue.fixed === false)).toBe(true)
    expect(report.items[0]?.related).toEqual(['m_missing'])
  })

  it('selfHeal apply-safe cleans references but never touches immutable entries', () => {
    const items = [
      entry({ id: 'm_1', related: ['m_missing', 'm_2'] }),
      entry({ id: 'm_2' }),
      entry({ id: 'm_3', tier: 'immutable', related: ['m_missing'], supersedes: ['m_gone'] }),
    ]
    const report = selfHeal(items, 'apply-safe', DEFAULT_MAINTENANCE)
    expect(report.items[0]?.related).toEqual(['m_2'])
    expect(report.items[2]?.related).toEqual(['m_missing'])
    expect(report.issues.filter(issue => issue.fixed).length).toBe(1)
  })

  it('selfHeal resolves references against knownIds outside the processed slice', () => {
    // A project-scoped pass sees only project `alpha`; the targets live in
    // another project and in global memory, so they are not broken.
    const scoped = [entry({ id: 'm_a', scope: 'project', project: 'alpha', related: ['m_b', 'm_global'] })]
    const knownIds = new Set(['m_a', 'm_b', 'm_global'])
    const report = selfHeal(scoped, 'apply-safe', DEFAULT_MAINTENANCE, Date.now(), knownIds)
    expect(report.issues.filter(issue => issue.kind === 'broken-reference')).toEqual([])
    expect(report.items[0]?.related).toEqual(['m_b', 'm_global'])

    // A reference missing from the whole memory is still reported and cleaned.
    const mixed = [entry({ id: 'm_a', related: ['m_b', 'm_gone'] })]
    const cleaned = selfHeal(mixed, 'apply-safe', DEFAULT_MAINTENANCE, Date.now(), new Set(['m_a', 'm_b']))
    expect(cleaned.items[0]?.related).toEqual(['m_b'])
    expect(
      cleaned.issues.filter(issue => issue.kind === 'broken-reference').map(issue => issue.detail),
    ).toEqual(['m_gone'])
  })

  it('handles a real Kilo fixture without throwing', () => {
    const rows: Record<string, unknown>[] = [
      { id: 'm_1', scope: 'project', kind: 'facts', status: 'active', title: 'a', content: 'x', updatedAt: '2026-01-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'm_2', scope: 'global', kind: 'rules', status: 'active', title: 'b', content: 'y', updatedAt: '2026-01-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z' },
    ]
    const items = rows.map(entryFromKiloRow)
    const report = selfHeal(items, 'apply-safe')
    expect(report.issues.filter(issue => issue.kind === 'broken-reference')).toEqual([])
    expect(consolidate(items).changed).toEqual([])
  })
})
