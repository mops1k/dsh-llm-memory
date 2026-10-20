#!/usr/bin/env node
/** Pure-Node smoke test of the demo transport (no DOM, no store changes). */
import assert from 'node:assert/strict'
import { createDemoApi } from '../js/demo.js'

const api = createDemoApi()

const status = await api.status()
assert.ok(status.total > 40, 'demo store has entries')
assert.equal(status.active + (status.byStatus.superseded ?? 0), status.total)
assert.ok(Object.keys(status.byProject).length >= 5, 'projects are present')
assert.ok(status.vectors.chunks > 0, 'vector chunks are reported')

const page = await api.items({ limit: 5, offset: 0, project: 'dsh-llm-memory' })
assert.ok(page.items.length <= 5)
assert.ok(page.total >= page.items.length)
assert.ok(page.items.every(item => item.project === 'dsh-llm-memory'))

const filtered = await api.items({ limit: 50, kind: 'rules', status: 'active', project: 'all' })
assert.ok(filtered.items.every(item => item.kind === 'rules' && item.status === 'active'))

const recall = await api.recall('kilo windows', { limit: 10, project: 'all' })
assert.ok(recall.items.length > 0, 'hybrid recall returns items')
assert.ok(recall.items[0].sources.includes('bm25'), 'lexical leg is visible')
assert.ok(recall.text.includes('Гибридный поиск'), 'summary explains the search')

const graph = await api.graph({ project: 'all' })
assert.ok(graph.entities.length > 10)
assert.ok(graph.edges.length > 0)
assert.ok(graph.entities.every(entity => entity.id && entity.name && entity.kind))

const lint = await api.lint({ project: 'all' })
assert.ok(lint.totalCount > 0)
assert.ok(Array.isArray(lint.overlaps) && Array.isArray(lint.duplicates))
assert.ok(lint.brokenLinks.length > 0, 'demo shows broken links')

const heal = await api.heal('report')
assert.ok(heal.reindexed > 0)
assert.ok(heal.vectors && typeof heal.vectors.checked === 'number')

const map = await api.vectorsMap({ q: 'kilo windows', topK: 5, project: 'all' })
assert.ok(map.map.points.length > 0)
assert.ok(map.query.nearest.length > 0, 'query has nearest points')
assert.ok(map.query.nearest.length <= 5)
assert.ok(map.query.nearest.every(item => item.score >= 0 && item.score <= 1))

const health = await api.vectorsHealth()
assert.equal(health.health.checked, status.total)
assert.deepEqual(health.health.orphans, [])

const model = await api.modelStatus()
assert.equal(typeof model.cached, 'boolean')
assert.ok(model.model.includes('e5'), 'demo uses the e5 model')

const before = await api.backups()
const created = await api.createBackup()
assert.ok(created.archive.endsWith('.llmmem'))
assert.equal((await api.backups()).length, before.length + 1)
const verified = await api.verifyBackup(created.archive)
assert.equal(verified.ok, true)
await api.deleteBackup(created.archive)
assert.equal((await api.backups()).length, before.length)

const saved = await api.saveItem({ title: 'Smoke entry', text: 'temporary', kind: 'facts', tier: 'normal', importance: 3, tags: ['smoke'] })
assert.ok(saved.id)
assert.equal((await api.items({ query: 'Smoke entry', project: 'all' })).total, 1)
assert.equal((await api.forgetEntry(saved.id)).status, 'superseded')
await api.deleteEntry(saved.id)
assert.equal((await api.items({ query: 'Smoke entry', project: 'all' })).total, 0)

console.log('demo transport smoke: ok · entries', status.total, '· projects', Object.keys(status.byProject).length, '· graph edges', graph.edges.length)
