/**
 * Exact-token benchmark: what the vector leg costs on rare literal tokens.
 *
 * Lexical search (FTS5 + BM25) is exact: if the query is a token that occurs in
 * only one entry, that entry is usually the top hit. The vector leg has no such
 * guarantee — a one-token query carries almost no semantics, while the fusion in
 * `rankItemsHybrid` re-ranks by cosine similarity to it. This script measures how
 * much that costs: the same rare-token queries are run against the same store
 * twice, once with the vector leg off and once with it on, and self-retrieval is
 * compared.
 *
 * Method (identical for both legs, nothing is tuned after seeing results):
 *
 *   sample   — active entries, sorted by id, shuffled with a seeded PRNG
 *              (`--seed`, default 1337); the first `--samples` entries that carry
 *              at least one token of the kind below are used. Entries without
 *              such a token are skipped and counted.
 *   token    — the entry's own `text` split on whitespace/newlines; surrounding
 *              sentence punctuation stripped; kept when length >= 6 and it
 *              contains a digit, `_`, `.`, `-`, or a run of >= 2 uppercase
 *              letters (codes, versions, file names, flags, identifiers). Among
 *              the kept tokens the rarest by document frequency over the whole
 *              corpus is chosen (ties: longer token first, then lexicographic) —
 *              never a token picked because it retrieved well.
 *   query    — that token, verbatim, no quoting or wrapping.
 *   metric   — self-retrieval: did the source entry come back at rank 1 (hit@1)
 *              and anywhere in the top k (hit@k, k=5), with `scope: 'all'` so no
 *              project/status filter beyond `active` is applied.
 *
 * Two token definitions are available because the literal one is coarse:
 *
 *   loose (default) — as above; a glued run such as `src/Foo/Bar.php` is one
 *                     "token", which FTS then splits into several terms.
 *   identifier      — the same, but a chunk is also split on characters outside
 *                     `[A-Za-z0-9_.-]`, so only identifier-like pieces remain.
 *
 * Two declared subsets are reported for both legs alike, without filtering any
 * result: queries the FTS tokenizer turns into exactly one term, and queries
 * whose token occurs in exactly one entry of the corpus (df = 1) — the latter
 * removes ambiguity between entries as an explanation.
 *
 * The live store is never opened: the SQLite file is copied into a fresh
 * `mkdtemp` directory (main + `-wal`/`-shm` when present) and the model cache is
 * symlinked in, because the vector leg needs the real model on disk.
 *
 * Usage:
 *   node scripts/bench-tokens.mjs [--root <path>] [--samples <n>] [--seed <n>]
 *                                 [--k <n>] [--token-mode loose|identifier]
 *                                 [--json] [--dump] [--keep]
 *
 * Requires a build (`pnpm run build`).
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'

const argv = process.argv.slice(2)

function flag(name, fallback) {
  const index = argv.indexOf(`--${name}`)
  return index >= 0 ? argv[index + 1] : fallback
}

const asJson = argv.includes('--json')
const dumpRows = argv.includes('--dump')
const keepCopy = argv.includes('--keep')
const samples = Math.max(1, Number.parseInt(flag('samples', '50'), 10) || 50)
const seed = Number.parseInt(flag('seed', '1337'), 10) || 1337
const k = Math.max(1, Number.parseInt(flag('k', '5'), 10) || 5)
/**
 * `loose` (default) keeps every whitespace token that passes the criteria, so a
 * glued run like `src/Foo/Bar.php` counts. `identifier` additionally requires the
 * token to consist only of `[A-Za-z0-9_.-]`, i.e. to be a single identifier-like
 * token. The second mode is a sensitivity check, not the primary method.
 */
const tokenMode = flag('token-mode', 'loose')

const { MemoryEngine } = await import('../lib/core/engine.js')
const { mergeConfig } = await import('../lib/core/config.js')
const { LocalEmbeddingProvider } = await import('../lib/core/embeddings.js')
const { resolveStoragePaths, resolveStorageRoot } = await import('../lib/core/paths.js')

const liveRoot = resolveStorageRoot(flag('root', undefined))
const livePaths = resolveStoragePaths(liveRoot)
if (!existsSync(livePaths.dbPath)) {
  console.error(`no database at ${livePaths.dbPath}`)
  process.exit(1)
}

/** Size + mtime of the live database, to prove afterwards that it was untouched. */
const fingerprint = (path) => {
  const stats = statSync(path)
  return { bytes: stats.size, mtimeMs: stats.mtimeMs, mtime: stats.mtime.toISOString() }
}
const liveBefore = fingerprint(livePaths.dbPath)

// --- copy: database only, model cache symlinked ---------------------------------
const tempRoot = mkdtempSync(join(tmpdir(), 'llm-memory-tokens-'))
const tempDbPath = resolveStoragePaths(tempRoot).dbPath
mkdirSync(dirname(tempDbPath), { recursive: true })
for (const suffix of ['', '-wal', '-shm']) {
  const from = `${livePaths.dbPath}${suffix}`
  if (existsSync(from)) copyFileSync(from, `${tempDbPath}${suffix}`)
}

const cacheDir = join(tempRoot, '_models')
const modelDir = join(liveRoot, '_models')
let modelVisible = false
if (existsSync(modelDir)) {
  symlinkSync(modelDir, cacheDir, 'dir')
  modelVisible = existsSync(join(cacheDir, 'Xenova', 'multilingual-e5-small', 'config.json'))
}
if (!modelVisible) {
  cleanup()
  console.error(
    `model not visible through the copy: expected ${join(cacheDir, 'Xenova', 'multilingual-e5-small', 'config.json')}`,
  )
  process.exit(1)
}

// --- engines: same construction as scripts/bench-recall.mjs ----------------------
const lexical = new MemoryEngine({
  storageRoot: tempRoot,
  manualEmbeddings: true,
  config: { embeddings: { provider: 'off' } },
})
const config = mergeConfig({ storageRoot: tempRoot })
const semantic = new MemoryEngine({
  storageRoot: tempRoot,
  manualEmbeddings: true,
  embeddingProvider: new LocalEmbeddingProvider(config.embeddings, { cacheDir, inline: true }),
  config: { embeddings: { provider: 'local' } },
})

// --- token extraction ------------------------------------------------------------
const EDGE_PUNCTUATION = /^[.,;:!?()[\]{}<>"'`«»|\\/]+|[.,;:!?()[\]{}<>"'`«»|\\/]+$/g
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/
const IDENTIFIER_PIECES = /[A-Za-z0-9_.-]+/g
/** Trim sentence punctuation glued to a token; `-`, `_`, `+`, `=` stay inside. */
const stripEdges = (raw) => raw.replace(EDGE_PUNCTUATION, '')
/** Codes, versions, file names, flags, identifiers — not ordinary words. */
const looksExact = (token) =>
  token.length >= 6 && (/[0-9]/.test(token) || /[_\-.]/.test(token) || /[A-Z]{2,}/.test(token))
/** Same normalisation the ranking module applies before FTS: word-ish pieces > 1 char. */
const ftsTerms = (text) => [...new Set((text ?? '').toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? [])].filter((word) => word.length > 1)

/**
 * Whitespace chunks of a text, edge-trimmed. In `identifier` mode a chunk is
 * split further on characters outside `[A-Za-z0-9_.-]`, so `src/Foo.php,`
 * yields `src` and `Foo.php`.
 */
function chunksOf(text) {
  const out = []
  for (const raw of (text ?? '').split(/\s+/)) {
    const chunk = stripEdges(raw)
    if (tokenMode === 'identifier') out.push(...(chunk.match(IDENTIFIER_PIECES) ?? []))
    else out.push(chunk)
  }
  return out
}

/** Candidate exact tokens, in first-appearance order, without duplicates. */
function exactTokens(text) {
  const out = []
  const seen = new Set()
  for (const token of chunksOf(text)) {
    if (!looksExact(token) || seen.has(token)) continue
    if (tokenMode === 'identifier' && !IDENTIFIER.test(token)) continue
    seen.add(token)
    out.push(token)
  }
  return out
}

/** Seeded PRNG (mulberry32) — the sample must be reproducible. */
function mulberry32(state) {
  let a = state >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Shuffle a copy of `items` with a seeded Fisher–Yates. */
function seededShuffle(items, seedValue) {
  const random = mulberry32(seedValue)
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// --- sample and pick the rarest token per entry ---------------------------------
const all = lexical.list({ limit: 100000 }).items
const active = all
  .filter((entry) => entry.status === 'active')
  .sort((a, b) => a.id.localeCompare(b.id))
if (active.length === 0) {
  cleanup()
  console.error('no active entries in the copy; nothing to measure')
  process.exit(1)
}

// Document frequency over every entry in the copy, as whitespace tokens of the
// searchable fields, lowercased (the same normalisation FTS applies).
const df = new Map()
for (const entry of all) {
  const haystack = `${entry.title} ${entry.text} ${entry.keywords} ${entry.tags.join(' ')}`
  for (const token of new Set(chunksOf(haystack).map((item) => item.toLowerCase()))) {
    if (!token) continue
    df.set(token, (df.get(token) ?? 0) + 1)
  }
}

const shuffled = seededShuffle(active, seed)
const queries = []
let skipped = 0
for (const entry of shuffled) {
  if (queries.length >= samples) break
  const tokens = exactTokens(entry.text)
  if (tokens.length === 0) {
    skipped++
    continue
  }
  const rarest = tokens
    .map((token) => ({ token, count: df.get(token.toLowerCase()) ?? 0 }))
    .sort((a, b) => a.count - b.count || b.token.length - a.token.length || a.token.localeCompare(b.token))[0]
  queries.push({ entry, token: rarest.token, df: rarest.count })
}

if (queries.length === 0) {
  cleanup()
  console.error('no entry in the sample carried an exact token; nothing to measure')
  process.exit(1)
}

// --- measurement -----------------------------------------------------------------
async function measure(engine, query, detail = 'digest') {
  const started = process.hrtime.bigint()
  const result = await engine.recall(query, { scope: 'all', limit: k, detail })
  const ms = Number(process.hrtime.bigint() - started) / 1e6
  return { ms, ids: result.items.map((item) => item.id) }
}

// Prove the vector leg is actually alive before trusting the hybrid numbers:
// the model must have loaded (no error, not disabled) and the index must hold
// the chunks of the copy.
await semantic.recall(queries[0].token, { scope: 'all', limit: k, detail: 'digest' })
const vectorStatus = semantic.vectorStatus()
const lexicalStatus = lexical.vectorStatus()
const vectorReady =
  vectorStatus !== null &&
  vectorStatus.lastError === null &&
  !vectorStatus.disabled &&
  vectorStatus.chunks > 0 &&
  semantic.vectorsMap() !== null
if (!vectorReady) {
  cleanup()
  console.error(
    `vector leg did not come up (status: ${JSON.stringify(vectorStatus)}); hybrid numbers would be meaningless`,
  )
  process.exit(1)
}
if (lexicalStatus) {
  cleanup()
  console.error('the lexical engine unexpectedly has a vector leg; the comparison would be invalid')
  process.exit(1)
}

const rows = []
for (const query of queries) {
  const fromLexical = await measure(lexical, query.token)
  const fromHybrid = await measure(semantic, query.token)
  const terms = ftsTerms(query.token)
  rows.push({
    id: query.entry.id,
    token: query.token,
    df: query.df,
    terms: terms.length,
    lexical: {
      hit1: fromLexical.ids[0] === query.entry.id,
      hitK: fromLexical.ids.includes(query.entry.id),
      rank: fromLexical.ids.indexOf(query.entry.id) + 1 || null,
      ms: fromLexical.ms,
    },
    hybrid: {
      hit1: fromHybrid.ids[0] === query.entry.id,
      hitK: fromHybrid.ids.includes(query.entry.id),
      rank: fromHybrid.ids.indexOf(query.entry.id) + 1 || null,
      ms: fromHybrid.ms,
    },
  })
}

function summarize(key, selected = rows) {
  if (selected.length === 0) return { queries: 0, hit1: 0, hitK: 0, avgMs: 0, avgRank: null }
  const hit1 = selected.filter((row) => row[key].hit1).length / selected.length
  const hitK = selected.filter((row) => row[key].hitK).length / selected.length
  const avgMs = selected.reduce((sum, row) => sum + row[key].ms, 0) / selected.length
  const ranks = selected.map((row) => row[key].rank).filter((rank) => rank !== null)
  const avgRank = ranks.length > 0 ? ranks.reduce((sum, rank) => sum + rank, 0) / ranks.length : null
  return { queries: selected.length, hit1, hitK, avgMs, avgRank }
}

const lexicalSummary = summarize('lexical')
const hybridSummary = summarize('hybrid')
// Declared subset, not a filter on results: queries the FTS tokenizer turns into
// exactly one term, i.e. the ones that really are a single exact token for the
// lexical leg. Reported for both legs alike.
const singleTermRows = rows.filter((row) => row.terms === 1)
const lexicalSingle = summarize('lexical', singleTermRows)
const hybridSingle = summarize('hybrid', singleTermRows)
// Second declared subset: tokens that occur in exactly one entry of the corpus,
// so ambiguity between entries cannot explain the outcome. Same rule for both legs.
const uniqueRows = rows.filter((row) => row.df === 1)
const lexicalUnique = summarize('lexical', uniqueRows)
const hybridUnique = summarize('hybrid', uniqueRows)
const percent = (value) => Math.round(value * 1000) / 10

const examples = rows.slice(0, 8).map((row) => ({
  token: row.token,
  df: row.df,
  terms: row.terms,
  lexical: row.lexical.hit1 ? 'hit@1' : row.lexical.hitK ? `hit@${k}` : 'miss',
  hybrid: row.hybrid.hit1 ? 'hit@1' : row.hybrid.hitK ? `hit@${k}` : 'miss',
}))

const liveAfter = fingerprint(livePaths.dbPath)
const unchanged =
  liveBefore.bytes === liveAfter.bytes &&
  liveBefore.mtimeMs === liveAfter.mtimeMs

const report = {
  root: liveRoot,
  copyRoot: tempRoot,
  modelVisible,
  tokenMode,
  corpus: { entries: all.length, active: active.length },
  sample: { requested: samples, queries: rows.length, skipped, seed, k },
  vectors: { hybrid: vectorStatus, lexical: null },
  hit: {
    lexical: { hit1: percent(lexicalSummary.hit1), hitK: percent(lexicalSummary.hitK) },
    hybrid: { hit1: percent(hybridSummary.hit1), hitK: percent(hybridSummary.hitK) },
    deltaHit1: percent(lexicalSummary.hit1 - hybridSummary.hit1),
    deltaHitK: percent(lexicalSummary.hitK - hybridSummary.hitK),
  },
  singleTermSubset: {
    queries: singleTermRows.length,
    lexical: { hit1: percent(lexicalSingle.hit1), hitK: percent(lexicalSingle.hitK) },
    hybrid: { hit1: percent(hybridSingle.hit1), hitK: percent(hybridSingle.hitK) },
    deltaHit1: percent(lexicalSingle.hit1 - hybridSingle.hit1),
    deltaHitK: percent(lexicalSingle.hitK - hybridSingle.hitK),
  },
  uniqueTokenSubset: {
    queries: uniqueRows.length,
    lexical: { hit1: percent(lexicalUnique.hit1), hitK: percent(lexicalUnique.hitK) },
    hybrid: { hit1: percent(hybridUnique.hit1), hitK: percent(hybridUnique.hitK) },
    deltaHit1: percent(lexicalUnique.hit1 - hybridUnique.hit1),
    deltaHitK: percent(lexicalUnique.hitK - hybridUnique.hitK),
  },
  avgMs: { lexical: Math.round(lexicalSummary.avgMs * 10) / 10, hybrid: Math.round(hybridSummary.avgMs * 10) / 10 },
  avgRankOfSource: {
    lexical: lexicalSummary.avgRank === null ? null : Math.round(lexicalSummary.avgRank * 100) / 100,
    hybrid: hybridSummary.avgRank === null ? null : Math.round(hybridSummary.avgRank * 100) / 100,
  },
  examples,
  liveDb: { before: liveBefore, after: liveAfter, unchanged },
  ...(dumpRows ? { queries: rows } : {}),
}

if (asJson) {
  console.log(JSON.stringify(report, null, 2))
} else {
  const pct = (value) => `${value.toFixed(1).padStart(6)}%`
  console.log(`root (live): ${liveRoot}`)
  console.log(`copy:        ${tempRoot}`)
  console.log(`corpus:      ${all.length} entries (${active.length} active), model visible: ${modelVisible}`)
  console.log(
    `sample:      ${rows.length} queries from ${samples} requested, ${skipped} entries skipped, seed=${seed}, k=${k}, token-mode=${tokenMode}\n`,
  )
  console.log(`${'leg'.padEnd(10)} ${'hit@1'.padStart(7)} ${`hit@${k}`.padStart(8)} ${'avg'.padStart(10)} ${'avg rank'.padStart(9)}`)
  const line = (label, summary) =>
    `${label.padEnd(10)} ${pct(summary.hit1 * 100)} ${pct(summary.hitK * 100)} ${summary.avgMs.toFixed(1).padStart(8)}ms ` +
    `${(summary.avgRank === null ? '-' : summary.avgRank.toFixed(2)).padStart(9)}`
  console.log(line('lexical', lexicalSummary))
  console.log(line('hybrid', hybridSummary))
  console.log(
    `\ndelta (lexical - hybrid): hit@1 ${report.hit.deltaHit1 >= 0 ? '+' : ''}${report.hit.deltaHit1.toFixed(1)} pp, ` +
      `hit@${k} ${report.hit.deltaHitK >= 0 ? '+' : ''}${report.hit.deltaHitK.toFixed(1)} pp`,
  )
  console.log(
    `single-term subset (${singleTermRows.length} of ${rows.length} queries): ` +
      `lexical hit@1 ${(lexicalSingle.hit1 * 100).toFixed(1)}%, hit@${k} ${(lexicalSingle.hitK * 100).toFixed(1)}% ` +
      `| hybrid hit@1 ${(hybridSingle.hit1 * 100).toFixed(1)}%, hit@${k} ${(hybridSingle.hitK * 100).toFixed(1)}%`,
  )
  console.log(
    `unique-token subset, df=1 (${uniqueRows.length} of ${rows.length} queries): ` +
      `lexical hit@1 ${(lexicalUnique.hit1 * 100).toFixed(1)}%, hit@${k} ${(lexicalUnique.hitK * 100).toFixed(1)}% ` +
      `| hybrid hit@1 ${(hybridUnique.hit1 * 100).toFixed(1)}%, hit@${k} ${(hybridUnique.hitK * 100).toFixed(1)}%`,
  )
  console.log('\nexamples (first 8 queries in sample order):')
  console.log(`${'token'.padEnd(38)} ${'df'.padStart(4)} ${'terms'.padStart(5)} ${'lexical'.padStart(8)} ${'hybrid'.padStart(8)}`)
  for (const example of examples) {
    console.log(
      `${example.token.padEnd(38)} ${String(example.df).padStart(4)} ${String(example.terms).padStart(5)} ` +
        `${example.lexical.padStart(8)} ${example.hybrid.padStart(8)}`,
    )
  }
  console.log(
    `\nlive db: ${liveBefore.bytes} bytes, mtime ${liveBefore.mtime} -> ${liveAfter.bytes} bytes, mtime ${liveAfter.mtime}: ${unchanged ? 'UNCHANGED' : 'CHANGED!'}`,
  )
}

lexical.close()
semantic.close()
if (!keepCopy) cleanup()

function cleanup() {
  // Only ever remove the directory this script created under the OS temp dir.
  if (!basename(tempRoot).startsWith('llm-memory-tokens-')) return
  rmSync(tempRoot, { recursive: true, force: true })
}
