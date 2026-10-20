#!/usr/bin/env node
/**
 * Keeps the generated fixture honest about the SDK.
 *
 * Default: compares fixtures/sdk-snapshot.json with the freshly built SDK in
 * ../lib — this must always pass, otherwise the fixture is stale (run
 * `pnpm build && node scripts/gen-fixtures.mjs`).
 *
 * Optional: `--live <url>` compares against a running host's snapshot, e.g.
 *   node scripts/check-sdk-parity.mjs --live http://127.0.0.1:3080/llm-memory/api/ui/snapshot
 * A live host runs whatever build it started with, so restart it before using
 * this as a pass/fail gate.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = JSON.parse(readFileSync(resolve(here, '../fixtures/sdk-snapshot.json'), 'utf8'))
const { panelSnapshot } = await import(new URL('../../../../../lib/core/domain/ui-contract.js', import.meta.url).href)

const liveIndex = process.argv.indexOf('--live')
const liveUrl = liveIndex >= 0 ? process.argv[liveIndex + 1] : null

function compare(snapshot, label) {
  const problems = []
  const views = fixture.locales.en.views
  const actions = fixture.locales.en.actions
  const equal = (what, a, b) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      problems.push(`${label}: ${what}\n  fixture: ${JSON.stringify(a)}\n  host:    ${JSON.stringify(b)}`)
    }
  }
  equal('schema version', fixture.version, snapshot.version)
  equal('view ids', views.map(view => view.id), snapshot.views.map(view => view.id))
  equal('operations', fixture.operations, snapshot.operations)
  equal('action ids', actions.map(action => action.id), snapshot.actions.map(action => action.id))
  for (const view of views) {
    const twin = snapshot.views.find(item => item.id === view.id)
    if (!twin) continue
    equal(`widgets of ${view.id}`, view.widgets.map(widget => widget.kind), twin.widgets.map(widget => widget.kind))
    for (const [index, widget] of view.widgets.entries()) {
      const other = twin.widgets[index]
      if (!other) continue
      if (widget.kind === 'table' || widget.kind === 'search') {
        equal(`columns of ${view.id}`, widget.columns.map(column => column.path), other.columns.map(column => column.path))
        equal(`pagination of ${view.id}`, widget.pagination, other.pagination)
      }
      if (widget.kind === 'stats') equal(`metrics of ${view.id}`, widget.metrics.map(metric => metric.path), other.metrics.map(metric => metric.path))
      if (widget.kind === 'editor') equal(`fields of ${view.id}`, widget.fields.map(field => field.path), other.fields.map(field => field.path))
      if (widget.kind === 'actions') equal(`actions of ${view.id}`, widget.actions, other.actions)
      if (widget.kind === 'vector-map') equal(`params of ${view.id}`, widget.params?.map(param => param.name), other.params?.map(param => param.name))
    }
  }
  return problems
}

const problems = compare(panelSnapshot('en'), 'built SDK')
if (problems.length) {
  console.error(`parity check failed against built SDK (${problems.length}):\n- ${problems.join('\n- ')}`)
  process.exit(1)
}
const fields = Object.keys(fixture.values).length
console.log(`parity check: fixture matches built SDK · ${fixture.locales.en.views.length} views · ${fixture.locales.en.actions.length} actions · ${fixture.operations.length} operations · ${fields} settings values`)

if (liveUrl) {
  const response = await fetch(liveUrl)
  if (!response.ok) {
    console.error(`parity check: live snapshot returned HTTP ${response.status} (${liveUrl})`)
    process.exit(2)
  }
  const liveProblems = compare(await response.json(), `live ${liveUrl}`)
  if (liveProblems.length) {
    console.error(`parity check failed against the live host (${liveProblems.length}):\n- ${liveProblems.join('\n- ')}\n` +
      'The host runs the build it was started with — restart it before treating this as a failure.')
    process.exit(1)
  }
  console.log(`parity check: ok against live ${liveUrl}`)
}
