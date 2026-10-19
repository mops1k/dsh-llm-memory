/**
 * Core data model for the layered long-term memory store.
 *
 * The store keeps markdown files as the source of truth and a SQLite/FTS5 index
 * as a derived cache. Entries are partitioned into a per-project layer
 * (`scope: 'project'`) and a cross-project user layer (`scope: 'user'`).
 */
import type { ModelDownloadProgress } from '../infrastructure/model-cache.js'

/** Category of a memory entry. */
export type MemoryKind =
  | 'rules'
  | 'preferences'
  | 'decisions'
  | 'facts'
  | 'architecture'
  | 'concepts'

/** How strongly an entry should resist forgetting. */
export type MemoryTier = 'normal' | 'important' | 'immutable'

/** Lifecycle status of an entry. */
export type MemoryStatus = 'active' | 'superseded' | 'archived'

/** Storage layer an entry belongs to. */
export type MemoryScope = 'project' | 'user'

/** Importance on a 1..5 scale. */
export type MemoryImportance = 1 | 2 | 3 | 4 | 5

export const MEMORY_KINDS: readonly MemoryKind[] = [
  'rules',
  'preferences',
  'decisions',
  'facts',
  'architecture',
  'concepts',
]

export const MEMORY_TIERS: readonly MemoryTier[] = ['normal', 'important', 'immutable']

export const MEMORY_STATUSES: readonly MemoryStatus[] = ['active', 'superseded', 'archived']

export const MEMORY_SCOPES: readonly MemoryScope[] = ['project', 'user']

export const DEFAULT_IMPORTANCE: MemoryImportance = 3

export function isMemoryKind(value: unknown): value is MemoryKind {
  return typeof value === 'string' && (MEMORY_KINDS as readonly string[]).includes(value)
}

export function isMemoryTier(value: unknown): value is MemoryTier {
  return typeof value === 'string' && (MEMORY_TIERS as readonly string[]).includes(value)
}

export function isMemoryStatus(value: unknown): value is MemoryStatus {
  return typeof value === 'string' && (MEMORY_STATUSES as readonly string[]).includes(value)
}

export function isMemoryScope(value: unknown): value is MemoryScope {
  return typeof value === 'string' && (MEMORY_SCOPES as readonly string[]).includes(value)
}

/** Clamp an arbitrary value to a valid importance level. */
export function clampImportance(value: unknown, fallback: MemoryImportance = DEFAULT_IMPORTANCE): MemoryImportance {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  const rounded = Math.round(n)
  if (rounded < 1) return 1
  if (rounded > 5) return 5
  return rounded as MemoryImportance
}

/** A single memory entry. */
export interface MemoryEntry {
  /** Stable id (`m_<hex>`). */
  id: string
  scope: MemoryScope
  /** Project key for `scope: 'project'`; empty for the user layer. */
  project: string
  kind: MemoryKind
  tier: MemoryTier
  status: MemoryStatus
  title: string
  /** Entry body without frontmatter. */
  text: string
  tags: string[]
  /** Extra search terms (word forms/synonyms) for the FTS index. */
  keywords: string
  importance: MemoryImportance
  /** Ids this entry replaces. */
  supersedes: string[]
  /** Ids that replaced this entry. */
  supersededBy: string[]
  related: string[]
  source?: string
  /** External key used for idempotent imports. */
  extKey?: string
  createdAt: string
  updatedAt: string
  confidence?: number
}

/** Partial input accepted by {@link newMemoryEntry}. */
export type MemoryEntryInit = Partial<Omit<MemoryEntry, 'id'>> & { id?: string }

/** Sort modes supported by {@link MemoryFilter}. */
export type MemorySort = 'updated' | 'created' | 'importance' | 'confidence' | 'title'

/** Filter shared by list and search operations. */
export interface MemoryFilter {
  scope?: MemoryScope | 'all'
  project?: string | 'all'
  kind?: MemoryKind | 'all'
  tier?: MemoryTier | 'all'
  status?: MemoryStatus | 'all'
  /** Partial tag match. */
  tag?: string
  limit?: number
  offset?: number
  sort?: MemorySort
}

/** Result of a list/search operation. */
export interface MemoryListResult {
  items: MemoryEntry[]
  /** Number of matching entries ignoring limit/offset. */
  total: number
}

/** Options for {@link MemoryStore.search}. */
export interface MemorySearchOptions {
  query?: string
  filter?: MemoryFilter
}

/** Construction options for {@link MemoryStore}. */
export interface MemoryStoreOptions {
  /** Overrides the resolved storage root (`$DSH_HOME/llm-memory`). */
  storageRoot?: string
  /** Overrides the SQLite index path. */
  dbPath?: string
  /**
   * Default per-base-directory time budget for index passes in milliseconds
   * (0 = no budget). Callers can override it per pass.
   */
  scanBudgetMs?: number
  /**
   * Open the connection with SQLite extension loading enabled.
   *
   * node:sqlite refuses to enable it after the connection exists (measured:
   * "Cannot enable extension loading because it was disabled at database
   * creation"), so the sqlite-vec backend requires this at construction time.
   */
  allowExtension?: boolean
}

/** Edge types of the heuristic knowledge graph. */
export type MemoryEdgeType = 'supersedes' | 'related' | 'contradicts' | 'depends'

export interface MemoryGraphEntity {
  id: string
  kind: MemoryKind
  name: string
  scope: MemoryScope
  project: string
}

export interface MemoryGraphEdge {
  source: string
  target: string
  type: MemoryEdgeType
  weight: number
}

export interface MemoryGraph {
  entities: MemoryGraphEntity[]
  edges: MemoryGraphEdge[]
}

/** Relative weights of the metadata scoring components. */
export interface RankingWeights {
  rel: number
  age: number
  imp: number
  acc: number
  conf: number
  tier: number
  kind: number
  scope: number
}

/** Options accepted by the ranking helpers. */
export interface RankingOptions {
  weights: RankingWeights
  recencyHalfLifeDays: number
  confidenceMin: number
  confidenceDecayHalfLifeDays: number
  /** Smoothing constant for Reciprocal Rank Fusion. */
  rrfK: number
  /**
   * Relative contribution of each rank-fusion leg.
   *
   * Metadata is query-independent, so it carries much less weight than the two
   * relevance legs and acts as a tie-breaker. Measured on a real store
   * (2026-10-15, 40 entries × two query sets, k=5, self-retrieval): at weight
   * 1.0 the metadata leg dominated the ordering — lexical hit@1 was 20 %/12.5 %
   * and hit@5 40 %/35 %; at 0.1 lexical reached 70 % hit@1 and 100 % hit@5, and
   * the hybrid (with vectors) 92.5 % hit@1 at 100 % hit@5.
   */
  fusion: {
    bm25: number
    metadata: number
    vector: number
  }
}

/**
 * Which source produces embeddings for semantic retrieval.
 *
 * `off` disables the vector leg entirely (lexical FTS5 only), `local` runs a
 * multilingual ONNX model in-process and `http` calls an OpenAI-compatible
 * embeddings endpoint.
 */
export type EmbeddingProviderMode = 'off' | 'local' | 'http'

/**
 * Where the chunk vectors live.
 *
 * `js` keeps them in a plain SQLite table and scans them in-process, `sqlite-vec`
 * uses the `vec0` virtual table of the sqlite-vec extension (KNN in SQL).
 */
export type VectorBackend = 'off' | 'js' | 'sqlite-vec'

/**
 * Storage precision of the vectors.
 *
 * `float` keeps full 32-bit precision, `int8` stores one byte per dimension and
 * `bit` one bit per dimension (binary quantization, distances are Hamming-based
 * and need a dimension divisible by 8). Quantization trades recall fidelity for
 * size; only the sqlite-vec backend supports it.
 */
export type VectorQuantization = 'float' | 'int8' | 'bit'

/**
 * Role of a text handed to an embedding model.
 *
 * Asymmetric models (the e5 family) prefix queries and stored passages
 * differently, and mixing the roles up degrades recall.
 */
export type EmbeddingRole = 'query' | 'passage'

/** One batch of embeddings, row-aligned with the texts that produced it. */
export interface EmbeddingBatch {
  /** `vectors[i]` embeds `texts[i]`. */
  vectors: Float32Array[]
  /** Model identifier the vectors were produced with. */
  model: string
  /** Vector length of every returned vector. */
  dim: number
}

/** Produces embeddings for queries and stored passages. */
export interface EmbeddingProvider {
  /** Stable provider id (`local`, `http`, ...) used in logs and stats. */
  readonly id: string
  /** Model identifier stored next to every vector. */
  readonly model: string
  /** Vector length the model produces. */
  readonly dim: number
  /** Whether the model is loaded; `prewarm` makes it true. */
  readonly ready: boolean
  /** Load the model ahead of the first embedding call, best effort. */
  prewarm(): Promise<void>
  /**
   * Drop the loaded model so the next `prewarm`/`embed` reads it from disk
   * again. Needed when the cache is missing or was deleted: an in-memory model
   * makes `prewarm` return without downloading anything.
   */
  reload?(): void
  /**
   * Route model download progress to `listener`, or stop routing with `null`.
   *
   * Only an explicit download turns this on: transformers.js fetches file
   * metadata from the Hub whenever a progress callback is attached, and doing
   * that on every ordinary model load costs a network round trip (or a timeout)
   * even when the model is already cached.
   */
  watchProgress?(listener: ((progress: ModelDownloadProgress) => void) | null): void
  /** Embed a batch of texts in the given role. */
  embed(texts: string[], role: EmbeddingRole): Promise<EmbeddingBatch>
  /** Release resources (a worker thread, for example). */
  close?(): void
}

/** One indexed chunk of a memory entry. */
export interface VectorRecord {
  entryId: string
  /** Zero-based chunk position inside the entry. */
  chunkIndex: number
  /** Metadata copied from the entry so a backend can filter without a join. */
  scope: MemoryScope
  project: string
  kind: MemoryKind
  tier: MemoryTier
  status: MemoryStatus
  /** Hash of the embedded text plus model id; a change means re-embedding. */
  hash: string
  /** Normalized embedding of the chunk. */
  vector: Float32Array
}

/** A vector search request. */
export interface VectorQuery {
  /** Normalized query embedding. */
  vector: Float32Array
  /** Maximum number of chunk hits to return. */
  limit: number
  /** Restricts hits by entry metadata; only scope/project/kind/tier/status are used. */
  filter?: MemoryFilter
  /** Restricts hits to chunks of these entries (entry-level retrieval path). */
  entryIds?: readonly string[]
  /** Minimum cosine similarity; lower-scoring hits are dropped. */
  minScore?: number
}

/** One vector search hit. */
export interface VectorMatch {
  entryId: string
  chunkIndex: number
  /** Cosine similarity in -1..1, higher is closer. */
  score: number
}

/** Counters reported by a vector index. */
export interface VectorIndexStats {
  backend: VectorBackend
  /** Indexed chunks. */
  chunks: number
  /** Distinct entries with at least one chunk. */
  entries: number
  /** Model the stored vectors were produced with (empty when there are none). */
  model: string
  dim: number
  /** Approximate size of the stored vectors in bytes. */
  bytes: number
}

/** Nearest-neighbour index over entry chunks. */
export interface VectorIndex {
  readonly backend: VectorBackend
  /** Number of indexed chunks. */
  size(): number
  /** Insert or replace chunks. */
  upsert(records: readonly VectorRecord[]): void
  /** Drop every chunk of one entry. */
  remove(entryId: string): void
  /** Drop every stored vector; with `model`, only the vectors of other models. */
  clear(model?: string): void
  /**
   * Chunk hashes stored for one entry, keyed by chunk index. The queue compares
   * them with freshly computed hashes to skip unchanged chunks.
   */
  storedHashes(entryId: string): Map<number, string>
  /**
   * Mean vector of every entry's chunks, normalized — the entry-level embedding
   * used by the knowledge graph and the duplicate report, where there is no
   * query to search with.
   */
  entryVectors(filter?: MemoryFilter): Map<string, Float32Array>
  /** Nearest chunks for a query, best first. */
  search(query: VectorQuery): VectorMatch[]
  /**
   * Number of stored chunks per entry. The semantic map draws it as the point
   * size, and the duplicate report uses it as a weight.
   */
  chunkCounts(filter?: MemoryFilter): Map<string, number>
  /**
   * Stored chunks with their vectors, optionally restricted to some entries. The
   * embedding queue reads them to refresh the metadata copy of an entry without
   * embedding its text again.
   */
  records(entryIds?: readonly string[]): VectorRecord[]
  /**
   * Reads the whole table once and reports what lies there, without comparing it
   * to the pages — the engine owns that comparison. Used by the heal audit.
   */
  audit(): VectorAudit
  /**
   * Rebuilds the derived ANN table from the stored vectors. A no-op for
   * backends that answer from `memory_vectors` directly (the in-process scan).
   */
  rebuildAnn(): void
  /** Counters for the settings UI and logs. */
  stats(): VectorIndexStats
}

/** Per-entry facts of the vector table, before any comparison with the pages. */
export interface VectorAuditEntry {
  /** Model this entry's rows were written with. */
  model: string
  /** Stored chunks of this entry. */
  chunks: number
  /** Chunk positions present; a gap means a partial write. */
  chunkIndexes: number[]
  scope: MemoryScope
  project: string
  kind: MemoryKind
  tier: MemoryTier
  status: MemoryStatus
  /** Chunks of this index's model whose vector length differs from `dim`. */
  badDim: number
  /** Chunks whose vector is all zeros, NaN or infinite — unusable for search. */
  broken: number
}

/** Raw state of the vector table. */
export interface VectorAudit {
  entries: Map<string, VectorAuditEntry>
  /** Every model found in the table; anything but `model` is a leftover. */
  models: string[]
  /** Model this index works with. */
  model: string
  dim: number
}

/** One entry placed on the semantic map. */
export interface VectorMapPoint {
  id: string
  /** Short title, for the tooltip; the full entry is fetched on click. */
  title: string
  /** Coordinates on the two leading principal directions. */
  x: number
  y: number
  kind: MemoryKind
  project: string
  scope: MemoryScope
  tier: MemoryTier
  status: MemoryStatus
  /** Indexed chunks of this entry. */
  chunks: number
}

/**
 * Two-dimensional projection of every indexed entry — the "semantic map" of the
 * UI. Coordinates are unitless: only relative distances mean anything.
 */
export interface VectorMap {
  model: string
  dim: number
  backend: VectorBackend
  entries: number
  chunks: number
  /** Share of the total variance on each axis, 0..1. */
  explained: [number, number]
  points: VectorMapPoint[]
  /** True when the coordinates came from the cache instead of a fresh build. */
  cached: boolean
}

/** Where a query lands on the map, with the entries closest to it. */
export interface VectorMapQuery {
  x: number
  y: number
  model: string
  hits: Array<{ id: string; score: number }>
}
