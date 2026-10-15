/**
 * Memory engine: the operation layer on top of {@link MemoryStore}.
 *
 * It owns the resolved configuration and the per-session project key, and
 * implements the lifecycle operations (save / update / forget / delete / recall
 * / status / lint / graph / import) plus the prompt guidance helper. Markdown
 * pages remain the source of truth; the store is the derived FTS5 index.
 *
 * Adapted from the kilo-memory engine, but reduced to the layered model:
 * `scope: 'project'` is keyed by a project slug and `scope: 'user'` is a single
 * cross-project layer.
 */
import { statSync } from 'node:fs'
import { join } from 'node:path'

import { mergeConfig, type MemoryConfig, type RecallScope, type RulesPromptScope } from './config.js'
import { entryChunks } from './chunks.js'
import { EmbeddingQueue, type EmbeddingQueueStatus } from './embed-queue.js'
import { createEmbeddingProvider } from './embeddings.js'
import {
  removeModelCache,
  scanModelCache,
  sweepModelTempFiles,
  type ModelCacheStatus,
  type ModelDownloadProgress,
} from './model-cache.js'
import { appendLog, debug } from './log.js'
import { sanitizeProjectKey } from './paths.js'
import { DEFAULT_RANKING, rankItems, rankItemsHybrid, rankRulesBase, semanticPairs, significantOverlapPairs } from './ranking.js'
import type { SemanticPair } from './ranking.js'
import { MemoryStore, genMemoryId, newMemoryEntry } from './store.js'
import { buildGraph } from './wiki.js'
import {
  buildExternalIdMap,
  remapRelationIds,
  sameImportedEntry,
  type ExternalIdResolution,
} from './import/common.js'
import type {
  EmbeddingProvider,
  MemoryEntry,
  MemoryFilter,
  MemoryGraph,
  MemoryImportance,
  MemoryKind,
  MemoryListResult,
  MemoryScope,
  MemoryStatus,
  MemoryTier,
  VectorIndex,
} from './types.js'
import { clampImportance } from './types.js'

/** Output format of `recall`. */
export type RecallFormat = 'markdown' | 'table' | 'timeline' | 'json'

/**
 * Body detail of `recall`: `digest` (default) returns a short excerpt of every
 * entry, `full` returns complete bodies, `excerpt` returns the passage that the
 * vector leg actually matched. Recall output becomes part of the request history
 * for the rest of the session, so the digest stays the default.
 */
export type RecallDetail = 'digest' | 'full' | 'excerpt'

/** Number of significant common words required for a lint overlap pair. */
const LINT_OVERLAP_MIN_SCORE = 0.45

/** Age in days after which an active entry is reported as stale by lint. */
const LINT_STALE_DAYS = 180

/** Share of semantic pairs reported as near-duplicate candidates by lint. */
const DUPLICATE_QUANTILE = 0.02

/** Hard cap on the duplicate candidates one lint report returns. */
const LINT_MAX_DUPLICATES = 25

/** Construction options of {@link MemoryEngine}. */
export interface MemoryEngineOptions {
  /** Explicit storage root; defaults to `$DSH_HOME/llm-memory` / `~/.dsh/llm-memory`. */
  storageRoot?: string
  /** Project key for `scope: 'project'` entries (usually the workspace basename). */
  project?: string
  /** Explicit `key -> absolute project root` overrides (highest priority). */
  projectRoots?: Record<string, string>
  /**
   * Fallback resolver for a project key when neither the explicit overrides nor
   * `projects.json` know the root (e.g. a workspace registry lookup).
   */
  resolveProjectRoot?: (key: string) => string | null | undefined
  /** Partial configuration merged over the defaults. */
  config?: Partial<MemoryConfig>
  /**
   * Embedding provider to use instead of building one from the configuration
   * (tests inject an in-process provider; the plugin uses the worker-backed one).
   */
  embeddingProvider?: EmbeddingProvider
  /**
   * Drive the embedding queue by hand instead of letting it run in the
   * background; tests use it to make a pass deterministic.
   */
  manualEmbeddings?: boolean
}

/** Per-call overrides for the rules/preferences digest of the system prompt. */
export interface RulesPromptOptions {
  /** Project key of the calling session; `undefined` means unknown. */
  project?: string
  /** Explicit project reach, overriding `config.rulesPromptScope`. */
  scope?: RulesPromptScope
}

/** Input accepted by {@link MemoryEngine.save}. */
export interface SaveInput {
  text: string
  title?: string
  scope?: MemoryScope
  project?: string
  kind?: MemoryKind
  tier?: MemoryTier
  status?: MemoryStatus
  tags?: string[]
  keywords?: string
  importance?: MemoryImportance
  confidence?: number
  /** Ids this entry replaces; those entries become `superseded`. */
  supersedes?: string[]
  related?: string[]
  source?: string
  /** External key used for idempotent imports. */
  extKey?: string
  createdAt?: string
  updatedAt?: string
}

/** Editable fields accepted by {@link MemoryEngine.update}. */
export interface UpdatePatch {
  title?: string
  text?: string
  kind?: MemoryKind
  tier?: MemoryTier
  status?: MemoryStatus
  tags?: string[]
  keywords?: string
  importance?: MemoryImportance
  confidence?: number
  supersedes?: string[]
  supersededBy?: string[]
  related?: string[]
}

/** Result of {@link MemoryEngine.forget}. */
export interface ForgetResult {
  ok: boolean
  message: string
  entry?: MemoryEntry
}

/** Options of {@link MemoryEngine.recall}. */
export interface RecallOptions {
  scope?: MemoryScope | 'all'
  project?: string | 'all'
  kind?: MemoryKind | 'all'
  tier?: MemoryTier | 'all'
  limit?: number
  format?: RecallFormat
  detail?: RecallDetail
}

/** Result of {@link MemoryEngine.recall}. */
export interface RecallResult {
  items: MemoryEntry[]
  text: string
  format: RecallFormat
}

/** Counters returned by {@link MemoryEngine.statusReport}. */
export interface StatusReport {
  root: string
  dbPath: string
  dbSizeBytes: number
  total: number
  active: number
  byStatus: Record<string, number>
  byScope: Record<string, number>
  byKind: Record<string, number>
  byProject: Record<string, number>
  /** Progress of the vector index; null while the vector leg is off. */
  vectors: EmbeddingQueueStatus | null
}

/** State of the embedding model shown by the settings page. */
export interface ModelStatus extends ModelCacheStatus {
  /** Configured embedding provider (`off`, `local` or the reserved `http`). */
  provider: string
  /** Configured model id. */
  model: string
  /** Whether the settings ask for semantic search at all (provider and backend). */
  configured: boolean
  /** Whether the vector leg is active right now; false also when the model is absent. */
  enabled: boolean
  /** Whether a download is running right now. */
  downloading: boolean
  /** Live download progress, or null when nothing is downloading. */
  progress: ModelDownloadProgress | null
  /** Message of the last failed download, or null. */
  error: string | null
}

/** A link pointing at an entry that does not exist. */
export interface LintBrokenLink {
  id: string
  title: string
  field: 'supersedes' | 'related' | 'supersededBy'
  missingId: string
}

/** A pair of active entries with a significant lexical overlap. */
export interface LintOverlap {
  a: string
  b: string
  aTitle: string
  bTitle: string
  common: number
  score: number
}

/** An active entry that has not been updated for a long time. */
export interface LintStale {
  id: string
  title: string
  updatedAt: string
}

/** Result of {@link MemoryEngine.lintReport}. */
export interface LintReport {
  totalCount: number
  activeCount: number
  brokenLinks: LintBrokenLink[]
  overlaps: LintOverlap[]
  /** Number of overlap pairs hidden by `lintMaxPairs`. */
  overlapsHidden: number
  stale: LintStale[]
  staleDays: number
  /**
   * Near-duplicate candidates from vector similarity: the strongest semantic
   * pairs of active entries, cut relatively (the top few percent of pairs).
   */
  duplicates: LintDuplicate[]
  /** Characters the rules/preferences digest injects into every request. */
  promptDigestChars: number
}

/** A pair of active entries that look like near duplicates. */
export interface LintDuplicate {
  id: string
  title: string
  duplicateId: string
  duplicateTitle: string
  /** Cosine similarity of the entry vectors. */
  score: number
}

/** One entry accepted by {@link MemoryEngine.importEntries}. */
export interface ImportEntry {
  /** Source-unique key used for idempotency (e.g. `kilo:<id>`). */
  extKey: string
  text: string
  title?: string
  scope?: MemoryScope
  project?: string
  kind?: MemoryKind
  tier?: MemoryTier
  status?: MemoryStatus
  tags?: string[]
  keywords?: string
  importance?: MemoryImportance
  confidence?: number
  source?: string
  /** Raw source project root, when the entry came from a foreign store. */
  projectRoot?: string | null
  related?: string[]
  supersedes?: string[]
  supersededBy?: string[]
  createdAt?: string
  updatedAt?: string
}

/** Outcome of {@link MemoryEngine.importEntries}. */
export interface ImportReport {
  source: string
  imported: number
  updated: number
  skipped: number
  /** Relation references dropped because their target was not imported. */
  droppedRelations: number
  ids: string[]
}

/** Result of {@link MemoryEngine.heal}. */
export interface HealReport {
  /** Broken relation references removed from entries. */
  removedLinks: number
  /** Missing reverse links (`supersededBy` / symmetric `related`) added. */
  addedBacklinks: number
  /**
   * Number of entries read back from markdown during the incremental reindex
   * (0 when no page changed on disk).
   */
  reindexed: number
  /** Broken link count before healing. */
  brokenBefore: number
  /** Broken link count after healing. */
  brokenAfter: number
}

function firstLine(text: string, maxLength = 120): string {
  const line = text.split(/\r?\n/, 1)[0]?.trim() ?? ''
  return line.length > maxLength ? `${line.slice(0, maxLength)}…` : line
}

function statusMarkers(entry: MemoryEntry): string {
  const markers: string[] = []
  if (entry.tier === 'immutable') markers.push('[immutable]')
  else if (entry.tier === 'important') markers.push('[important]')
  if (entry.status !== 'active') markers.push(`[${entry.status}]`)
  return markers.length > 0 ? ` ${markers.join(' ')}` : ''
}

/**
 * Cut `text` to `maxChars` characters, appending an ellipsis when something was
 * dropped. A negative budget means "no limit".
 */
function cutText(text: string, maxChars: number): string {
  if (maxChars < 0 || text.length <= maxChars) return text
  return `${text.slice(0, maxChars).trimEnd()}…`
}

/**
 * Render a single entry as a markdown section (English).
 *
 * `textChars` (>= 0) caps the body: recall output stays in the request history
 * for the whole session, so the default rendering shows an excerpt and the
 * model asks for `detail: "full"` when it needs the rest. `bodyOverride` replaces
 * the entry body — the excerpt mode passes the passage the vector leg matched.
 */
export function renderMemoryEntry(entry: MemoryEntry, textChars?: number, bodyOverride?: string): string {
  const lines = [
    `### ${entry.title}${statusMarkers(entry)}`,
    `- id: \`${entry.id}\` · scope: ${entry.scope} · kind: ${entry.kind} · importance: ${entry.importance}/5 · updated: ${entry.updatedAt.slice(0, 10)}`,
    `- tags: ${entry.tags.length > 0 ? entry.tags.join(', ') : '—'}`,
  ]
  if (entry.supersedes.length > 0) lines.push(`- supersedes: ${entry.supersedes.join(', ')}`)
  const source = bodyOverride !== undefined && bodyOverride.length > 0 ? bodyOverride : entry.text
  const body = textChars === undefined ? source : cutText(source, textChars)
  lines.push('', body)
  return lines.join('\n')
}

/** How {@link renderRecall} should bound one rendering. */
export interface RecallRenderOptions {
  /** Body detail: `digest` (default) excerpts every body, `full` keeps it whole. */
  detail?: RecallDetail
  /** Character budget of one entry body in `digest` mode. */
  textChars?: number
  /** Hard character budget of the whole rendering. */
  totalChars?: number
  /**
   * Bodies to use instead of `entry.text`, keyed by entry id. The excerpt mode
   * fills it with the passage the vector leg matched.
   */
  excerpts?: ReadonlyMap<string, string>
}

/**
 * Append the notice that tells the model how to recover cut content.
 *
 * The notice is one line at the end of the rendering instead of a marker per
 * entry: every byte here is re-sent in each later request of the session.
 */
function withTruncationNotice(text: string, detail: RecallDetail, textChars: number, cutEntries: number): string {
  if (cutEntries === 0) return text
  const what = cutEntries === 1 ? '1 entry body was' : `${cutEntries} entry bodies were`
  return `${text}\n\n_[${what} cut to ${textChars} characters. Call llm_memory_recall with detail: "full" to read complete bodies.]_`
}

/** Render a list of entries in the requested output format. */
export function renderRecall(
  items: MemoryEntry[],
  format: RecallFormat = 'markdown',
  options: RecallRenderOptions = {},
): string {
  const detail: RecallDetail = options.detail ?? 'digest'
  const textChars = options.textChars ?? 400
  const confidenceOf = (entry: MemoryEntry): number => Math.round((entry.confidence ?? 0.5) * 1000) / 1000
  let rendered: string
  let cutEntries = 0
  if (format === 'table') {
    const header = ['id', 'scope', 'kind', 'tier', 'importance', 'updated', 'title']
    const rows: string[][] = [header]
    for (const entry of items) {
      rows.push([
        entry.id,
        entry.scope,
        entry.kind,
        entry.tier,
        String(entry.importance),
        entry.updatedAt.slice(0, 10),
        entry.title,
      ])
    }
    const widths = header.map((_, index) => Math.max(...rows.map((row) => (row[index] ?? '').length)))
    const renderRow = (row: string[]): string =>
      `| ${row.map((cell, index) => (cell ?? '').padEnd(widths[index] ?? 0)).join(' | ')} |`
    const separator = `|${widths.map((width) => '-'.repeat(width + 2)).join('|')}|`
    rendered = [renderRow(header), separator, ...rows.slice(1).map(renderRow)].join('\n')
  } else if (format === 'timeline') {
    rendered = [...items]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .map((entry) => `- ${entry.updatedAt.slice(0, 10)} [${entry.scope}/${entry.kind}] ${entry.title} (${entry.id})`)
      .join('\n')
  } else if (format === 'json') {
    rendered = JSON.stringify(
      items.map((entry) => ({
        id: entry.id,
        title: entry.title,
        kind: entry.kind,
        scope: entry.scope,
        project: entry.project,
        tier: entry.tier,
        status: entry.status,
        importance: entry.importance,
        confidence: confidenceOf(entry),
        tags: entry.tags,
        supersedes: entry.supersedes,
        supersededBy: entry.supersededBy,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      })),
      null,
      2,
    )
  } else {
    const bodyBudget = detail === 'full' ? -1 : textChars
    const bodies = items.map((entry) => options.excerpts?.get(entry.id) ?? entry.text)
    cutEntries = bodyBudget < 0 ? 0 : bodies.filter((body) => body.length > bodyBudget).length
    rendered = items
      .map((entry) => renderMemoryEntry(entry, bodyBudget < 0 ? undefined : bodyBudget, options.excerpts?.get(entry.id)))
      .join('\n\n')
    if (options.excerpts !== undefined && options.excerpts.size > 0) {
      rendered += '\n\n_[Entries above show the passage that matched the query; call llm_memory_recall with detail: "full" for complete bodies.]_'
    }
  }
  const total = options.totalChars ?? 0
  const bounded = withTruncationNotice(rendered, detail, textChars, cutEntries)
  if (total > 0 && bounded.length > total) {
    return `${cutText(bounded, total)}\n\n_[Recall output cut to ${total} characters.]_`
  }
  return bounded
}

/**
 * Memory engine bound to one storage root and one project key.
 *
 * The SQLite connection is opened lazily by {@link MemoryStore} on first use.
 * Call {@link MemoryEngine.close} when the instance is no longer needed.
 */
export class MemoryEngine {
  readonly config: MemoryConfig
  readonly project: string
  private readonly store: MemoryStore
  private readonly externalResolver?: (key: string) => string | null | undefined
  private readonly injectedProvider?: EmbeddingProvider
  private readonly manualEmbeddings: boolean
  /** Lazy vector stack: provider, index and the background embedding queue. */
  private vectors: { provider: EmbeddingProvider; index: VectorIndex; queue: EmbeddingQueue } | null = null
  /** Set when the vector leg cannot be built, so it is not retried per call. */
  private vectorUnavailable = false
  /** Provider kept for downloads even while the vector leg is off. */
  private modelProvider: EmbeddingProvider | null = null
  /** The model is configured but not in the cache: the settings page must fetch it. */
  private modelMissing = false
  /** Model cache and download state shown by the settings page. */
  private modelState: {
    downloading: boolean
    progress: ModelDownloadProgress | null
    error: string | null
  } = { downloading: false, progress: null, error: null }
  /** Consecutive failures of the query-embedding path. */
  private vectorFailures = 0

  constructor(options: MemoryEngineOptions = {}) {
    this.config = mergeConfig({
      ...(options.config ?? {}),
      ...(options.storageRoot !== undefined ? { storageRoot: options.storageRoot } : {}),
      ...(options.projectRoots !== undefined ? { projectRoots: options.projectRoots } : {}),
    })
    this.project = sanitizeProjectKey(options.project ?? '')
    this.store = new MemoryStore({
      storageRoot: this.config.storageRoot,
      scanBudgetMs: this.config.projectScanBudgetMs,
      // Loading the extension has to be allowed when the connection is created.
      allowExtension: this.config.embeddings.backend === 'sqlite-vec',
    })
    if (options.resolveProjectRoot) this.externalResolver = options.resolveProjectRoot
    if (options.embeddingProvider) this.injectedProvider = options.embeddingProvider
    this.manualEmbeddings = options.manualEmbeddings === true
  }

  /** Whether the settings (or an injected provider) ask for semantic search. */
  private vectorsConfigured(): boolean {
    if (this.injectedProvider) return true
    const settings = this.config.embeddings
    return settings.provider !== 'off' && settings.backend !== 'off'
  }

  /**
   * Provider for the vector leg and for model downloads.
   *
   * Cached so a download that ran while the vector leg was off (no model in the
   * cache) is reused once the model is there.
   */
  private resolveProvider(): EmbeddingProvider | null {
    if (this.vectors) return this.vectors.provider
    if (this.modelProvider) return this.modelProvider
    const settings = this.config.embeddings
    const provider =
      this.injectedProvider ??
      (settings.provider === 'off' || settings.provider === 'http'
        ? null
        : createEmbeddingProvider(settings, { cacheDir: this.modelCacheDir(), debug }))
    if (provider) this.modelProvider = provider
    return provider
  }

  /**
   * Whether the local model is on disk; a missing one keeps the vector leg off.
   *
   * Downloading it implicitly would block every recall on a 130 MB transfer (and
   * on a restart it would start over), so an explicit download from the settings
   * page is the only path that fetches the model.
   */
  private modelAvailable(provider: EmbeddingProvider): boolean {
    if (!provider.id.startsWith('local')) return true
    return scanModelCache(this.modelCacheDir(), provider.model).cached
  }

  /**
   * Build the vector stack on first use.
   *
   * Every failure path — the optional dependency is missing, the worker cannot
   * start, the settings disable vectors, the model is not downloaded — leaves
   * `vectors` null, so a broken embedding setup degrades to the lexical path
   * instead of breaking recall.
   */
  private ensureVectors(): { provider: EmbeddingProvider; index: VectorIndex; queue: EmbeddingQueue } | null {
    if (this.vectors) return this.vectors
    if (this.vectorUnavailable) return null
    const settings = this.config.embeddings
    if (!this.injectedProvider && (settings.provider === 'off' || settings.backend === 'off')) {
      this.vectorUnavailable = true
      return null
    }
    try {
      const provider = this.resolveProvider()
      if (!provider) {
        this.vectorUnavailable = true
        return null
      }
      if (!this.modelAvailable(provider)) {
        this.modelMissing = true
        debug(
          `embeddings: ${provider.model} is not in the cache; semantic search stays off until it is downloaded from the settings page`,
        )
        return null
      }
      const index = this.store.initVectorIndex({
        model: provider.model,
        dim: provider.dim,
        backend: settings.backend,
        quantization: settings.quantization,
      })
      if (!index) {
        this.vectorUnavailable = true
        return null
      }
      const queue = new EmbeddingQueue({
        store: this.store,
        index,
        provider,
        config: settings,
        debug,
        manual: this.manualEmbeddings,
      })
      this.store.onEntryChanged = (id) => queue.enqueue([id])
      this.vectors = { provider, index, queue }
      if (settings.prewarm && !this.manualEmbeddings) queue.start()
      return this.vectors
    } catch (error) {
      this.vectorUnavailable = true
      debug(`vectors: disabled (${error instanceof Error ? error.message : String(error)})`)
      return null
    }
  }

  /** Start the vector leg in the background (plugin startup); idempotent. */
  startVectors(): void {
    this.ensureVectors()
  }

  /** Progress of the vector index, or null when the vector leg is off. */
  vectorStatus(): EmbeddingQueueStatus | null {
    return this.vectors?.queue.status() ?? null
  }

  /** Directory the embedding model is cached in, inside the memory root. */
  modelCacheDir(): string {
    return join(this.store.root, '_models')
  }

  /**
   * State of the embedding model: what is on disk and whether a download runs.
   *
   * Works even when the vector leg is off: the settings page still has to say
   * what a click on "Download model" would do.
   */
  modelStatus(): ModelStatus {
    const settings = this.config.embeddings
    // Prefer the model the provider actually loads (an injected provider may
    // differ from the configured one in tests).
    const model = this.vectors?.provider.model ?? this.modelProvider?.model ?? settings.model
    const cache = scanModelCache(this.modelCacheDir(), model)
    return {
      provider: settings.provider,
      model,
      configured: this.vectorsConfigured(),
      enabled: this.vectors !== null,
      dir: cache.dir,
      cached: cache.cached,
      files: cache.files,
      bytes: cache.bytes,
      downloading: this.modelState.downloading,
      // Progress belongs to a running download; a plain prewarm of an already
      // cached model would otherwise leave a stale 100 % behind.
      progress: this.modelState.downloading ? this.modelState.progress : null,
      error: this.modelState.error,
    }
  }

  /**
   * Download (and load) the embedding model in the background.
   *
   * `prewarm` runs inside the embedding worker, so the download neither blocks
   * the host nor touches the vector index; progress streams through
   * {@link modelStatus}. Calling it while a download runs is a no-op.
   *
   * @returns The state right after the download was started.
   * @throws when the vector leg is disabled, because nothing would use the model.
   */
  downloadModel(): ModelStatus {
    const settings = this.config.embeddings
    if (!this.vectorsConfigured()) {
      throw new Error(
        'Vector search is disabled: switch the embeddings provider to "local" and the backend away from "off" first.',
      )
    }
    const provider = this.resolveProvider()
    if (!provider) {
      throw new Error('No embedding provider is available; install @huggingface/transformers and retry.')
    }
    if (this.modelState.downloading) return this.modelStatus()

    const model = provider.model
    const cache = scanModelCache(this.modelCacheDir(), model)
    if (!cache.cached) {
      // A model already in memory would make `prewarm` return without fetching
      // anything, and leftovers of a killed download are useless to the loader.
      const swept = sweepModelTempFiles(this.modelCacheDir(), model)
      if (swept.files > 0) {
        debug(`embeddings: removed ${swept.files} partial downloads (${swept.bytes} bytes) of ${model}`)
      }
      provider.reload?.()
      debug(`embeddings: reloading ${model}, the cache is incomplete`)
    }

    this.modelState = { downloading: true, progress: null, error: null }
    provider.watchProgress?.((progress) => {
      this.modelState.progress = progress
    })
    void provider
      .prewarm()
      .then(() => {
        const after = scanModelCache(this.modelCacheDir(), model)
        if (after.cached || !provider.id.startsWith('local')) {
          this.modelState = { downloading: false, progress: null, error: null }
          this.modelMissing = false
          // The model arrived now: let the vector leg come up without a restart.
          this.vectorUnavailable = false
          this.startVectors()
          debug(`embeddings: ${model} is cached and loaded`)
        } else {
          this.modelState = {
            downloading: false,
            progress: null,
            error: `No model files were written to ${after.dir}; check the network and the plugin log.`,
          }
          debug(`embeddings: ${this.modelState.error}`)
        }
      })
      .catch((error: unknown) => {
        this.modelState = {
          downloading: false,
          progress: null,
          error: error instanceof Error ? error.message : String(error),
        }
        debug(`embeddings: model download failed (${this.modelState.error})`)
      })
      .finally(() => {
        provider.watchProgress?.(null)
      })
    return this.modelStatus()
  }

  /**
   * Delete the cached model files (settings action).
   *
   * The next load downloads them again; the vector index itself is untouched.
   *
   * @returns The cache state after the removal.
   */
  removeModel(): ModelStatus {
    const settings = this.config.embeddings
    removeModelCache(this.modelCacheDir(), this.vectors?.provider.model ?? settings.model)
    this.modelState = { downloading: false, progress: null, error: null }
    return this.modelStatus()
  }

  /** Drop the vector cache and queue a full re-embed (settings action). */
  rebuildVectors(): void {
    const vectors = this.ensureVectors()
    if (!vectors) return
    vectors.index.clear()
    vectors.queue.sweep()
  }

  /**
   * Drive the embedding queue to completion (tests, maintenance and the
   * backfill script, which passes one slice of ids at a time to report progress).
   */
  async embedPending(ids?: readonly string[]): Promise<void> {
    const vectors = this.ensureVectors()
    if (!vectors) return
    await vectors.queue.processAll(ids)
  }

  /**
   * Cosine similarity of the query against the indexed chunks, per entry, with
   * the chunk that produced the best score (used by the excerpt mode).
   */
  private async semanticRanks(
    query: string,
    filter: MemoryFilter,
  ): Promise<{ scores: Map<string, number>; chunks: Map<string, number> }> {
    const scores = new Map<string, number>()
    const chunks = new Map<string, number>()
    const text = (query ?? '').trim()
    if (text.length === 0) return { scores, chunks }
    const vectors = this.ensureVectors()
    if (!vectors) return { scores, chunks }
    try {
      const batch = await vectors.provider.embed([text], 'query')
      const vector = batch.vectors[0]
      if (!vector) return { scores, chunks }
      const matches = vectors.index.search({
        vector,
        limit: this.config.embeddings.topK,
        filter,
        minScore: this.config.embeddings.minScore,
      })
      for (const match of matches) {
        const previous = scores.get(match.entryId)
        if (previous === undefined || previous < match.score) {
          scores.set(match.entryId, match.score)
          chunks.set(match.entryId, match.chunkIndex)
        }
      }
      this.vectorFailures = 0
    } catch (error) {
      this.vectorFailures++
      debug(`vectors: query embedding failed (${error instanceof Error ? error.message : String(error)})`)
      if (this.vectorFailures >= 3) {
        this.vectorUnavailable = true
        debug('vectors: disabled after 3 consecutive query failures; lexical search stays active')
      }
    }
    return { scores, chunks }
  }

  /**
   * Register (or update) the absolute root of a project so its markdown pages
   * are stored inside the repository at `<root>/.dsh/llm-memory`.
   */
  registerProject(key: string, root: string): void {
    const projectKey = sanitizeProjectKey(key)
    const value = (root ?? '').trim()
    if (projectKey.length === 0 || value.length === 0) return
    this.store.setProjectRoot(projectKey, value)
  }

  /** Registered `key -> absolute root` map (from `projects.json`). */
  projectRoots(): Record<string, string> {
    return this.store.projectRoots()
  }

  /**
   * Resolve the absolute root of a project key.
   *
   * Priority: explicit `config.projectRoots` override, then the persisted
   * `projects.json` registry, then the optional external resolver. A root found
   * through the resolver is persisted so later calls stay consistent.
   */
  resolveProjectRoot(key: string): string | null {
    const projectKey = sanitizeProjectKey(key)
    if (projectKey.length === 0) return null
    const configured = this.config.projectRoots[projectKey]
    if (typeof configured === 'string' && configured.trim().length > 0) return configured.trim()
    const stored = this.store.getProjectRoot(projectKey)
    if (stored !== null) return stored
    const external = this.externalResolver?.(projectKey)
    if (typeof external === 'string' && external.trim().length > 0) {
      const value = external.trim()
      this.registerProject(projectKey, value)
      return value
    }
    return null
  }

  /** Persist the resolved root of a project before writing its pages. */
  private ensureProjectRoot(key: string): void {
    const root = this.resolveProjectRoot(key)
    if (root !== null) this.registerProject(key, root)
  }

  /** Resolved storage root of the underlying store. */
  get root(): string {
    return this.store.root
  }

  /** Absolute path of the derived SQLite index. */
  get dbPath(): string {
    return this.store.dbPath
  }

  /**
   * The derived SQLite store backing this engine. Exposed for orchestration
   * code that must hand the store to the importers (a second owner of the same
   * database file would break the single-writer contract).
   */
  getStore(): MemoryStore {
    return this.store
  }

  /** Create a new entry, or update the entry that already owns `extKey`. */
  save(input: SaveInput): MemoryEntry {
    const text = (input.text ?? '').trim()
    if (text.length === 0) throw new Error('Memory text must not be empty')

    const scope: MemoryScope = input.scope ?? 'project'
    const project = scope === 'user' ? '' : sanitizeProjectKey(input.project ?? this.project)
    if (scope === 'project') this.ensureProjectRoot(project)
    const existingExt = input.extKey ? this.store.getByExtKey(input.extKey) : null
    const now = new Date().toISOString()

    const entry = newMemoryEntry({
      id: existingExt?.id ?? genMemoryId(),
      scope,
      project,
      kind: input.kind ?? 'facts',
      tier: input.tier ?? 'normal',
      status: input.status ?? 'active',
      title: input.title ?? '',
      text,
      tags: input.tags ?? [],
      keywords: input.keywords ?? '',
      importance: input.importance ?? 3,
      related: input.related ?? [],
      ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
      ...(input.source !== undefined ? { source: input.source } : {}),
      ...(input.extKey !== undefined ? { extKey: input.extKey } : {}),
      createdAt: input.createdAt ?? existingExt?.createdAt,
      updatedAt: input.updatedAt ?? now,
    })

    const supersedes = [...new Set(input.supersedes ?? [])].filter((id) => id.length > 0)
    entry.supersedes = supersedes
    for (const oldId of supersedes) {
      const previous = this.store.get(oldId)
      if (!previous || previous.status !== 'active') continue
      previous.status = 'superseded'
      previous.supersededBy = [...new Set([...previous.supersededBy, entry.id])]
      previous.updatedAt = now
      this.store.upsert(previous)
      appendLog(this.root, 'supersede', previous.title, previous.id)
    }

    const saved = this.store.upsert(entry)
    appendLog(this.root, 'save', saved.title, saved.id)
    return saved
  }

  /** Patch an existing entry; returns null when the id is unknown. */
  update(id: string, patch: UpdatePatch): MemoryEntry | null {
    const entry = this.store.get(id)
    if (!entry) return null
    if (patch.title !== undefined) entry.title = patch.title
    if (patch.text !== undefined) entry.text = patch.text
    if (patch.kind !== undefined) entry.kind = patch.kind
    if (patch.tier !== undefined) entry.tier = patch.tier
    if (patch.status !== undefined) entry.status = patch.status
    if (patch.tags !== undefined) {
      entry.tags = [...new Set(patch.tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0))]
    }
    if (patch.keywords !== undefined) entry.keywords = patch.keywords
    if (patch.importance !== undefined) entry.importance = clampImportance(patch.importance)
    if (patch.confidence !== undefined && Number.isFinite(patch.confidence)) {
      entry.confidence = Math.min(1, Math.max(0, patch.confidence))
    }
    if (patch.supersedes !== undefined) entry.supersedes = [...new Set(patch.supersedes)].filter((value) => value.length > 0)
    if (patch.supersededBy !== undefined) {
      entry.supersededBy = [...new Set(patch.supersededBy)].filter((value) => value.length > 0)
    }
    if (patch.related !== undefined) entry.related = [...new Set(patch.related)].filter((value) => value.length > 0)
    entry.updatedAt = new Date().toISOString()
    const saved = this.store.upsert(entry)
    appendLog(this.root, 'update', saved.title, saved.id)
    return saved
  }

  /**
   * Forget an entry: it is not deleted, but marked `superseded` so it stops
   * appearing in recall. Matches the kilo-memory semantics of `forget`.
   */
  forget(id: string): ForgetResult {
    const entry = this.store.get(id)
    if (!entry) return { ok: false, message: `Memory entry not found: ${id}` }
    if (entry.status !== 'active') {
      return { ok: true, message: `Memory entry "${entry.title}" is already inactive (${entry.status}).`, entry }
    }
    entry.status = 'superseded'
    entry.updatedAt = new Date().toISOString()
    const saved = this.store.upsert(entry)
    appendLog(this.root, 'forget', saved.title, saved.id)
    return { ok: true, message: `Memory entry "${saved.title}" (${saved.id}) marked as forgotten (superseded).`, entry: saved }
  }

  /** Permanently delete an entry, its page and any references to it. */
  delete(id: string): boolean {
    const entry = this.store.get(id)
    if (!entry) return false
    const now = new Date().toISOString()
    for (const other of this.store.list({ status: 'all' }).items) {
      if (other.id === id) continue
      const supersedes = other.supersedes.filter((value) => value !== id)
      const supersededBy = other.supersededBy.filter((value) => value !== id)
      const related = other.related.filter((value) => value !== id)
      if (
        supersedes.length === other.supersedes.length &&
        supersededBy.length === other.supersededBy.length &&
        related.length === other.related.length
      ) {
        continue
      }
      other.supersedes = supersedes
      other.supersededBy = supersededBy
      other.related = related
      other.updatedAt = now
      this.store.upsert(other)
    }
    const removed = this.store.delete(id)
    if (removed) appendLog(this.root, 'delete', entry.title, entry.id)
    return removed
  }

  /** Fetch an entry by id (any status). */
  get(id: string): MemoryEntry | null {
    return this.store.get(id)
  }

  /** List entries matching a filter (any status unless filtered). */
  list(filter: MemoryFilter = {}): MemoryListResult {
    return this.store.list(filter)
  }

  /**
   * Search active entries and rank them; returns the items and their rendering.
   *
   * Asynchronous because the vector leg embeds the query; the lexical and
   * metadata parts stay synchronous behind it, and a missing or failing vector
   * leg simply contributes nothing to the fusion.
   */
  async recall(query = '', options: RecallOptions = {}): Promise<RecallResult> {
    const scope: RecallScope = options.scope ?? this.config.recallScope
    const format: RecallFormat = options.format ?? 'markdown'
    const detail: RecallDetail = options.detail ?? 'digest'
    const limit = Math.max(1, options.limit ?? this.config.recallLimit)
    const text = (query ?? '').trim()

    const base: MemoryFilter = { status: 'active' }
    if (options.kind && options.kind !== 'all') base.kind = options.kind
    if (options.tier && options.tier !== 'all') base.tier = options.tier

    // The project layer means the calling session's project PLUS the
    // cross-project user layer, so user-wide rules and preferences are always
    // visible while entries of foreign projects stay hidden.
    const filters: MemoryFilter[] = []
    if (scope === 'project') {
      const key =
        options.project && options.project !== 'all' ? sanitizeProjectKey(options.project) : this.project
      filters.push({ ...base, scope: 'project', project: key }, { ...base, scope: 'user' })
    } else {
      const filter: MemoryFilter = { ...base }
      if (scope === 'user') filter.scope = 'user'
      if (options.project && options.project !== 'all') filter.project = options.project
      filters.push(filter)
    }

    const items = new Map<string, MemoryEntry>()
    const bm25 = new Map<string, number>()
    const semantic = new Map<string, number>()
    const semanticChunks = new Map<string, number>()
    for (const filter of filters) {
      const lexical = this.store.searchRanked(text, filter)
      for (const item of lexical.items) items.set(item.id, item)
      for (const [id, score] of lexical.ranks) {
        bm25.set(id, Math.max(bm25.get(id) ?? Number.NEGATIVE_INFINITY, score))
      }
      const vector = await this.semanticRanks(text, filter)
      for (const [id, score] of vector.scores) {
        const previous = semantic.get(id)
        if (previous === undefined || previous < score) {
          semantic.set(id, score)
          const chunkIndex = vector.chunks.get(id)
          if (chunkIndex !== undefined) semanticChunks.set(id, chunkIndex)
        }
      }
    }
    // A semantic hit outside the lexical result set still has to be fetched.
    for (const id of semantic.keys()) {
      if (items.has(id)) continue
      const entry = this.store.get(id)
      if (entry) items.set(id, entry)
    }

    const candidates = [...items.values()]
    const ranked =
      text.length === 0
        ? rankItems(candidates, query, DEFAULT_RANKING, scope)
        : rankItemsHybrid(candidates, query, DEFAULT_RANKING, scope, bm25, semantic)
    const rankedItems = ranked.slice(0, limit)

    // The excerpt mode returns the passage the vector leg matched rather than
    // the head of the body; it stays inside the same per-entry character budget.
    let excerpts: Map<string, string> | undefined
    if (detail === 'excerpt') {
      excerpts = new Map()
      for (const entry of rankedItems) {
        const chunkIndex = semanticChunks.get(entry.id)
        if (chunkIndex === undefined) continue
        const chunk = entryChunks(entry, this.config.embeddings).find((item) => item.chunkIndex === chunkIndex)
        if (chunk) excerpts.set(entry.id, chunk.body)
      }
    }

    return {
      items: rankedItems,
      text: renderRecall(rankedItems, format, {
        detail,
        textChars: this.config.recallTextChars,
        totalChars: this.config.recallTotalChars,
        ...(excerpts ? { excerpts } : {}),
      }),
      format,
    }
  }

  /** Counters by scope/kind/status plus storage paths and database size. */
  statusReport(): StatusReport {
    const items = this.store.list({ status: 'all' }).items
    const byStatus: Record<string, number> = {}
    const byScope: Record<string, number> = {}
    const byKind: Record<string, number> = {}
    const byProject: Record<string, number> = {}
    for (const entry of items) {
      byStatus[entry.status] = (byStatus[entry.status] ?? 0) + 1
      byScope[entry.scope] = (byScope[entry.scope] ?? 0) + 1
      byKind[entry.kind] = (byKind[entry.kind] ?? 0) + 1
      if (entry.scope === 'project') byProject[entry.project] = (byProject[entry.project] ?? 0) + 1
    }
    return {
      root: this.root,
      dbPath: this.dbPath,
      dbSizeBytes: this.dbSizeBytes(),
      total: items.length,
      active: byStatus['active'] ?? 0,
      byStatus,
      byScope,
      byKind,
      byProject,
      vectors: this.vectorStatus(),
    }
  }

  /**
   * Health report: broken links (resolved against all statuses, including
   * `supersededBy`), significant overlaps of active entries, and stale entries.
   */
  lintReport(): LintReport {
    const all = this.store.list({ status: 'all' }).items
    const active = all.filter((entry) => entry.status === 'active')
    const allIds = new Set(all.map((entry) => entry.id))

    const brokenLinks: LintBrokenLink[] = []
    const checkField = (entry: MemoryEntry, field: LintBrokenLink['field'], refs: string[]): void => {
      for (const ref of refs) {
        if (!allIds.has(ref)) brokenLinks.push({ id: entry.id, title: entry.title, field, missingId: ref })
      }
    }
    for (const entry of all) {
      checkField(entry, 'supersedes', entry.supersedes)
      checkField(entry, 'related', entry.related)
      checkField(entry, 'supersededBy', entry.supersededBy)
    }

    const pairs = significantOverlapPairs(active, {
      minCommonWords: Math.max(1, this.config.lintOverlapMinCommonWords),
      minScore: LINT_OVERLAP_MIN_SCORE,
    })
    const maxPairs = Math.floor(this.config.lintMaxPairs)
    const limited = maxPairs > 0 ? pairs.slice(0, maxPairs) : pairs
    const overlaps: LintOverlap[] = limited.map((pair) => ({
      a: pair.a.id,
      b: pair.b.id,
      aTitle: pair.a.title,
      bTitle: pair.b.title,
      common: pair.common,
      score: Math.round(pair.score * 100) / 100,
    }))

    const cutoff = Date.now() - LINT_STALE_DAYS * 24 * 60 * 60 * 1000
    const stale: LintStale[] = active
      .filter((entry) => new Date(entry.updatedAt).getTime() < cutoff)
      .map((entry) => ({ id: entry.id, title: entry.title, updatedAt: entry.updatedAt }))

    return {
      totalCount: all.length,
      activeCount: active.length,
      brokenLinks,
      overlaps,
      overlapsHidden: Math.max(0, pairs.length - limited.length),
      stale,
      staleDays: LINT_STALE_DAYS,
      duplicates: this.duplicateCandidates(active),
      promptDigestChars: this.rulesForPrompt().length,
    }
  }

  /**
   * Near-duplicate candidates: the strongest semantic pairs of the given
   * entries. The cut is relative — the top {@link DUPLICATE_QUANTILE} of pairs —
   * so it adapts to the store instead of relying on an absolute cosine value.
   */
  private duplicateCandidates(entries: readonly MemoryEntry[]): LintDuplicate[] {
    const pairs = this.semanticNeighbours(entries)
    if (pairs.length === 0) return []
    const cut = pairs[Math.max(0, Math.floor(pairs.length * DUPLICATE_QUANTILE))]?.score ?? pairs[0]!.score
    const byId = new Map(entries.map((entry) => [entry.id, entry]))
    const duplicates: LintDuplicate[] = []
    for (const pair of pairs) {
      if (pair.score < cut) break
      const left = byId.get(pair.left)
      const right = byId.get(pair.right)
      if (!left || !right) continue
      duplicates.push({
        id: left.id,
        title: left.title,
        duplicateId: right.id,
        duplicateTitle: right.title,
        score: Math.round(pair.score * 1000) / 1000,
      })
      if (duplicates.length >= LINT_MAX_DUPLICATES) break
    }
    return duplicates
  }

  /**
   * Semantic neighbours of the given entries, or an empty list when the vector
   * leg is off. The cut is relative (see `semanticPairs`), which is why the
   * caller passes the candidate set rather than a score threshold.
   */
  private semanticNeighbours(entries: readonly MemoryEntry[]): SemanticPair[] {
    const vectors = this.ensureVectors()
    if (!vectors) return []
    const ids = new Set(entries.map((entry) => entry.id))
    const entryVectors = new Map<string, Float32Array>()
    for (const [id, vector] of vectors.index.entryVectors()) {
      if (ids.has(id)) entryVectors.set(id, vector)
    }
    if (entryVectors.size < 2) return []
    return semanticPairs(entryVectors, {
      perEntry: this.config.embeddings.semanticEdgesPerEntry,
      maxPairs: this.config.embeddings.semanticMaxEdges,
    })
  }

  /** Heuristic knowledge graph over all entries (nodes) and their relations. */
  graph(): MemoryGraph {
    const entries = this.store.list({ status: 'all' }).items
    return buildGraph(entries, {
      overlapMinCommonWords: this.config.lintOverlapMinCommonWords,
      semanticPairs: this.semanticNeighbours(entries),
    })
  }

  /**
   * Compact English digest of active rules/preferences for the system prompt.
   * Returns an empty string when there is nothing to inject.
   *
   * The digest is rebuilt on every prompt assembly, so it stays deliberately
   * small: `config.promptRulesLimit` bounds the number of lines and
   * `config.rulesPromptScope` decides whether rules of other projects may
   * appear. With the `project` scope the user layer is always kept, and the
   * caller's project is kept when {@link RulesPromptOptions.project} is known;
   * an unknown project falls back to every project (the pre-0.1.2 behaviour).
   */
  rulesForPrompt(limit = this.config.promptRulesLimit, options: RulesPromptOptions = {}): string {
    const scope: RulesPromptScope = options.scope ?? this.config.rulesPromptScope
    const project = options.project
    const items = this.store
      .list({ status: 'active' })
      .items.filter((entry) => {
        if (entry.kind !== 'rules' && entry.kind !== 'preferences') return false
        if (scope === 'all' || project === undefined) return true
        return entry.scope === 'user' || entry.project === project
      })
    if (items.length === 0) return ''
    const ranked = rankRulesBase(items, DEFAULT_RANKING).slice(0, Math.max(1, limit))
    const lines = ['Long-term memory: rules and preferences (respect these).']
    for (const entry of ranked) {
      lines.push(`- [${entry.tier}] ${entry.title}: ${firstLine(entry.text)}`)
    }
    return lines.join('\n')
  }

  /**
   * Import entries idempotently by `extKey`.
   *
   * Two passes are required for cross-entry relations: the first resolves every
   * entry to a stable local id (existing ids are reused through `extKey`), the
   * second rewrites `supersedes`/`supersededBy`/`related` through that map and
   * drops references to entries that were not imported, so no broken link is
   * ever stored.
   */
  importEntries(entries: ImportEntry[], source: string): ImportReport {
    const report: ImportReport = { source, imported: 0, updated: 0, skipped: 0, droppedRelations: 0, ids: [] }

    const resolutions: ExternalIdResolution[] = []
    const prepared: Array<{
      input: ImportEntry
      extKey: string
      text: string
      existing: MemoryEntry | null
      localId: string
    }> = []
    for (const input of entries) {
      const extKey = (input.extKey ?? '').trim()
      const text = (input.text ?? '').trim()
      if (extKey.length === 0 || text.length === 0) {
        report.skipped++
        continue
      }
      const existing = this.store.getByExtKey(extKey)
      const localId = existing?.id ?? genMemoryId()
      resolutions.push({ extKey, localId })
      prepared.push({ input, extKey, text, existing, localId })
    }

    const idMap = buildExternalIdMap(source, resolutions)
    for (const { input, extKey, text, existing, localId } of prepared) {
      const scope: MemoryScope = input.scope ?? 'project'
      const project = scope === 'user' ? '' : sanitizeProjectKey(input.project ?? this.project)
      if (scope === 'project') this.ensureProjectRoot(project)
      const supersedes = remapRelationIds(input.supersedes ?? [], source, idMap)
      const supersededBy = remapRelationIds(input.supersededBy ?? [], source, idMap)
      const related = remapRelationIds(input.related ?? [], source, idMap)
      report.droppedRelations += supersedes.dropped + supersededBy.dropped + related.dropped

      const candidate = newMemoryEntry({
        id: localId,
        scope,
        project,
        kind: input.kind ?? 'facts',
        tier: input.tier ?? 'normal',
        status: input.status ?? 'active',
        title: input.title ?? '',
        text,
        tags: input.tags ?? [],
        keywords: input.keywords ?? '',
        importance: input.importance ?? 3,
        supersedes: supersedes.ids,
        supersededBy: supersededBy.ids,
        related: related.ids,
        ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
        source: input.source ?? source,
        extKey,
        createdAt: input.createdAt ?? existing?.createdAt,
        updatedAt: input.updatedAt ?? new Date().toISOString(),
      })

      report.ids.push(localId)
      if (!existing) {
        this.store.upsert(candidate)
        report.imported++
        continue
      }
      if (sameImportedEntry(existing, candidate)) {
        report.skipped++
        continue
      }
      this.store.upsert({ ...candidate, createdAt: existing.createdAt || candidate.createdAt })
      report.updated++
    }
    return report
  }

  /**
   * Safe health repair: drop broken relation references, add missing reverse
   * links (`supersededBy` for `supersedes`, symmetric `related`), then refresh
   * the derived index incrementally — only pages whose size or mtime changed
   * since the last pass are read again.
   *
   * Non-destructive: no entry is deleted and no status is changed.
   */
  heal(): HealReport {
    const all = this.store.list({ status: 'all' }).items
    const ids = new Set(all.map((entry) => entry.id))
    const byId = new Map(all.map((entry) => [entry.id, entry]))
    const original = new Map(
      all.map((entry) => [
        entry.id,
        {
          supersedes: entry.supersedes.join('\u0000'),
          supersededBy: entry.supersededBy.join('\u0000'),
          related: entry.related.join('\u0000'),
        },
      ]),
    )
    const brokenBefore = this.lintReport().brokenLinks.length

    let removedLinks = 0
    for (const entry of all) {
      const keep = (refs: string[]): string[] => {
        const kept = refs.filter((ref) => ids.has(ref))
        removedLinks += refs.length - kept.length
        return kept
      }
      entry.supersedes = keep(entry.supersedes)
      entry.supersededBy = keep(entry.supersededBy)
      entry.related = keep(entry.related)
    }

    let addedBacklinks = 0
    const addUnique = (refs: string[], value: string): void => {
      if (refs.includes(value)) return
      refs.push(value)
      addedBacklinks++
    }
    for (const entry of all) {
      for (const targetId of entry.supersedes) {
        const target = byId.get(targetId)
        if (target) addUnique(target.supersededBy, entry.id)
      }
      for (const targetId of entry.related) {
        const target = byId.get(targetId)
        if (target) addUnique(target.related, entry.id)
      }
    }

    const now = new Date().toISOString()
    for (const entry of all) {
      const before = original.get(entry.id)
      if (!before) continue
      const changed =
        before.supersedes !== entry.supersedes.join('\u0000') ||
        before.supersededBy !== entry.supersededBy.join('\u0000') ||
        before.related !== entry.related.join('\u0000')
      if (!changed) continue
      entry.updatedAt = now
      this.store.upsert(entry)
    }

    // Refresh the index incrementally: pages that did not change on disk are
    // skipped by their stored size+mtime, so a heal with no external edits
    // reads no page at all.
    const reconciled = this.store.reconcileFromDisk()
    const brokenAfter = this.lintReport().brokenLinks.length
    appendLog(
      this.root,
      'heal',
      `removed=${removedLinks} added=${addedBacklinks} reindexed=${reconciled.read} (${reconciled.mode})`,
    )
    return { removedLinks, addedBacklinks, reindexed: reconciled.read, brokenBefore, brokenAfter }
  }

  /** Stop the embedding queue and close the underlying database connection. */
  close(): void {
    const vectors = this.vectors
    const modelProvider = this.modelProvider
    this.vectors = null
    this.modelProvider = null
    this.store.onEntryChanged = null
    if (vectors) {
      vectors.queue.stop()
      vectors.provider.close?.()
    }
    // A provider kept for downloads (the vector leg was off) owns its own worker.
    if (modelProvider && modelProvider !== vectors?.provider) modelProvider.close?.()
    this.store.close()
  }

  private dbSizeBytes(): number {
    try {
      return statSync(this.dbPath).size
    } catch {
      return 0
    }
  }
}
