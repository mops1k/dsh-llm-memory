/**
 * Indexing benchmark for the markdown memory store.
 *
 * Measures, per storage base directory, what the plugin actually pays when it
 * walks the wiki:
 *
 *   1. listing  — `listMarkdownFiles` for every `<baseDir>/<kind>` directory;
 *   2. stat     — one `statSync` per page (`mtimeMs`), the lower bound of an
 *                 incremental reconcile that skips unchanged pages;
 *   3. read     — `readFileSync` per page, i.e. what a full rebuild costs;
 *   4. full     — `readAllPages()` as used by `reindexFromDisk()`;
 *   5. decode   — `decodePage()` over the pages read in step 4;
 *   6. reconcile— `MemoryStore.reconcileFromDisk()` when it exists (incremental
 *                 path), against a *copy* of the database so the live index is
 *                 never touched.
 *
 * Usage:
 *   node scripts/bench-index.mjs                 # default storage root
 *   node scripts/bench-index.mjs --root <path>   # explicit storage root
 *   node scripts/bench-index.mjs --json          # machine-readable summary
 *
 * Requires a build (`pnpm run build`): the script drives `lib/`, the artifact
 * the dsh host actually loads.
 *
 * Baseline on the reference store (2026-10-01, 701 pages, WSL host with two
 * `/mnt/c` project roots): listing ~10 ms, stat 896 ms, read 1842 ms,
 * readAllPages ~2.5 s, decode 15-26 ms. Of the stat/read cost, 892 ms / 1709 ms
 * come from the two `/mnt/c` roots — the WSL 9p round-trip, not parsing.
 */
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  DB_DIR,
  DIGEST_DIR,
  USER_DIR,
  fileMtimeMs,
  kindDir,
  listChildDirectories,
  listMarkdownFiles,
  projectMemoryRoot,
  readFileIfExists,
  readProjectsRegistry,
  resolveStorageRoot,
} from '../lib/core/paths.js'
import { decodePage, readAllPages } from '../lib/core/wiki.js'
import { MEMORY_KINDS } from '../lib/core/types.js'

const argv = process.argv.slice(2)
const asJson = argv.includes('--json')
const rootFlag = argv.indexOf('--root')
const root = resolveStorageRoot(rootFlag >= 0 ? argv[rootFlag + 1] : undefined)

if (!existsSync(join(import.meta.dirname, '..', 'lib', 'core', 'store.js'))) {
  console.error('[bench-index] lib/ is missing — run `pnpm run build` first.')
  process.exit(1)
}

const { MemoryStore } = await import('../lib/core/store.js')

/** Run `fn` and return `[result, elapsedMs]`. */
function timed(fn) {
  const start = process.hrtime.bigint()
  const result = fn()
  return [result, Number(process.hrtime.bigint() - start) / 1e6]
}

const registry = readProjectsRegistry(root)
// Same base directories as `readAllPages`: the user layer, every registered
// project tree and the legacy per-project directories under the storage root.
const baseDirs = [
  { dir: join(root, USER_DIR), scope: 'user', project: '' },
  ...Object.entries(registry).map(([key, projectRoot]) => ({
    dir: projectMemoryRoot(projectRoot),
    scope: 'project',
    project: key,
  })),
  ...listChildDirectories(root)
    .filter((name) => name !== DB_DIR && name !== DIGEST_DIR && name !== USER_DIR)
    .filter((name) => !Object.prototype.hasOwnProperty.call(registry, name))
    .map((name) => ({ dir: join(root, name), scope: 'project', project: name })),
]

const rows = []
for (const base of baseDirs) {
  const listing = []
  const [, listingMs] = timed(() => {
    for (const kind of MEMORY_KINDS) listing.push(...listMarkdownFiles(kindDir(base.dir, kind)))
    listing.push(...listMarkdownFiles(base.dir))
  })
  const files = [...new Set(listing)]
  if (files.length === 0) continue

  const [, statMs] = timed(() => {
    for (const file of files) fileMtimeMs(file)
  })
  const [, readMs] = timed(() => {
    for (const file of files) readFileIfExists(file)
  })

  rows.push({ ...base, files: files.length, listingMs, statMs, readMs })
}

const [pages, fullMs] = timed(() => readAllPages(root))
const [, decodeMs] = timed(() => {
  for (const page of pages) decodePage(page)
})

// Incremental path (only when the running build provides it). The database is
// copied first: the bench must not write to the live index.
let reconcileMs = null
let reconcileReport = null
const liveDb = join(root, DB_DIR, 'memory.db')
if (existsSync(liveDb)) {
  const tmp = mkdtempSync(join(tmpdir(), 'dsh-llm-memory-bench-'))
  try {
    copyFileSync(liveDb, join(tmp, 'memory.db'))
    const wal = `${liveDb}-wal`
    if (existsSync(wal)) copyFileSync(wal, join(tmp, 'memory.db-wal'))
    const store = new MemoryStore({ storageRoot: root, dbPath: join(tmp, 'memory.db') })
    try {
      if (typeof store.reconcileFromDisk === 'function') {
        // First pass fills fingerprints missing from an older database (it has
        // to read those pages once); the second is the steady state.
        const [first, firstMs] = timed(() => store.reconcileFromDisk())
        const [steady, steadyMs] = timed(() => store.reconcileFromDisk())
        reconcileMs = steadyMs
        reconcileReport = {
          firstMs: Math.round(firstMs),
          first,
          steadyMs: Math.round(steadyMs),
          steady,
        }
      }
    } finally {
      store.close()
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

const sum = (key) => rows.reduce((acc, row) => acc + row[key], 0)

if (asJson) {
  console.log(
    JSON.stringify(
      {
        root,
        baseDirs: rows,
        totals: {
          files: sum('files'),
          listingMs: sum('listingMs'),
          statMs: sum('statMs'),
          readMs: sum('readMs'),
          readAllPagesMs: fullMs,
          decodeMs,
        },
        reconcile: reconcileMs === null ? null : { ms: reconcileMs, report: reconcileReport },
      },
      null,
      2,
    ),
  )
} else {
  const label = (value) => value.toFixed(value >= 100 ? 0 : 1).padStart(8)
  console.log(`storage root: ${root}\n`)
  console.log(`${'stat'.padStart(8)} ${'read'.padStart(8)} ${'list'.padStart(8)} ${'files'.padStart(5)}  base directory`)
  for (const row of rows) {
    console.log(`${label(row.statMs)} ${label(row.readMs)} ${label(row.listingMs)} ${String(row.files).padStart(5)}  ${row.dir}`)
  }
  console.log(
    `\ntotals: ${sum('files')} files | listing ${sum('listingMs').toFixed(0)} ms | stat ${sum('statMs').toFixed(0)} ms | ` +
      `read ${sum('readMs').toFixed(0)} ms | readAllPages ${fullMs.toFixed(0)} ms | decode ${decodeMs.toFixed(0)} ms`,
  )
  if (reconcileMs !== null) {
    console.log(`reconcileFromDisk: first ${reconcileReport.firstMs} ms ${JSON.stringify(reconcileReport.first)}`)
    console.log(`reconcileFromDisk: steady ${reconcileReport.steadyMs} ms ${JSON.stringify(reconcileReport.steady)}`)
  } else {
    console.log('reconcileFromDisk: not available in this build')
  }
}
