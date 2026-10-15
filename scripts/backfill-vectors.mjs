/**
 * Backfill chunk vectors for an existing memory store.
 *
 * Entries created before the vector leg existed — or before the embedding model
 * changed — have no rows in `memory_vectors`. This script embeds them once: it
 * walks the store, embeds only the chunks whose hash is missing or stale, and is
 * idempotent, so a second run over an unchanged store embeds nothing.
 *
 * The count of embedded chunks is reported per slice so a long backfill (~1000
 * pages is a few minutes at ~220 ms per page on CPU) shows progress.
 *
 * Usage:
 *   node scripts/backfill-vectors.mjs                    # default storage root
 *   node scripts/backfill-vectors.mjs --root <path>      # explicit storage root
 *   node scripts/backfill-vectors.mjs --copy            # work on a copy of the DB
 *   node scripts/backfill-vectors.mjs --copy --keep     # keep the copy (bench data)
 *   node scripts/backfill-vectors.mjs --cache <dir>      # model cache directory
 *   node scripts/backfill-vectors.mjs --slice <n>        # entries per progress slice
 *   node scripts/backfill-vectors.mjs --limit <n>        # first n entries only
 *   node scripts/backfill-vectors.mjs --json             # machine-readable summary
 *
 * `--copy` snapshots the SQLite files into a temporary root first: use it to
 * measure or rehearse a backfill without touching the live index. A live store
 * should be backfilled while no dsh process holds it open (the plugin also fills
 * the vectors itself in the background once it runs with vectors enabled).
 *
 * Requires a build (`pnpm run build`): the script drives `lib/`, the artifact the
 * dsh host actually loads.
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'

const argv = process.argv.slice(2)

function flag(name, fallback) {
  const index = argv.indexOf(`--${name}`)
  return index >= 0 ? argv[index + 1] : fallback
}

const asJson = argv.includes('--json')
const useCopy = argv.includes('--copy')
const keepCopy = argv.includes('--keep')
const limit = Number.parseInt(flag('limit', '0'), 10) || 0
const sliceSize = Math.max(1, Number.parseInt(flag('slice', '25'), 10) || 25)
const cacheFlag = flag('cache', undefined)

const { MemoryEngine } = await import('../lib/core/engine.js')
const { mergeConfig } = await import('../lib/core/config.js')
const { LocalEmbeddingProvider } = await import('../lib/core/embeddings.js')
const { resolveStoragePaths, resolveStorageRoot } = await import('../lib/core/paths.js')

const liveRoot = resolveStorageRoot(flag('root', undefined))
const livePaths = resolveStoragePaths(liveRoot)
if (!existsSync(livePaths.dbPath)) {
  console.error(`no memory database at ${livePaths.dbPath} (run the plugin once, or pass --root)`)
  process.exit(1)
}

/** Copy the SQLite files (main, WAL, SHM) so the live index is never touched. */
function snapshotDb(source, targetRoot) {
  const target = resolveStoragePaths(targetRoot).dbPath
  mkdirSync(dirname(target), { recursive: true })
  for (const suffix of ['', '-wal', '-shm']) {
    const from = `${source}${suffix}`
    if (existsSync(from)) copyFileSync(from, `${target}${suffix}`)
  }
  return target
}

let root = liveRoot
let tempRoot = null
let dbPath = livePaths.dbPath

if (useCopy) {
  tempRoot = mkdtempSync(join(tmpdir(), 'llm-memory-backfill-'))
  dbPath = snapshotDb(livePaths.dbPath, tempRoot)
  root = tempRoot
}

const config = mergeConfig({ storageRoot: root })
const cacheDir = cacheFlag ?? join(root, '_models')
const provider = new LocalEmbeddingProvider(config.embeddings, { cacheDir, inline: true })
const engine = new MemoryEngine({
  storageRoot: root,
  manualEmbeddings: true,
  embeddingProvider: provider,
  config: { embeddings: { provider: 'local' } },
})

const sizeBefore = statSync(dbPath).size
const started = Date.now()

try {
  const allIds = engine.getStore().allIds()
  const ids = limit > 0 ? allIds.slice(0, limit) : allIds
  if (!asJson) {
    console.log(`storage root: ${useCopy ? `${root} (copy of ${liveRoot})` : root}`)
    console.log(`model: ${provider.model} (${provider.dim} dimensions), cache ${cacheDir}`)
    console.log(`entries: ${ids.length}${limit > 0 ? ` of ${allIds.length}` : ''}, slice ${sliceSize}\n`)
  }

  await provider.prewarm()
  const loadMs = Date.now() - started
  if (!asJson) console.log(`model ready in ${(loadMs / 1000).toFixed(1)} s\n`)

  let done = 0
  for (let start = 0; start < ids.length; start += sliceSize) {
    const slice = ids.slice(start, start + sliceSize)
    await engine.embedPending(slice)
    done += slice.length
    const status = engine.vectorStatus()
    const elapsed = (Date.now() - started) / 1000
    const rate = done / Math.max(0.001, elapsed)
    const eta = rate > 0 ? (ids.length - done) / rate : 0
    if (!asJson) {
      console.log(
        `${String(done).padStart(5)}/${ids.length} entries  ` +
          `chunks ${String(status?.chunks ?? 0).padStart(5)}  ` +
          `${elapsed.toFixed(1)}s  ${rate.toFixed(1)} entries/s  eta ${eta.toFixed(0)}s` +
          `${status?.lastError ? `  lastError: ${status.lastError}` : ''}`,
      )
    }
  }

  const status = engine.vectorStatus()
  const seconds = (Date.now() - started) / 1000
  const sizeAfter = statSync(dbPath).size
  const summary = {
    root: liveRoot,
    copied: useCopy,
    copyRoot: useCopy ? root : null,
    model: provider.model,
    dim: provider.dim,
    entries: ids.length,
    indexedEntries: status?.entries ?? 0,
    chunks: status?.chunks ?? 0,
    vectorBytes: status?.bytes ?? 0,
    seconds: Number(seconds.toFixed(1)),
    entriesPerSecond: Number((ids.length / Math.max(0.001, seconds)).toFixed(1)),
    dbBytesBefore: sizeBefore,
    dbBytesAfter: sizeAfter,
    dbBytesGrowth: sizeAfter - sizeBefore,
    lastError: status?.lastError ?? null,
  }
  if (asJson) console.log(JSON.stringify(summary, null, 2))
  else {
    console.log(
      `\ndone in ${seconds.toFixed(1)} s: ${summary.indexedEntries} entries, ${summary.chunks} chunks, ` +
        `${(summary.vectorBytes / 1024 / 1024).toFixed(2)} MB of vectors; ` +
        `database ${basename(dbPath)} ${(summary.dbBytesBefore / 1024 / 1024).toFixed(2)} -> ` +
        `${(summary.dbBytesAfter / 1024 / 1024).toFixed(2)} MB (+${(summary.dbBytesGrowth / 1024).toFixed(0)} kB)`,
    )
    if (summary.lastError) console.error(`last error: ${summary.lastError}`)
  }
  process.exitCode = summary.lastError ? 1 : 0
} finally {
  engine.close()
  if (tempRoot && !keepCopy) rmSync(tempRoot, { recursive: true, force: true })
  if (tempRoot && keepCopy && !asJson) console.log(`copy kept at ${tempRoot}`)
}
