#!/usr/bin/env node
/**
 * Memory health snapshot.
 *
 * One call for the routine self-check: page counts, the vector index state, the
 * model cache and the drift between the vector table and the pages. Prints a
 * compact summary (or JSON) and, with `--save`, appends the snapshot to
 * `.dsh/health/snapshots.jsonl` and shows the delta against the previous one —
 * that is how slow drift becomes visible instead of anecdotal.
 *
 *   node scripts/health.mjs                 # summary against the running server
 *   node scripts/health.mjs --save          # append and compare with the last run
 *   node scripts/health.mjs --json          # raw snapshot only
 *   node scripts/health.mjs --base http://127.0.0.1:3080/llm-memory
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(here, '..')
const snapshotFile = join(projectRoot, '.dsh', 'health', 'snapshots.jsonl')

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback
}
const base = flag('--base', 'http://127.0.0.1:3080/llm-memory').replace(/\/$/, '')
const wantJson = args.includes('--json')
const wantSave = args.includes('--save')

/** GET a route; a missing route (older plugin) is data, not a failure. */
async function get(path) {
  try {
    const response = await fetch(`${base}${path}`, { headers: { Accept: 'application/json' } })
    if (response.status === 404) return { missing: true }
    if (!response.ok) return { error: `HTTP ${response.status}` }
    return await response.json()
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

const status = await get('/api/status')
const model = await get('/api/model/status')
const health = await get('/api/vectors/health')

const snapshot = {
  at: new Date().toISOString(),
  entries: status.total ?? null,
  active: status.active ?? (status.byStatus ? (status.byStatus.active ?? 0) : null),
  superseded: status.byStatus ? (status.byStatus.superseded ?? 0) : null,
  dbBytes: status.dbSizeBytes ?? null,
  vectors: status.vectors ?? null,
  model: model.missing
    ? 'n/a'
    : {
        cached: model.cached ?? null,
        files: model.files ?? null,
        bytes: model.bytes ?? null,
        downloading: model.downloading ?? null,
        error: model.error ?? null,
      },
  drift: health.missing ? 'n/a' : (health.health ?? null),
}

if (wantJson) {
  process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`)
} else {
  const vectors = snapshot.vectors || {}
  const drift = snapshot.drift && snapshot.drift !== 'n/a' ? snapshot.drift : null
  const lines = [
    `memory:   ${snapshot.entries ?? '?'} entries (${snapshot.active ?? '?'} active, ${snapshot.superseded ?? '?'} superseded), db ${(Number(snapshot.dbBytes || 0) / 1048576).toFixed(1)} MB`,
    `vectors:  ${vectors.chunks ?? '?'} chunks / ${vectors.entries ?? '?'} entries, ${(Number(vectors.bytes || 0) / 1048576).toFixed(1)} MB, ` +
      `backend ${vectors.backend ?? '?'}, pending ${vectors.pending ?? '?'}, lastError ${vectors.lastError ?? 'none'}`,
    `model:    ${typeof snapshot.model === 'string' ? snapshot.model : `cached ${snapshot.model.cached}, ${snapshot.model.files} files, ${(Number(snapshot.model.bytes || 0) / 1048576).toFixed(1)} MB${snapshot.model.error ? `, error ${snapshot.model.error}` : ''}`}`,
    drift
      ? `drift:    checked ${drift.checked}, orphans ${drift.orphans.length}, stale metadata ${drift.metadataStale.length}, ` +
        `missing ${drift.missing.length}, partial ${drift.partial.length}, foreign ${drift.foreign.length}, ` +
        `badDim ${drift.badDim.length}, broken ${drift.broken.length}`
      : 'drift:    n/a (restart the plugin to get /api/vectors/health)',
  ]
  process.stdout.write(`${lines.join('\n')}\n`)
}

if (wantSave) {
  let previous = null
  if (existsSync(snapshotFile)) {
    const lines = readFileSync(snapshotFile, 'utf8').trim().split('\n').filter((line) => line.length > 0)
    const last = lines[lines.length - 1]
    if (last) {
      try {
        previous = JSON.parse(last)
      } catch {
        previous = null
      }
    }
  }
  if (previous) {
    const delta = (current, before) =>
      current === null || before === null || current === undefined || before === undefined
        ? 'n/a'
        : `${Number(current) - Number(before) >= 0 ? '+' : ''}${Number(current) - Number(before)}`
    const previousEntries = previous.total ?? previous.entries
    process.stdout.write(
      `delta:    entries ${delta(snapshot.entries, previousEntries)}, chunks ${delta(snapshot.vectors?.chunks, previous.vectors?.chunks)}, ` +
        `db ${delta(snapshot.dbBytes, previous.dbBytes)} B\n`,
    )
  }
  mkdirSync(dirname(snapshotFile), { recursive: true })
  appendFileSync(snapshotFile, `${JSON.stringify(snapshot)}\n`)
  process.stdout.write(`saved:    ${snapshotFile}\n`)
}
