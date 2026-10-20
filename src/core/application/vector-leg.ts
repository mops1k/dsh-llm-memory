/**
 * Reusable vector leg: provider, index, embedding queue, semantic ranks, the
 * semantic map, vector health and the model lifecycle.
 *
 * It was extracted from `MemoryEngine` so every harness (DSH, Kilo, and later
 * OpenCode/MCP) shares one implementation instead of growing its own: the leg
 * owns the optional embedding runtime and degrades to the lexical path whenever
 * the model, the provider or the backend is missing.
 *
 * The store is the only data dependency; the harness decides where the store
 * lives and which provider factory it can afford (a worker thread in DSH, the
 * in-process model in the single-file Kilo plugin).
 */
import { entryChunks } from './chunks.js'
import { projectInto, projectVectors, type VectorProjection } from './projection.js'
import type { ModelStatus } from './model-manager.js'
import type { EmbeddingConfig } from '../domain/config.js'
import type {
  EmbeddingProvider,
  MemoryFilter,
  VectorIndex,
  VectorMap,
  VectorMapPoint,
  VectorMapQuery,
} from '../domain/types.js'
import { EmbeddingQueue, type EmbeddingQueueStatus } from '../infrastructure/embed-queue.js'
import { createEmbeddingProvider, type EmbeddingProviderOptions } from '../infrastructure/embeddings.js'
import { debug as defaultDebug } from '../infrastructure/log.js'
import { downloadModelFiles, type FetchLike } from '../infrastructure/model-download.js'
import {
  removeModelCache,
  scanModelCache,
  sweepModelTempFiles,
  type ModelDownloadProgress,
} from '../infrastructure/model-cache.js'
import type { MemoryStore } from '../infrastructure/store.js'

/** Differences between the vector table and the pages. */
export interface VectorHealth {
  /** Entries present in the vector table. */
  checked: number
  /** Vector rows whose page is gone. */
  orphans: string[]
  /** Entries whose stored metadata copy no longer matches the page. */
  metadataStale: string[]
  /** Pages with no vectors at all. */
  missing: string[]
  /** Pages whose stored chunk set differs from what the text chunks into. */
  partial: string[]
  /** Entries stored under another model (a model switch leaves these behind). */
  foreign: string[]
  /** Entries holding chunks of a wrong length for the configured dimension. */
  badDim: string[]
  /** Entries holding zero or non-finite vectors. */
  broken: string[]
}

/** What the vector part of `heal` repaired. */
export interface HealVectorsReport {
  /** Entries found in the vector table. */
  checked: number
  /** Leftover rows deleted (page removed). */
  orphansRemoved: number
  /** Metadata copies rewritten from the page. */
  metadataFixed: number
  /** Rows deleted for a wrong vector length or a broken vector. */
  badRemoved: number
  /** Rows of another model deleted. */
  foreignRemoved: number
  /** Entries handed back to the embedding queue (missing, partial, deleted). */
  queued: number
  /** Leftover download files removed from the model cache. */
  tempFilesSwept: number
}

/** Live parts of the leg once the runtime is up. */
interface VectorStack {
  provider: EmbeddingProvider
  index: VectorIndex
  queue: EmbeddingQueue
}

export interface VectorLegOptions {
  store: MemoryStore
  /** Embedding settings of the hosting harness. */
  settings: EmbeddingConfig
  /** Directory the model files are cached in (usually `<store>/_models`). */
  cacheDir: string
  debug?: (message: string) => void
  /** Provider supplied by the host (tests, adapters); skips the factory. */
  injectedProvider?: EmbeddingProvider
  /**
   * When true the queue never schedules timers; the caller drives it with
   * {@link VectorLeg.embedPending}. Tests use this for determinism.
   */
  manual?: boolean
  /** Run the model in the current thread (single-file plugins without workers). */
  inline?: boolean
  /** Provider factory override (tests, hosts without the worker entry point). */
  createProvider?: (settings: EmbeddingConfig, options: EmbeddingProviderOptions) => EmbeddingProvider | null
  /**
   * Fetch the model files without a runtime when the provider is unavailable.
   * The Kilo plugin ships as one file without `@huggingface/transformers`, so a
   * download must still put the weights on disk for a later runtime.
   */
  fallbackDownload?: boolean
  /** HTTP client for the download-only fallback (tests stub it). */
  fetchImpl?: FetchLike
}

/** Keep a number readable in the semantic map payload. */
function round(value: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

/** The shared vector stack of a memory store. */
export class VectorLeg {
  readonly cacheDir: string
  private readonly store: MemoryStore
  private readonly settings: EmbeddingConfig
  private readonly log: (message: string) => void
  private readonly injectedProvider?: EmbeddingProvider
  private readonly manual: boolean
  private readonly inline: boolean
  private readonly createProvider: (settings: EmbeddingConfig, options: EmbeddingProviderOptions) => EmbeddingProvider | null
  private readonly fallbackDownload: boolean
  private readonly fetchImpl?: FetchLike

  /** Live stack; null while the leg is off or not built yet. */
  private stack: VectorStack | null = null
  /** Set when the leg cannot be built, so it is not retried per call. */
  private unavailable = false
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
  private failures = 0
  /**
   * Cached semantic map and its basis. The key holds the index counters, so the
   * coordinates are rebuilt as soon as an entry is embedded.
   */
  private mapCache: { key: string; projection: VectorProjection; map: VectorMap } | null = null

  constructor(options: VectorLegOptions) {
    this.store = options.store
    this.settings = options.settings
    this.cacheDir = options.cacheDir
    this.log = options.debug ?? defaultDebug
    this.injectedProvider = options.injectedProvider
    this.manual = options.manual === true
    this.inline = options.inline === true
    this.fallbackDownload = options.fallbackDownload === true
    this.fetchImpl = options.fetchImpl
    this.createProvider =
      options.createProvider ??
      ((settings, providerOptions) => createEmbeddingProvider(settings, providerOptions))
  }

  /** Whether the vector stack is live right now. */
  get enabled(): boolean {
    return this.stack !== null
  }

  /** Whether the settings (or an injected provider) ask for semantic search. */
  configured(): boolean {
    if (this.injectedProvider) return true
    const settings = this.settings
    return settings.provider !== 'off' && settings.backend !== 'off'
  }

  /**
   * Build the vector stack on first use.
   *
   * Every failure path — the optional dependency is missing, the worker cannot
   * start, the settings disable vectors, the model is not downloaded — leaves
   * the stack null, so a broken embedding setup degrades to the lexical path
   * instead of breaking recall.
   */
  ensure(): VectorStack | null {
    if (this.stack) return this.stack
    if (this.unavailable) return null
    const settings = this.settings
    if (!this.injectedProvider && (settings.provider === 'off' || settings.backend === 'off')) {
      this.unavailable = true
      return null
    }
    try {
      const provider = this.resolveProvider()
      if (!provider) {
        this.unavailable = true
        return null
      }
      if (!this.modelAvailable(provider)) {
        this.modelMissing = true
        this.log(
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
        this.unavailable = true
        return null
      }
      const queue = new EmbeddingQueue({
        store: this.store,
        index,
        provider,
        config: settings,
        debug: this.log,
        manual: this.manual,
      })
      this.store.onEntryChanged = (id) => queue.enqueue([id])
      this.stack = { provider, index, queue }
      if (settings.prewarm && !this.manual) queue.start()
      return this.stack
    } catch (error) {
      this.unavailable = true
      this.log(`vectors: disabled (${error instanceof Error ? error.message : String(error)})`)
      return null
    }
  }

  /** Start the vector leg in the background (plugin startup); idempotent. */
  start(): void {
    this.ensure()
  }

  /** Entry vectors of the indexed entries (best chunk); empty when the leg is off. */
  entryVectors(): Map<string, Float32Array> {
    return this.stack?.index.entryVectors() ?? new Map()
  }

  /** Progress of the vector index, or null when the vector leg is off. */
  status(): EmbeddingQueueStatus | null {
    return this.stack?.queue.status() ?? null
  }

  /** Whether the configured provider is ready to run (before or after build). */
  providerReady(): boolean {
    return this.resolveProvider() !== null
  }

  /**
   * Coordinates of every indexed entry on the two leading principal directions.
   *
   * `null` means there is nothing to draw: the vector leg is off, the model is
   * missing, or no entry has been embedded yet. The result is cached until the
   * index counters change; `refresh` forces a rebuild (the button in the UI).
   */
  map(options: { refresh?: boolean } = {}): VectorMap | null {
    const stack = this.ensure()
    if (!stack) return null
    const stats = stack.index.stats()
    const key = `${stats.model}:${stats.dim}:${stats.entries}:${stats.chunks}`
    if (!options.refresh && this.mapCache && this.mapCache.key === key) {
      return { ...this.mapCache.map, cached: true }
    }

    const entryVectors = stack.index.entryVectors()
    if (entryVectors.size === 0) return null

    const ids = [...entryVectors.keys()]
    const projection = projectVectors(ids.map((id) => entryVectors.get(id)!))
    const chunkCounts = stack.index.chunkCounts()
    const entries = new Map(this.store.list({ status: 'all' }).items.map((entry) => [entry.id, entry]))
    const points: VectorMapPoint[] = []
    for (const [index, id] of ids.entries()) {
      const entry = entries.get(id)
      // A vector without a page (deleted entry, pending cleanup) cannot be opened
      // in the UI, so it is left out of the map instead of drawn as a ghost.
      if (!entry) continue
      points.push({
        id,
        title: entry.title.slice(0, 120),
        x: round(projection.points[index * 2] ?? 0, 4),
        y: round(projection.points[index * 2 + 1] ?? 0, 4),
        kind: entry.kind,
        project: entry.project,
        scope: entry.scope,
        tier: entry.tier,
        status: entry.status,
        chunks: chunkCounts.get(id) ?? 0,
      })
    }
    if (points.length === 0) return null

    const map: VectorMap = {
      model: stats.model,
      dim: stats.dim,
      backend: stats.backend,
      entries: points.length,
      chunks: stats.chunks,
      explained: [round(projection.explained[0], 4), round(projection.explained[1], 4)],
      points,
      cached: false,
    }
    this.mapCache = { key, projection, map }
    return map
  }

  /**
   * Places a free-text query on the semantic map and returns the entries closest
   * to it, so the UI can show *where* recall is looking.
   */
  async projectQuery(text: string, limit = 5): Promise<VectorMapQuery | null> {
    const trimmed = text.trim()
    if (trimmed.length === 0) return null
    const stack = this.ensure()
    if (!stack) return null
    // Build (or reuse) the map first: the query is projected with its basis.
    if (!this.map()) return null
    const cache = this.mapCache
    if (!cache) return null

    const batch = await stack.provider.embed([trimmed], 'query')
    const vector = batch.vectors[0]
    if (!vector) return null

    const placed = projectInto(vector, cache.projection)
    const matches = stack.index.search({
      vector,
      limit: Math.max(1, Math.min(50, Math.floor(limit))),
      filter: undefined,
    })
    const best = new Map<string, number>()
    for (const match of matches) {
      const previous = best.get(match.entryId)
      if (previous === undefined || previous < match.score) best.set(match.entryId, match.score)
    }
    const hits = [...best]
      .map(([id, score]) => ({ id, score: round(score, 4) }))
      .sort((left, right) => right.score - left.score)
    return { x: round(placed.x, 4), y: round(placed.y, 4), model: cache.map.model, hits }
  }

  /**
   * State of the embedding model: what is on disk and whether a download runs.
   *
   * Works even when the vector leg is off: the settings page still has to say
   * what a click on "Download model" would do.
   */
  modelStatus(): ModelStatus {
    const settings = this.settings
    // Prefer the model the provider actually loads (an injected provider may
    // differ from the configured one in tests).
    const model = this.resolveProvider()?.model ?? settings.model
    const cache = scanModelCache(this.cacheDir, model)
    return {
      provider: settings.provider,
      model,
      configured: this.configured(),
      enabled: this.stack !== null,
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
   * @throws when the vector leg is disabled, because nothing would use the model.
   */
  downloadModel(): ModelStatus {
    const settings = this.settings
    if (!this.configured()) {
      throw new Error(
        'Vector search is disabled: switch the embeddings provider to "local" and the backend away from "off" first.',
      )
    }
    const provider = this.resolveProvider()
    if (!provider) {
      // No embedding runtime in this host (a single-file plugin): fetch the
      // weights over HTTP so they are on disk for a later runtime.
      if (this.fallbackDownload) {
        void this.downloadFilesOnly()
        return this.modelStatus()
      }
      throw new Error('No embedding provider is available; install @huggingface/transformers and retry.')
    }
    if (this.modelState.downloading) return this.modelStatus()

    const model = provider.model
    const cache = scanModelCache(this.cacheDir, model)
    if (!cache.cached) {
      // A model already in memory would make `prewarm` return without fetching
      // anything, and leftovers of a killed download are useless to the loader.
      const swept = sweepModelTempFiles(this.cacheDir, model)
      if (swept.files > 0) {
        this.log(`embeddings: removed ${swept.files} partial downloads (${swept.bytes} bytes) of ${model}`)
      }
      provider.reload?.()
      this.log(`embeddings: reloading ${model}, the cache is incomplete`)
    }

    this.modelState = { downloading: true, progress: null, error: null }
    provider.watchProgress?.((progress) => {
      this.modelState.progress = progress
    })
    void provider
      .prewarm()
      .then(() => {
        const after = scanModelCache(this.cacheDir, model)
        if (after.cached || !provider.id.startsWith('local')) {
          this.modelState = { downloading: false, progress: null, error: null }
          this.modelMissing = false
          // The model arrived now: let the vector leg come up without a restart.
          this.unavailable = false
          this.start()
          this.log(`embeddings: ${model} is cached and loaded`)
        } else {
          this.modelState = {
            downloading: false,
            progress: null,
            error: `No model files were written to ${after.dir}; check the network and the plugin log.`,
          }
          this.log(`embeddings: ${this.modelState.error}`)
        }
      })
      .catch((error: unknown) => {
        // The runtime may be unusable in this host (missing native modules in a
        // bundled plugin); the files themselves can still be fetched.
        if (this.fallbackDownload) {
          this.log(
            `embeddings: provider download failed (${error instanceof Error ? error.message : String(error)}); falling back to a plain file download`,
          )
          void this.downloadFilesOnly()
          return
        }
        this.modelState = {
          downloading: false,
          progress: null,
          error: error instanceof Error ? error.message : String(error),
        }
        this.log(`embeddings: model download failed (${this.modelState.error})`)
      })
      .finally(() => {
        provider.watchProgress?.(null)
      })
    return this.modelStatus()
  }

  /** Delete the cached model files (settings action). */
  removeModel(): ModelStatus {
    removeModelCache(this.cacheDir, this.resolveProvider()?.model ?? this.settings.model)
    this.modelState = { downloading: false, progress: null, error: null }
    return this.modelStatus()
  }

  /** Drop the vector cache and queue a full re-embed (settings action). */
  rebuild(): void {
    const stack = this.ensure()
    if (!stack) return
    stack.index.clear()
    stack.queue.sweep()
  }

  /**
   * Drive the embedding queue to completion (tests, maintenance and the
   * backfill script, which passes one slice of ids at a time).
   */
  async embedPending(ids?: readonly string[]): Promise<void> {
    const stack = this.ensure()
    if (!stack) return
    await stack.queue.processAll(ids)
  }

  /**
   * Cosine similarity of the query against the indexed chunks, per entry, with
   * the chunk that produced the best score (used by the excerpt mode).
   */
  async semanticRanks(
    query: string,
    filter: MemoryFilter,
  ): Promise<{ scores: Map<string, number>; chunks: Map<string, number> }> {
    const scores = new Map<string, number>()
    const chunks = new Map<string, number>()
    const text = (query ?? '').trim()
    if (text.length === 0) return { scores, chunks }
    const stack = this.ensure()
    if (!stack) return { scores, chunks }
    try {
      const batch = await stack.provider.embed([text], 'query')
      const vector = batch.vectors[0]
      if (!vector) return { scores, chunks }
      const matches = stack.index.search({
        vector,
        limit: this.settings.topK,
        filter,
        minScore: this.settings.minScore,
      })
      for (const match of matches) {
        const previous = scores.get(match.entryId)
        if (previous === undefined || previous < match.score) {
          scores.set(match.entryId, match.score)
          chunks.set(match.entryId, match.chunkIndex)
        }
      }
      this.failures = 0
    } catch (error) {
      this.failures++
      this.log(`vectors: query embedding failed (${error instanceof Error ? error.message : String(error)})`)
      if (this.failures >= 3) {
        this.unavailable = true
        this.log('vectors: disabled after 3 consecutive query failures; lexical search stays active')
      }
    }
    return { scores, chunks }
  }

  /**
   * Compares the vector table with the pages. Cheap: it reads the table once and
   * never touches the model, so it works with the vector leg off as well.
   */
  health(): VectorHealth | null {
    const stack = this.stack
    if (!stack) return null
    const audit = stack.index.audit()
    const pages = this.store.list({ status: 'all' }).items
    const byId = new Map(pages.map((entry) => [entry.id, entry]))
    const health: VectorHealth = {
      checked: audit.entries.size,
      orphans: [],
      metadataStale: [],
      missing: [],
      partial: [],
      foreign: [],
      badDim: [],
      broken: [],
    }
    for (const [id, stored] of audit.entries) {
      const entry = byId.get(id)
      if (!entry) {
        health.orphans.push(id)
        continue
      }
      if (stored.model !== audit.model) {
        // Another embedding space: the row is a leftover and is re-embedded
        // rather than judged against this model's metadata.
        health.foreign.push(id)
        continue
      }
      if (stored.badDim > 0) health.badDim.push(id)
      if (stored.broken > 0) health.broken.push(id)
      // The buckets are independent on purpose: an entry with a damaged vector
      // may also have a partial chunk set.
      const stale =
        stored.scope !== entry.scope ||
        stored.project !== entry.project ||
        stored.kind !== entry.kind ||
        stored.tier !== entry.tier ||
        stored.status !== entry.status
      if (stale) health.metadataStale.push(id)
      const expected = entryChunks(entry, this.settings).map((chunk) => chunk.chunkIndex)
      const storedIndexes = [...stored.chunkIndexes].sort((left, right) => left - right)
      if (expected.length !== storedIndexes.length || expected.some((value, index) => value !== storedIndexes[index])) {
        health.partial.push(id)
      }
    }
    for (const entry of pages) {
      if (!audit.entries.has(entry.id)) health.missing.push(entry.id)
    }
    return health
  }

  /**
   * Cheap vector repairs: leftovers and broken rows are dropped, metadata copies
   * are rewritten from the pages, and everything that has to be embedded again
   * goes to the background queue.
   */
  repair(): HealVectorsReport {
    const report: HealVectorsReport = {
      checked: 0,
      orphansRemoved: 0,
      metadataFixed: 0,
      badRemoved: 0,
      foreignRemoved: 0,
      queued: 0,
      tempFilesSwept: 0,
    }
    const stack = this.stack
    if (!stack) return report
    const health = this.health()
    if (!health) return report
    report.checked = health.checked

    for (const id of health.orphans) {
      stack.index.remove(id)
      report.orphansRemoved++
    }
    for (const id of health.foreign) {
      stack.index.remove(id)
      report.foreignRemoved++
    }
    for (const id of [...health.badDim, ...health.broken]) {
      stack.index.remove(id)
      report.badRemoved++
    }
    for (const id of health.metadataStale) {
      const entry = this.store.get(id)
      if (!entry) continue
      const rows = stack.index.records([id])
      if (rows.length === 0) continue
      stack.index.upsert(
        rows.map((row) => ({
          ...row,
          scope: entry.scope,
          project: entry.project,
          kind: entry.kind,
          tier: entry.tier,
          status: entry.status,
        })),
      )
      report.metadataFixed++
    }

    const requeue = [
      ...new Set([...health.missing, ...health.partial, ...health.badDim, ...health.broken, ...health.foreign]),
    ]
    if (requeue.length > 0) stack.queue.enqueue(requeue)
    report.queued = requeue.length

    report.tempFilesSwept = sweepModelTempFiles(this.cacheDir, stack.provider.model).files
    return report
  }

  /**
   * Rebuilds the derived ANN table from `memory_vectors` (sqlite-vec only). The
   * in-process scan reads the table itself, so there it is a no-op.
   */
  rebuildAnnIndex(): boolean {
    const stack = this.stack
    if (!stack) return false
    stack.index.rebuildAnn()
    return stack.index.backend === 'sqlite-vec'
  }

  /** Stop the embedding queue and release the provider. */
  close(): void {
    const stack = this.stack
    const modelProvider = this.modelProvider
    this.stack = null
    this.modelProvider = null
    this.store.onEntryChanged = null
    if (stack) {
      stack.queue.stop()
      stack.provider.close?.()
    }
    // A provider kept for downloads (the vector leg was off) owns its own worker.
    if (modelProvider && modelProvider !== stack?.provider) modelProvider.close?.()
  }

  /**
   * Provider for the vector leg and for model downloads.
   *
   * Cached so a download that ran while the vector leg was off (no model in the
   * cache) is reused once the model is there.
   */
  private resolveProvider(): EmbeddingProvider | null {
    if (this.stack) return this.stack.provider
    if (this.modelProvider) return this.modelProvider
    const settings = this.settings
    const factory = this.createProvider
    const provider =
      this.injectedProvider ??
      (settings.provider === 'off' || settings.provider === 'http'
        ? null
        : this.safeCreateProvider(factory, settings))
    if (provider) this.modelProvider = provider
    return provider
  }

  /**
   * The optional runtime may be missing in the hosting process: a missing
   * `@huggingface/transformers` has to leave the leg off, not crash the plugin.
   */
  private safeCreateProvider(
    factory: (settings: EmbeddingConfig, options: EmbeddingProviderOptions) => EmbeddingProvider | null,
    settings: EmbeddingConfig,
  ): EmbeddingProvider | null {
    try {
      return factory(settings, {
        cacheDir: this.cacheDir,
        debug: this.log,
        ...(this.inline ? { inline: true } : {}),
      })
    } catch (error) {
      this.log(`embeddings: no embedding runtime (${error instanceof Error ? error.message : String(error)})`)
      return null
    }
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
    return scanModelCache(this.cacheDir, provider.model).cached
  }

  /** Fetch the model files over HTTP without loading the model. */
  private async downloadFilesOnly(): Promise<void> {
    this.modelState = { downloading: true, progress: null, error: null }
    try {
      const model = this.settings.model
      const result = await downloadModelFiles({
        cacheDir: this.cacheDir,
        model,
        onProgress: (progress) => {
          this.modelState.progress = progress
        },
        debug: this.log,
        ...(this.fetchImpl ? { fetchImpl: this.fetchImpl } : {}),
      })
      const after = scanModelCache(this.cacheDir, model)
      this.log(`embeddings: downloaded ${result.files} files (${result.bytes} bytes) of ${model} without loading it`)
      this.modelState = {
        downloading: false,
        progress: null,
        error: after.cached ? null : `No ONNX weights were written to ${after.dir}`,
      }
      if (after.cached) {
        this.modelMissing = false
        this.unavailable = false
        this.start()
      }
    } catch (error) {
      this.modelState = {
        downloading: false,
        progress: null,
        error: error instanceof Error ? error.message : String(error),
      }
      this.log(`embeddings: file download failed (${this.modelState.error})`)
    }
  }
}
