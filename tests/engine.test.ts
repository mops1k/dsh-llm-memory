import { existsSync } from 'node:fs'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { MemoryEngine } from '@llm-memory/core/application/engine'
import { pageToText } from '@llm-memory/core/infrastructure/frontmatter'
import { entryFilePath, writeFileAtomic } from '@llm-memory/core/layout/paths'
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
  it('saves an entry and recalls it as active', async () => {
    const entry = engine.save({
      text: 'The build uses pnpm and Node 24.',
      title: 'Build toolchain',
      kind: 'facts',
      tags: ['build'],
    })

    expect(entry.id).toMatch(/^m_[0-9a-f]{12}$/)
    expect(entry.project).toBe('demo')
    expect(engine.get(entry.id)?.title).toBe('Build toolchain')

    const result = await engine.recall('build toolchain')
    expect(result.items.map((item) => item.id)).toContain(entry.id)
    expect(result.format).toBe('markdown')
    expect(result.text).toContain('Build toolchain')
    expect(result.text).toContain(entry.id)
  })

  it('marks superseded entries and excludes them from recall', async () => {
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
    expect((await engine.recall('storage engine')).items.map((item) => item.id)).not.toContain(old.id)
  })

  it('renders recall in table, timeline and json formats', async () => {
    engine.save({ text: 'Alpha beta gamma.', title: 'Alpha', kind: 'facts' })

    expect((await engine.recall('alpha', { format: 'table' })).text).toContain('| id')
    expect((await engine.recall('alpha', { format: 'timeline' })).text).toMatch(/^- \d{4}-\d{2}-\d{2}/)
    const parsed = JSON.parse((await engine.recall('alpha', { format: 'json' })).text) as Array<{ title: string }>
    expect(parsed[0]?.title).toBe('Alpha')
  })

  it('cuts long bodies in the digest rendering and returns them whole on request', async () => {
    const body = 'The build uses pnpm and Node 24. '.repeat(40).trim()
    const entry = engine.save({ text: body, title: 'Long entry', kind: 'facts' })

    const digest = await engine.recall('Long entry')
    expect(digest.text).toContain(entry.id)
    expect(digest.text).not.toContain(body)
    expect(digest.text).toContain('1 entry body was cut to 400 characters')
    expect(digest.text).toContain('detail: "full"')

    const full = await engine.recall('Long entry', { detail: 'full' })
    expect(full.text).toContain(body)
    expect(full.text).not.toContain('entry body was cut')
  })

  it('keeps the whole rendering inside the configured total budget', async () => {
    for (let index = 0; index < 8; index += 1) {
      engine.save({ text: `${'word '.repeat(80)}entry ${index}`, title: `Bulk ${index}`, kind: 'facts' })
    }
    engine.close()
    engine = new MemoryEngine({
      storageRoot: root,
      project: 'demo',
      config: { recallTextChars: 300, recallTotalChars: 600 },
    })

    const result = await engine.recall('entry')

    expect(result.items).toHaveLength(8)
    expect(result.text.length).toBeLessThanOrEqual(760)
    expect(result.text).toContain('Recall output cut to 600 characters')
  })

  it('filters recall by kind and scope', async () => {
    engine.save({ text: 'A rule about tests.', title: 'Rule', kind: 'rules' })
    engine.save({ text: 'A fact about tests.', title: 'Fact', kind: 'facts' })

    const rules = await engine.recall('tests', { kind: 'rules' })
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
    expect((await engine.recall('cross project', { scope: 'user' })).items.map((item) => item.id)).toContain(userEntry.id)
  })

  it('recalls the current project plus user entries and hides foreign projects', async () => {
    const own = engine.save({ text: 'Own project note about widgets.', title: 'Own' })
    const foreign = engine.save({
      text: 'Foreign project note about widgets.',
      title: 'Foreign',
      project: 'other',
      scope: 'project',
    })
    const shared = engine.save({
      text: 'User-wide note about widgets.',
      title: 'Shared',
      scope: 'user',
    })

    const result = await engine.recall('widgets')
    const ids = result.items.map((item) => item.id)
    expect(ids).toContain(own.id)
    expect(ids).toContain(shared.id)
    expect(ids).not.toContain(foreign.id)

    const all = await engine.recall('widgets', { scope: 'all' })
    expect(all.items.map((item) => item.id)).toContain(foreign.id)

    const explicit = await engine.recall('widgets', { project: 'other' })
    expect(explicit.items.map((item) => item.id)).toContain(foreign.id)
    expect(explicit.items.map((item) => item.id)).not.toContain(own.id)
  })

  it('updates an entry and returns null for an unknown id', () => {
    const entry = engine.save({ text: 'Draft.', title: 'Draft' })
    const updated = engine.update(entry.id, { text: 'Final text.', title: 'Final', importance: 5 })

    expect(updated?.title).toBe('Final')
    expect(updated?.text).toBe('Final text.')
    expect(updated?.importance).toBe(5)
    expect(engine.update('m_missing', { title: 'x' })).toBeNull()
  })

  it('forgets an entry by marking it superseded', async () => {
    const entry = engine.save({ text: 'Temporary note.', title: 'Temp' })

    const result = engine.forget(entry.id)
    expect(result.ok).toBe(true)
    expect(engine.get(entry.id)?.status).toBe('superseded')
    expect((await engine.recall('temporary note')).items).toHaveLength(0)
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

  it('keeps the rule digest inside the user layer and the calling project', () => {
    engine.save({ text: 'Rule for the demo workspace.', title: 'Demo rule', kind: 'rules' })
    engine.save({ text: 'Rule for another workspace.', title: 'Other rule', kind: 'rules', project: 'other' })
    engine.save({ text: 'Cross-project preference.', title: 'User preference', kind: 'preferences', scope: 'user' })

    const prompt = engine.rulesForPrompt(10, { project: 'demo' })

    expect(prompt).toContain('Demo rule')
    expect(prompt).toContain('User preference')
    expect(prompt).not.toContain('Other rule')
  })

  it('keeps every project when rulesPromptScope is "all"', () => {
    const wideRoot = makeTempRoot()
    const wide = new MemoryEngine({ storageRoot: wideRoot, project: 'demo', config: { rulesPromptScope: 'all' } })
    try {
      wide.save({ text: 'Rule for another workspace.', title: 'Other rule', kind: 'rules', project: 'other' })

      expect(wide.rulesForPrompt(10, { project: 'demo' })).toContain('Other rule')
    } finally {
      wide.close()
      cleanupRoot(wideRoot)
    }
  })

  it('bounds the digest with promptRulesLimit and not with recallLimit', () => {
    for (let index = 0; index < 8; index += 1) {
      engine.save({ text: `Rule number ${index}.`, title: `Rule ${index}`, kind: 'rules' })
    }

    // Header plus one line per rule; the default prompt digest limit is 6.
    expect(engine.rulesForPrompt().split('\n')).toHaveLength(7)
    expect(engine.rulesForPrompt(3).split('\n')).toHaveLength(4)
  })

  it('falls back to every project when the caller has no project', () => {
    engine.save({ text: 'Rule for another workspace.', title: 'Other rule', kind: 'rules', project: 'other' })

    expect(engine.rulesForPrompt(10)).toContain('Other rule')
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

  it('refreshes the index incrementally: an unchanged heal reads no page', () => {
    const a = engine.save({ text: 'Alpha body.', title: 'Alpha' })
    engine.save({ text: 'Beta body.', title: 'Beta' })

    expect(engine.heal().reindexed).toBe(0)

    // A page edited outside the plugin is picked up by the next heal, and only
    // that page is read again.
    const entry = engine.get(a.id)
    expect(entry).not.toBeNull()
    if (!entry) return
    writeFileAtomic(entryFilePath(root, entry), pageToText({ ...entry, text: 'Alpha body, edited by hand.' }))

    const afterEdit = engine.heal()
    expect(afterEdit.reindexed).toBe(1)
    expect(engine.get(a.id)?.text).toBe('Alpha body, edited by hand.')
  })
})
