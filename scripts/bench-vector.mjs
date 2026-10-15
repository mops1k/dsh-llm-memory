/**
 * Vector backend benchmark.
 *
 * Compares the in-process cosine scan against the sqlite-vec `vec0` backend at
 * `float`, `int8` and `bit` precision on a real store: how long each backend
 * takes to come up over the existing vector cache, how long a KNN query takes,
 * how much room its vectors occupy and how closely the quantized backends agree
 * with the full-precision in-process baseline.
 *
 * The script reads the vectors already stored in `memory_vectors`, so no
 * embedding model is involved — but the database must have been vectorized
 * first, and it is expected to be a copy, not the live store:
 *
 *   node scripts/backfill-vectors.mjs --copy --keep     # prints "copy kept at …"
 *   node scripts/bench-vector.mjs --root /tmp/llm-memory-backfill-XXXX
 *
 * Usage:
 *   node scripts/bench-vector.mjs [--root <path>] [--queries <n>] [--k <n>]
 *                                 [--model <id>] [--json]
 *
 * Requires a build (`pnpm run build`): the script drives `lib/`.
 */
import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const argv = process.argv.slice(2)

function flag(name, fallback) {
  const index = argv.indexOf(`--${name}`)
  return index >= 0 ? argv[index + 1] : fallback
}

const asJson = argv.includes('--json')
const queryCount = Math.max(1, Number.parseInt(flag('queries', '200'), 10) || 200)
const k = Math.max(1, Number.parseInt(flag('k', '10'), 10) || 10)

const { resolveStoragePaths, resolveStorageRoot } = await import('../lib/core/paths.js')
const { createVectorIndex, SqliteVecIndex } = await import('../lib/core/vector-index.js')

const root = resolveStorageRoot(flag('root', undefined))
const paths = resolveStoragePaths(root)
if (!existsSync(paths.dbPath)) {
  console.error(`no database at ${paths.dbPath}`)
  process.exit(1)
}

const db = new DatabaseSync(paths.dbPath, { allowExtension: true })

/** Model to benchmark: the one with the most cached vectors, unless overridden. */
function resolveModel() {
  const explicit = flag('model', undefined)
  if (explicit) return explicit
  const row = db
    .prepare('SELECT model, COUNT(*) AS count FROM memory_vectors GROUP BY model ORDER BY count DESC')
    .get()
  return row ? String(row.model) : ''
}

const model = resolveModel()
const dimRow = db.prepare('SELECT dim FROM memory_vectors WHERE model = ? LIMIT 1').get(model)
const dim = dimRow ? Number(dimRow.dim) : 0
const countRow = db.prepare('SELECT COUNT(*) AS count FROM memory_vectors WHERE model = ?').get(model)
const chunks = countRow ? Number(countRow.count) : 0

if (chunks === 0 || dim === 0) {
  console.error(
    `no vectors for model "${model}" in ${paths.dbPath}.\n` +
      'Vectorize a copy first: node scripts/backfill-vectors.mjs --copy --keep',
  )
  process.exit(1)
}

/** Query vectors sampled from the cache, so no model call is needed. */
const queries = []
const step = Math.max(1, Math.floor(chunks / queryCount))
const rows = db.prepare('SELECT vector FROM memory_vectors WHERE model = ?').all(model)
for (let index = 0; index < rows.length && queries.length < queryCount; index += step) {
  const bytes = rows[index].vector
  queries.push(new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 4)))
}

/** Bytes stored in the derived vec0 table, or null when it does not exist. */
function vectorBytes() {
  try {
    const row = db.prepare('SELECT COALESCE(SUM(LENGTH(embedding)), 0) AS bytes FROM memory_vec').get()
    return row ? Number(row.bytes) : null
  } catch {
    return null
  }
}

function hitList(index, query) {
  return index.search({ vector: query, limit: k }).map((match) => `${match.entryId}#${match.chunkIndex}`)
}

const cacheRow = db
  .prepare('SELECT COALESCE(SUM(LENGTH(vector)), 0) AS bytes FROM memory_vectors WHERE model = ?')
  .get(model)

const results = []
let baseline = null

for (const spec of [
  { name: 'js', backend: 'js' },
  { name: 'sqlite-vec float', backend: 'sqlite-vec', quantization: 'float' },
  { name: 'sqlite-vec int8', backend: 'sqlite-vec', quantization: 'int8' },
  { name: 'sqlite-vec bit', backend: 'sqlite-vec', quantization: 'bit' },
]) {
  const started = process.hrtime.bigint()
  const index = createVectorIndex(spec.backend, {
    db,
    model,
    dim,
    debug: (message) => {
      if (!asJson) console.log(`   ${message}`)
    },
    ...(spec.quantization ? { quantization: spec.quantization } : {}),
  })
  const startupMs = Number(process.hrtime.bigint() - started) / 1e6
  if (!index) continue

  const durations = []
  const hits = []
  for (const query of queries) {
    const startedQuery = process.hrtime.bigint()
    hits.push(hitList(index, query))
    durations.push(Number(process.hrtime.bigint() - startedQuery) / 1e6)
  }
  durations.sort((a, b) => a - b)
  if (!baseline) baseline = hits

  let shared = 0
  let total = 0
  hits.forEach((ids, position) => {
    const reference = baseline[position] ?? []
    const set = new Set(ids)
    shared += reference.filter((id) => set.has(id)).length
    total += reference.length
  })

  results.push({
    name: spec.name,
    backend: index.backend,
    quantization: index instanceof SqliteVecIndex ? index.quantization : 'float',
    startupMs,
    avgMs: durations.reduce((sum, value) => sum + value, 0) / durations.length,
    p95Ms: durations[Math.min(durations.length - 1, Math.floor(durations.length * 0.95))],
    agreement: total > 0 ? shared / total : 1,
    vectorBytes: spec.backend === 'sqlite-vec' ? vectorBytes() : null,
  })
}

const summary = {
  root,
  model,
  dim,
  chunks,
  queries: queries.length,
  k,
  cacheBytes: Number(cacheRow ? cacheRow.bytes : 0),
  results,
}

if (asJson) {
  console.log(JSON.stringify(summary, null, 2))
} else {
  console.log(`root: ${root}`)
  console.log(`model: ${model} (${dim} dimensions), ${chunks} chunks, ${queries.length} queries, k=${k}`)
  console.log(`canonical cache (memory_vectors): ${(summary.cacheBytes / 1024 / 1024).toFixed(2)} MB\n`)
  console.log(
    `${'backend'.padEnd(18)} ${'startup'.padStart(10)} ${'avg'.padStart(10)} ${'p95'.padStart(10)} ${'agree'.padStart(7)} ${'vectors'.padStart(10)}`,
  )
  for (const row of results) {
    console.log(
      `${row.name.padEnd(18)} ${(`${row.startupMs.toFixed(1)}ms`).padStart(10)} ${(`${row.avgMs.toFixed(3)}ms`).padStart(10)} ` +
        `${(`${row.p95Ms.toFixed(3)}ms`).padStart(10)} ${(`${(row.agreement * 100).toFixed(1)}%`).padStart(7)} ` +
        `${(row.vectorBytes === null ? '-' : `${(row.vectorBytes / 1024 / 1024).toFixed(2)} MB`).padStart(10)}`,
    )
  }
  console.log('\nagreement = share of the top-k chunks also returned by the in-process scan')
}

db.close()
