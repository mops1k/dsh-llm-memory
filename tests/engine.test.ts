import { existsSync } from 'node:fs'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { MemoryEngine } from '../src/core/engine'
import { entryFilePath } from '../src/core/paths'
import { cleanupRoot, makeTempRoot } from './helpers'

let root: string
let engine: MemoryEngine

beforeEach(() => {
  root = makeTempRoot()
  engine = new MemoryEngine({ storageRoot: root, project: 'demo' })
})

afterEach(() => {
  engine.close()
  cleanupRoot(root)
})

describe('MemoryEngine', () => {
  it('saves an entry and recalls it as active', () => {
    const entry = engine.save({
      text: 'The build uses pnpm and Node 24.',
      title: 'Build toolchain',
      kind: 'facts',
      tags: ['build'],
    })

    expect(entry.id).toMatch(/^m_[0-9a-f]{12}$/)
    expect(entry.project).toBe('demo')
    expect(engine.get(entry.id)?.title).toBe('Build toolchain')

    const result = engine.recall('build toolchain')
    expect(result.items.map((item) => item.id)).toContain(entry.id)
    expect(result.format).toBe('markdown')
    expect(result.text).toContain('Build toolchain')
    expect(result.text).toContain(entry.id)
  })

  it('marks superseded entries and excludes them from recall', () => {
    const old = engine.save({ text: 'Old decision: use MySQL.', title: 'Storage engine' })
    const fresh = engine.save({
      text: 'New decision: use PostgreSQL.',
      title: 'Storage engine 2',
      supersedes: [old.id],
    })

    const oldAfter = engine.get(old.id)
    expect(oldAfter?.status).toBe('superseded')
    expect(oldAfter?.supersededBy).toContain(fresh.id)
    expect(fresh.supersedes).toContain(old.id)
    expect(engine.recall('storage engine').items.map((item) => item.id)).not.toContain(old.id)
  })

  it('renders recall in table, timeline and json formats', () => {
    engine.save({ text: 'Alpha beta gamma.', title: 'Alpha', kind: 'facts' })

    expect(engine.recall('alpha', { format: 'table' }).text).toContain('| id')
    expect(engine.recall('alpha', { format: 'timeline' }).text).toMatch(/^- \d{4}-\d{2}-\d{2}/)
    const parsed = JSON.parse(engine.recall('alpha', { format: 'json' }).text) as Array<{ title: string }>
    expect(parsed[0]?.title).toBe('Alpha')
  })

  it('filters recall by kind and scope', () => {
    engine.save({ text: 'A rule about tests.', title: 'Rule', kind: 'rules' })
    engine.save({ text: 'A fact about tests.', title: 'Fact', kind: 'facts' })

    const rules = engine.recall('tests', { kind: 'rules' })
    expect(rules.items).toHaveLength(1)
    expect(rules.items[0]?.kind).toBe('rules')

    const userEntry = engine.save({
      text: 'Cross project preference.',
      title: 'Pref',
      scope: 'user',
      kind: 'preferences',
    })
    expect(userEntry.scope).toBe('user')
    expect(userEntry.project).toBe('')
    expect(engine.recall('cross project', { scope: 'user' }).items.map((item) => item.id)).toContain(userEntry.id)
  })

  it('updates an entry and returns null for an unknown id', () => {
    const entry = engine.save({ text: 'Draft.', title: 'Draft' })
    const updated = engine.update(entry.id, { text: 'Final text.', title: 'Final', importance: 5 })

    expect(updated?.title).toBe('Final')
    expect(updated?.text).toBe('Final text.')
    expect(updated?.importance).toBe(5)
    expect(engine.update('m_missing', { title: 'x' })).toBeNull()
  })

  it('forgets an entry by marking it superseded', () => {
    const entry = engine.save({ text: 'Temporary note.', title: 'Temp' })

    const result = engine.forget(entry.id)
    expect(result.ok).toBe(true)
    expect(engine.get(entry.id)?.status).toBe('superseded')
    expect(engine.recall('temporary note').items).toHaveLength(0)
    expect(engine.forget(entry.id).ok).toBe(true)
    expect(engine.forget('m_missing').ok).toBe(false)
  })

  it('deletes an entry permanently and strips references to it', () => {
    const target = engine.save({ text: 'Target body.', title: 'Target' })
    const source = engine.save({ text: 'Source body.', title: 'Source', related: [target.id] })
    const file = entryFilePath(engine.root, target)
    expect(existsSync(file)).toBe(true)

    expect(engine.delete(target.id)).toBe(true)
    expect(engine.get(target.id)).toBeNull()
    expect(existsSync(file)).toBe(false)
    expect(engine.get(source.id)?.related).toEqual([])
    expect(engine.delete(target.id)).toBe(false)
  })

  it('keeps extKey saves idempotent', () => {
    const first = engine.save({ text: 'Imported one.', title: 'Imported', extKey: 'kilo:1' })
    const second = engine.save({ text: 'Imported one updated.', title: 'Imported', extKey: 'kilo:1' })

    expect(second.id).toBe(first.id)
    expect(engine.list({ status: 'all' }).total).toBe(1)
    expect(engine.get(first.id)?.text).toBe('Imported one updated.')
  })

  it('reports broken links and significant overlaps', () => {
    const lintRoot = makeTempRoot()
    const lintEngine = new MemoryEngine({
      storageRoot: lintRoot,
      project: 'demo',
      config: { lintOverlapMinCommonWords: 3 },
    })
    try {
      lintEngine.save({ text: 'Shared alpha beta gamma delta.', title: 'One', related: ['m_missing'] })
      lintEngine.save({ text: 'Shared alpha beta gamma delta.', title: 'Two' })
      lintEngine.save({ text: 'Unrelated zeta eta theta iota.', title: 'Three' })

      const report = lintEngine.lintReport()
      expect(report.activeCount).toBe(3)
      expect(report.brokenLinks.map((link) => link.missingId)).toContain('m_missing')
      expect(report.overlaps.length).toBeGreaterThan(0)
      expect(report.overlaps[0]?.common).toBeGreaterThanOrEqual(3)
    } finally {
      lintEngine.close()
      cleanupRoot(lintRoot)
    }
  })

  it('reports status counters and storage info', () => {
    engine.save({ text: 'One.', title: 'One', kind: 'facts' })
    const gone = engine.save({ text: 'Two.', title: 'Two', kind: 'rules' })
    engine.forget(gone.id)

    const report = engine.statusReport()
    expect(report.total).toBe(2)
    expect(report.active).toBe(1)
    expect(report.byStatus['superseded']).toBe(1)
    expect(report.byKind['rules']).toBe(1)
    expect(report.byProject['demo']).toBe(2)
    expect(report.dbSizeBytes).toBeGreaterThan(0)
    expect(report.root).toBe(engine.root)
  })

  it('builds a knowledge graph from relations', () => {
    const target = engine.save({ text: 'Base fact.', title: 'Base', kind: 'facts' })
    const decision = engine.save({
      text: 'We decide to use it.',
      title: 'Decision',
      kind: 'decisions',
      related: [target.id],
    })

    const graph = engine.graph()
    expect(graph.entities.map((entity) => entity.id)).toContain(decision.id)
    expect(
      graph.edges.some((edge) => edge.type === 'depends' && edge.source === decision.id && edge.target === target.id),
    ).toBe(true)
  })

  it('renders rules and preferences for the system prompt', () => {
    expect(engine.rulesForPrompt()).toBe('')
    engine.save({ text: 'Always run the linter.', title: 'Lint rule', kind: 'rules' })
    engine.save({ text: 'Prefer tabs over spaces.', title: 'Tabs', kind: 'preferences' })
    const prompt = engine.rulesForPrompt()
    expect(prompt).toContain('Lint rule')
    expect(prompt).toContain('Tabs')
  })

  it('imports entries idempotently by extKey', () => {
    const entry = {
      extKey: 'kilo:42',
      text: 'Imported fact about queues.',
      title: 'Queues',
      kind: 'facts' as const,
    }

    const first = engine.importEntries([entry], 'kilo')
    expect(first.imported).toBe(1)
    expect(first.updated).toBe(0)
    expect(first.skipped).toBe(0)

    const second = engine.importEntries([entry], 'kilo')
    expect(second.imported).toBe(0)
    expect(second.skipped).toBe(1)

    const third = engine.importEntries([{ ...entry, text: 'Changed fact about queues.' }], 'kilo')
    expect(third.updated).toBe(1)

    const items = engine.list({ status: 'all' }).items
    expect(items).toHaveLength(1)
    expect(items[0]?.text).toBe('Changed fact about queues.')

    const invalid = engine.importEntries([{ extKey: '', text: 'x' }], 'kilo')
    expect(invalid.skipped).toBe(1)
  })

  it('remaps imported relations to local ids, drops missing targets and stays idempotent', () => {
    const entries = [
      { extKey: 'kilo:a', text: 'A supersedes B and relates C.', title: 'A', supersedes: ['b'], related: ['c', 'd'] },
      { extKey: 'kilo:b', text: 'B body.', title: 'B' },
      { extKey: 'kilo:c', text: 'C body.', title: 'C' },
    ]

    const first = engine.importEntries(entries, 'kilo')
    expect(first.imported).toBe(3)
    expect(first.droppedRelations).toBe(1)

    const items = engine.list({ status: 'all' }).items
    const a = items.find((item) => item.extKey === 'kilo:a')
    const b = items.find((item) => item.extKey === 'kilo:b')
    const c = items.find((item) => item.extKey === 'kilo:c')
    expect(a?.supersedes).toEqual([b?.id])
    expect(a?.related).toEqual([c?.id])
    expect(engine.lintReport().brokenLinks).toHaveLength(0)

    const idsBefore = items.map((item) => item.id).sort()
    const second = engine.importEntries(entries, 'kilo')
    expect(second.imported).toBe(0)
    expect(second.updated).toBe(0)
    expect(second.skipped).toBe(3)
    expect(engine.list({ status: 'all' }).items.map((item) => item.id).sort()).toEqual(idsBefore)
  })

  it('heals broken links and adds missing backlinks without changing statuses', () => {
    const a = engine.save({ text: 'Alpha body.', title: 'Alpha' })
    const b = engine.save({ text: 'Beta body.', title: 'Beta' })
    engine.update(a.id, { supersedes: [b.id], related: [b.id, 'm_missing'] })
    expect(engine.lintReport().brokenLinks).toHaveLength(1)

    const report = engine.heal()

    expect(report.removedLinks).toBe(1)
    expect(report.addedBacklinks).toBeGreaterThanOrEqual(2)
    expect(report.brokenAfter).toBe(0)
    expect(engine.lintReport().brokenLinks).toHaveLength(0)

    const bAfter = engine.get(b.id)
    expect(bAfter?.supersededBy).toContain(a.id)
    expect(bAfter?.related).toContain(a.id)
    expect(engine.get(a.id)?.status).toBe('active')
    expect(bAfter?.status).toBe('active')
  })
})
