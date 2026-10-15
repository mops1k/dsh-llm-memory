/**
 * Recall benchmark: what the semantic leg adds over lexical search.
 *
 * Runs the same queries twice on one store — once with the vector leg off
 * (FTS5 only) and once with it on — and reports self-retrieval quality, latency
 * and the size of the rendered output.
 *
 * Queries are generated from the store itself, in two flavours:
 *
 *   keywords — the entry's `keywords` field, which by design holds word forms
 *              and synonyms that do NOT appear in the body. FTS5 cannot match
 *              them, so a hit here is the semantic leg doing its job;
 *   title    — the entry title, which the body usually repeats; both legs
 *              should find it, so it serves as a control.
 *
 * The "expected" entry is the entry the query was generated from, so the metric
 * is self-retrieval (hit@1 / hit@k), not human-judged relevance.
 *
 * Run it on a *copy* of the store (the lexical pass still writes nothing, but a
 * benchmark should not touch live data):
 *
 *   node scripts/backfill-vectors.mjs --copy --keep     # prints "copy kept at …"
 *   node scripts/bench-recall.mjs --root /tmp/llm-memory-backfill-XXXX \
 *     --cache ~/.dsh/llm-memory/_models --samples 40
 *
 * Usage:
 *   node scripts/bench-recall.mjs [--root <path>] [--cache <dir>] [--samples <n>]
 *                                 [--k <n>] [--json]
 *
 * Requires a build (`pnpm run build`).
 */
import { existsSync, statSync } from 'node:fs'

const argv = process.argv.slice(2)

function flag(name, fallback) {
  const index = argv.indexOf(`--${name}`)
  return index >= 0 ? argv[index + 1] : fallback
}

const asJson = argv.includes('--json')
const samples = Math.max(1, Number.parseInt(flag('samples', '40'), 10) || 40)
const k = Math.max(1, Number.parseInt(flag('k', '5'), 10) || 5)

const { MemoryEngine } = await import('../lib/core/engine.js')
const { mergeConfig } = await import('../lib/core/config.js')
const { LocalEmbeddingProvider } = await import('../lib/core/embeddings.js')
const { resolveStoragePaths, resolveStorageRoot } = await import('../lib/core/paths.js')

const root = resolveStorageRoot(flag('root', undefined))
const paths = resolveStoragePaths(root)
if (!existsSync(paths.dbPath)) {
  console.error(`no database at ${paths.dbPath}`)
  process.exit(1)
}

const lexical = new MemoryEngine({
  storageRoot: root,
  manualEmbeddings: true,
  config: { embeddings: { provider: 'off' } },
})
const cacheDir = flag('cache', root + '/_models')
const config = mergeConfig({ storageRoot: root })
const semantic = new MemoryEngine({
  storageRoot: root,
  manualEmbeddings: true,
  embeddingProvider: new LocalEmbeddingProvider(config.embeddings, { cacheDir, inline: true }),
  config: { embeddings: { provider: 'local' } },
})

/** Sample active entries that carry both a title and a usable keywords field. */
const entries = lexical
  .list({ status: 'active', limit: 100000 })
  .items.filter((entry) => entry.title.length > 8 && entry.keywords.trim().length > 6)
const step = Math.max(1, Math.floor(entries.length / samples))
const picked = []
for (let index = 0; index < entries.length && picked.length < samples; index += step) picked.push(entries[index])

if (picked.length === 0) {
  console.error('no entries with a keywords field found; nothing to measure')
  process.exit(1)
}

async function measure(engine, query, detail) {
  const started = process.hrtime.bigint()
  const result = await engine.recall(query, { scope: 'all', limit: k, detail })
  const ms = Number(process.hrtime.bigint() - started) / 1e6
  return { ms, ids: result.items.map((item) => item.id), chars: result.text.length }
}

const buckets = {
  keywords: { lexical: [], hybrid: [] },
  title: { lexical: [], hybrid: [] },
}

for (const entry of picked) {
  for (const [flavour, query] of [
    ['keywords', entry.keywords],
    ['title', entry.title],
  ]) {
    const fromLexical = await measure(lexical, query, 'digest')
    const fromHybrid = await measure(semantic, query, 'digest')
    buckets[flavour].lexical.push({ entry, ...fromLexical })
    buckets[flavour].hybrid.push({ entry, ...fromHybrid })
  }
}

/** Hit rates plus latency and output size over one bucket. */
function summarize(rows) {
  const hitAt = (position) => rows.filter((row) => row.ids[position] === row.entry.id).length / rows.length
  const hitIn = rows.filter((row) => row.ids.includes(row.entry.id)).length / rows.length
  return {
    queries: rows.length,
    hitAt1: hitAt(0),
    hitAtK: hitIn,
    avgMs: rows.reduce((sum, row) => sum + row.ms, 0) / rows.length,
    avgChars: rows.reduce((sum, row) => sum + row.chars, 0) / rows.length,
  }
}

const summary = {}
for (const [flavour, pair] of Object.entries(buckets)) {
  summary[flavour] = { lexical: summarize(pair.lexical), hybrid: summarize(pair.hybrid) }
}

// The excerpt mode must not cost more than the digest it replaces.
const example = picked[0]
const digest = await measure(semantic, example.title, 'digest')
const excerpt = await measure(semantic, example.title, 'excerpt')

const graphLexical = lexical.graph().edges.filter((edge) => edge.type === 'related').length
const graphHybrid = semantic.graph().edges.filter((edge) => edge.type === 'related').length
const duplicates = semantic.lintReport().duplicates.length

const report = {
  root,
  samples: picked.length,
  k,
  results: summary,
  excerptVsDigest: { digestChars: digest.chars, excerptChars: excerpt.chars },
  graph: { relatedLexical: graphLexical, relatedHybrid: graphHybrid, duplicateCandidates: duplicates },
  dbBytes: statSync(paths.dbPath).size,
}

if (asJson) {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log(`root: ${root}`)
  console.log(`samples: ${picked.length} entries, k=${k}, scope=all\n`)
  const row = (label, s) =>
    `${label.padEnd(22)} ${(s.hitAt1 * 100).toFixed(1).padStart(6)}% ${(s.hitAtK * 100).toFixed(1).padStart(7)}% ` +
    `${s.avgMs.toFixed(1).padStart(9)}ms ${s.avgChars.toFixed(0).padStart(9)}`
  console.log(`${'query set / leg'.padEnd(22)} ${'hit@1'.padStart(7)} ${'hit@k'.padStart(8)} ${'avg'.padStart(11)} ${'chars'.padStart(9)}`)
  console.log(row('keywords / lexical', summary.keywords.lexical))
  console.log(row('keywords / hybrid', summary.keywords.hybrid))
  console.log(row('title / lexical', summary.title.lexical))
  console.log(row('title / hybrid', summary.title.hybrid))
  console.log(
    `\nexcerpt vs digest on one query: ${report.excerptVsDigest.digestChars} -> ${report.excerptVsDigest.excerptChars} chars`,
  )
  console.log(
    `graph: related edges ${graphLexical} -> ${graphHybrid}, duplicate candidates ${duplicates}`,
  )
  console.log('\nhit@k = expected entry inside the top-k; keywords hold synonyms absent from the body')
}

lexical.close()
semantic.close()
