/**
 * Ranking and lexical-overlap helpers.
 *
 * Ported from the kilo-memory ranking module: a metadata score (relevance,
 * recency, importance, confirmations, confidence, tier, kind, scope), a hybrid
 * BM25 + metadata re-rank via Reciprocal Rank Fusion, a base ranking for
 * rules/preferences injection, and the idf-weighted overlap metric used by
 * wiki graph edges and lint.
 */
import type { MemoryEntry, MemoryScope, RankingOptions, RankingWeights } from './types.js'

const DAY_MS = 24 * 60 * 60 * 1000

/** Default component weights. */
export const DEFAULT_RANKING_WEIGHTS: RankingWeights = {
  rel: 1.0,
  age: 0.4,
  imp: 0.3,
  acc: 0.2,
  conf: 0.35,
  tier: 0.4,
  kind: 0.15,
  scope: 0.25,
}

/** Default ranking options (mirrors the kilo-memory memory defaults). */
export const DEFAULT_RANKING: RankingOptions = {
  weights: { ...DEFAULT_RANKING_WEIGHTS },
  recencyHalfLifeDays: 90,
  confidenceMin: 0.3,
  confidenceDecayHalfLifeDays: 180,
  rrfK: 60,
  // Metadata scoring is query-independent: it orders entries by importance,
  // recency and tier, which is useful when nothing else ranks them, but it
  // should not outvote the lexical and semantic legs on a real query.
  fusion: { bm25: 1, metadata: 0.1, vector: 1 },
}

/** Lowercase tokens used for FTS matching and overlap scoring. */
export function tokenize(text: string): string[] {
  const words = (text ?? '').toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? []
  return [...new Set(words)].filter((word) => word.length > 1)
}

/** Fraction of query terms present in the entry fields (0..1). */
export function relevance(entry: MemoryEntry, terms: string[]): number {
  if (terms.length === 0) return 0
  const haystack = `${entry.title} ${entry.text} ${entry.keywords} ${entry.tags.join(' ')}`.toLowerCase()
  let hit = 0
  for (const term of terms) {
    if (haystack.includes(term)) hit++
  }
  return hit / terms.length
}

/** Exponential recency decay: 0.5 after `halfLifeDays`. */
export function recencyFactor(updatedAt: string, halfLifeDays: number): number {
  const ageMs = Date.now() - new Date(updatedAt).getTime()
  const ageDays = ageMs / DAY_MS
  if (!Number.isFinite(ageDays) || ageDays <= 0) return 1
  return Math.pow(0.5, ageDays / Math.max(1, halfLifeDays))
}

/** Effective confidence with decay towards `confidenceMin`. */
export function confidenceFactor(confidence: number, updatedAt: string, options: RankingOptions): number {
  const half = options.confidenceDecayHalfLifeDays
  const min = options.confidenceMin
  const ageMs = Date.now() - new Date(updatedAt).getTime()
  const ageDays = ageMs / DAY_MS
  const decay = !Number.isFinite(ageDays) || ageDays <= 0 ? 1 : Math.pow(0.5, ageDays / Math.max(1, half))
  return min + Math.max(0, confidence - min) * decay
}

/** Full metadata score of an entry. */
export function computeScore(
  entry: MemoryEntry,
  terms: string[],
  options: RankingOptions = DEFAULT_RANKING,
  preferScope?: MemoryScope | 'all',
): number {
  const weights = options.weights
  const rel = relevance(entry, terms)
  const recency = recencyFactor(entry.updatedAt, options.recencyHalfLifeDays)
  const importance = entry.importance / 5
  // The current entry model has no access counter yet; the weight is reserved.
  const access = 0
  const confidence = confidenceFactor(entry.confidence ?? 0.5, entry.updatedAt, options)
  const tier = entry.tier === 'immutable' ? 1 : entry.tier === 'important' ? 0.6 : 0
  const kind = entry.kind === 'rules' || entry.kind === 'preferences' ? 1 : 0
  let scope = 0
  if (preferScope && preferScope !== 'all' && entry.scope === preferScope) scope = 1

  return (
    weights.rel * rel +
    weights.age * recency +
    weights.imp * importance +
    weights.acc * access +
    weights.conf * confidence +
    weights.tier * tier +
    weights.kind * kind +
    weights.scope * scope
  )
}

/** Sort entries by metadata score (descending). */
export function rankItems(
  items: MemoryEntry[],
  query: string,
  options: RankingOptions = DEFAULT_RANKING,
  preferScope: MemoryScope | 'all' = 'all',
): MemoryEntry[] {
  const terms = tokenize(query)
  return [...items].sort((a, b) => computeScore(b, terms, options, preferScope) - computeScore(a, terms, options, preferScope))
}

/**
 * Hybrid re-rank: BM25 (from FTS5) fused with metadata scoring using
 * Reciprocal Rank Fusion.
 *
 * `vectorRanks` adds the semantic leg: cosine similarity of the query against
 * entry chunks, higher is closer. A leg that is missing for an entry simply
 * does not contribute to its fused score.
 */
export function rankItemsHybrid(
  items: MemoryEntry[],
  query: string,
  options: RankingOptions = DEFAULT_RANKING,
  preferScope: MemoryScope | 'all',
  bm25Ranks: Map<string, number>,
  vectorRanks?: Map<string, number>,
): MemoryEntry[] {
  return rankItemsHybridDetailed(items, query, options, preferScope, bm25Ranks, vectorRanks).items
}

/** Which retrieval leg brought an entry in, and where it stood in that leg. */
export interface RankProvenance {
  /** 0-based position in the lexical ranking, when the entry is a lexical hit. */
  bm25?: number
  /** 0-based position in the metadata ranking; every candidate has one. */
  metadata: number
  /** 0-based position in the vector ranking, when the entry is a semantic hit. */
  vector?: number
  /** Fused RRF score the final order is sorted by. */
  score: number
}

export interface HybridRanking {
  items: MemoryEntry[]
  /** Legs and positions per entry id — what makes a hit explainable in the UI. */
  provenance: Map<string, RankProvenance>
}

/**
 * {@link rankItemsHybrid} plus the provenance of every entry: which legs pulled
 * it in and at which position. The order is identical to the plain function.
 */
export function rankItemsHybridDetailed(
  items: MemoryEntry[],
  query: string,
  options: RankingOptions = DEFAULT_RANKING,
  preferScope: MemoryScope | 'all',
  bm25Ranks: Map<string, number>,
  vectorRanks?: Map<string, number>,
): HybridRanking {
  const byBm25 = [...items].sort((a, b) => (bm25Ranks.get(b.id) ?? 0) - (bm25Ranks.get(a.id) ?? 0))
  const byMeta = [...items].sort(
    (a, b) => computeScore(b, [], options, preferScope) - computeScore(a, [], options, preferScope),
  )
  const byVector = vectorRanks
    ? [...items].sort((a, b) => (vectorRanks.get(b.id) ?? 0) - (vectorRanks.get(a.id) ?? 0))
    : []
  void query
  const posBm25 = new Map(byBm25.map((item, index) => [item.id, index]))
  const posMeta = new Map(byMeta.map((item, index) => [item.id, index]))
  const posVector = new Map(byVector.map((item, index) => [item.id, index]))
  const fusion = options.fusion ?? { bm25: 1, metadata: 1, vector: 1 }
  const rrf = (item: MemoryEntry): number => {
    let score = 0
    const a = posBm25.get(item.id)
    if (a !== undefined && bm25Ranks.has(item.id)) score += (fusion.bm25 ?? 1) / (options.rrfK + a + 1)
    const b = posMeta.get(item.id)
    if (b !== undefined) score += (fusion.metadata ?? 1) / (options.rrfK + b + 1)
    const c = posVector.get(item.id)
    if (c !== undefined && vectorRanks?.has(item.id)) score += (fusion.vector ?? 1) / (options.rrfK + c + 1)
    return score
  }
  const scores = new Map(items.map((item) => [item.id, rrf(item)]))
  const provenance = new Map<string, RankProvenance>()
  for (const item of items) {
    const lexical = posBm25.get(item.id)
    const semantic = posVector.get(item.id)
    provenance.set(item.id, {
      ...(lexical !== undefined && bm25Ranks.has(item.id) ? { bm25: lexical } : {}),
      metadata: posMeta.get(item.id) ?? 0,
      ...(semantic !== undefined && vectorRanks?.has(item.id) ? { vector: semantic } : {}),
      score: scores.get(item.id) ?? 0,
    })
  }
  return { items: [...items].sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0)), provenance }
}

/** Two entries linked by vector similarity. */
export interface SemanticPair {
  left: string
  right: string
  /** Cosine similarity of the entry vectors (0..1 for e5-style embeddings). */
  score: number
}

/**
 * Neighbours from entry vectors: every entry keeps its `perEntry` closest
 * others, and the strongest `maxPairs` pairs survive overall.
 *
 * The cut is relative on purpose. e5 cosine is compressed — two unrelated
 * memories still score around 0.7 while a related pair scores around 0.9 — so an
 * absolute threshold would either link every entry or none, and a top-N rule
 * adapts to the store instead. Cost is O(n²·dim); at ~1000 entries that is a
 * fraction of a second, and the graph is built on demand only.
 */
export function semanticPairs(
  vectors: ReadonlyMap<string, Float32Array>,
  options: { perEntry?: number; maxPairs?: number; minScore?: number } = {},
): SemanticPair[] {
  const perEntry = Math.max(1, Math.floor(options.perEntry ?? 3))
  const maxPairs = Math.max(1, Math.floor(options.maxPairs ?? 300))
  const minScore = options.minScore ?? 0
  const ids = [...vectors.keys()].sort()
  if (ids.length < 2) return []

  const pairs = new Map<string, SemanticPair>()
  const scored: Array<{ id: string; score: number }> = []
  for (let i = 0; i < ids.length; i++) {
    const left = ids[i]!
    const leftVector = vectors.get(left)!
    scored.length = 0
    for (let j = 0; j < ids.length; j++) {
      if (i === j) continue
      const right = ids[j]!
      const rightVector = vectors.get(right)!
      if (rightVector.length !== leftVector.length) continue
      let score = 0
      for (let index = 0; index < leftVector.length; index++) score += leftVector[index]! * rightVector[index]!
      if (score < minScore) continue
      scored.push({ id: right, score })
    }
    scored.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    for (const candidate of scored.slice(0, perEntry)) {
      const [first, second] = left < candidate.id ? [left, candidate.id] : [candidate.id, left]
      const key = `${first}|${second}`
      const previous = pairs.get(key)
      if (!previous || previous.score < candidate.score) {
        pairs.set(key, { left: first, right: second, score: candidate.score })
      }
    }
  }
  return [...pairs.values()].sort((a, b) => b.score - a.score || a.left.localeCompare(b.left)).slice(0, maxPairs)
}

/**
 * Base ranking for injection: active rules/preferences ordered by tier,
 * importance and recency (no query relevance involved).
 */export function rankRulesBase(items: MemoryEntry[], options: RankingOptions = DEFAULT_RANKING): MemoryEntry[] {
  const weights = options.weights
  const score = (entry: MemoryEntry): number =>
    weights.age * recencyFactor(entry.updatedAt, options.recencyHalfLifeDays) +
    weights.imp * (entry.importance / 5) +
    weights.tier * (entry.tier === 'immutable' ? 1 : entry.tier === 'important' ? 0.6 : 0)
  return [...items].sort((a, b) => score(b) - score(a))
}

export interface OverlapPair {
  a: MemoryEntry
  b: MemoryEntry
  common: number
  score: number
}

export interface OverlapOptions {
  /** Minimum number of significant common words. */
  minCommonWords: number
  /** Minimum idf-weighted overlap (0..1). */
  minScore: number
  /** Terms appearing in more than this fraction of entries are ignored. */
  maxDfRatio?: number
}

/**
 * Pairs of entries with a significant lexical overlap.
 *
 * Only significant words (document frequency <= `maxDfRatio`) are compared and
 * the measure is idf-weighted overlap: `sum(idf(common)) / min(sum(idf(A)),
 * sum(idf(B)))`. This removes noise from frequent service words.
 */
export function significantOverlapPairs(items: MemoryEntry[], options: OverlapOptions): OverlapPair[] {
  const maxDfRatio = options.maxDfRatio ?? 0.25
  const termsOf = new Map<string, Set<string>>()
  const df = new Map<string, number>()
  for (const entry of items) {
    const terms = new Set(tokenize(`${entry.title} ${entry.text} ${entry.keywords} ${entry.tags.join(' ')}`))
    termsOf.set(entry.id, terms)
    for (const term of terms) df.set(term, (df.get(term) ?? 0) + 1)
  }
  const n = Math.max(1, items.length)
  const maxDf = Math.max(2, Math.ceil(maxDfRatio * n))
  const idf = (term: string): number => Math.log(n / (df.get(term) ?? 1))

  const significant = items.map((entry) => {
    const set = new Set<string>()
    let sum = 0
    for (const term of termsOf.get(entry.id) ?? []) {
      if ((df.get(term) ?? 0) <= maxDf) {
        set.add(term)
        sum += idf(term)
      }
    }
    return { entry, set, sum }
  })

  const out: OverlapPair[] = []
  for (let i = 0; i < significant.length; i++) {
    const a = significant[i]
    if (!a) continue
    for (let j = i + 1; j < significant.length; j++) {
      const b = significant[j]
      if (!b) continue
      const small = a.set.size <= b.set.size ? a.set : b.set
      const big = a.set.size <= b.set.size ? b.set : a.set
      let common = 0
      let commonIdf = 0
      for (const term of small) {
        if (big.has(term)) {
          common++
          commonIdf += idf(term)
        }
      }
      if (common < options.minCommonWords) continue
      const score = commonIdf / (Math.min(a.sum, b.sum) || 1)
      if (score >= options.minScore) out.push({ a: a.entry, b: b.entry, common, score })
    }
  }
  out.sort((x, y) => y.score - x.score)
  return out
}
