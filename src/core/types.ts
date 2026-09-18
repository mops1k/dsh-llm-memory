/**
 * Core data model for the layered long-term memory store.
 *
 * The store keeps markdown files as the source of truth and a SQLite/FTS5 index
 * as a derived cache. Entries are partitioned into a per-project layer
 * (`scope: 'project'`) and a cross-project user layer (`scope: 'user'`).
 */

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
}
