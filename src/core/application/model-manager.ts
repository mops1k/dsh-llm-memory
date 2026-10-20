/**
 * Embedding-model lifecycle shared by the DSH engine and the per-harness
 * adapters: what is on disk, downloading it with progress, deleting it.
 *
 * The vector leg itself is host-specific (the engine owns the index and the
 * queue), so the manager only resolves the provider, scans the cache and keeps
 * the download state; callers decide what to do when the model arrives.
 */
import type { EmbeddingConfig } from '../domain/config.js'
import type { EmbeddingProvider } from '../domain/types.js'
import { createEmbeddingProvider, type EmbeddingProviderOptions } from '../infrastructure/embeddings.js'
import { downloadModelFiles, type FetchLike } from '../infrastructure/model-download.js'
import {
  removeModelCache,
  scanModelCache,
  sweepModelTempFiles,
  type ModelCacheStatus,
  type ModelDownloadProgress,
} from '../infrastructure/model-cache.js'

/** State of the embedding model shown by a settings page. */
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
  /** Required model files the cache is missing; empty when the model is complete. */
  missing?: string[]
}

export interface ModelManagerOptions {
  /** Embedding settings of the hosting config. */
  settings: EmbeddingConfig
  /** Directory the model is cached in (usually `<store>/_models`). */
  cacheDir: string
  /** Provider supplied by the host (tests, adapters); skips the factory. */
  injectedProvider?: EmbeddingProvider | null
  /** Provider factory override (defaults to `createEmbeddingProvider`). */
  createProvider?: (config: EmbeddingConfig, options: EmbeddingProviderOptions) => EmbeddingProvider | null
  /** Whether the settings ask for semantic search; defaults to provider/backend check. */
  isConfigured?: () => boolean
  /** Whether the host's vector leg is live right now. */
  isEnabled?: () => boolean
  /** Called once a download actually put the model on disk. */
  onCached?: () => void
  /** HTTP client for the download-only fallback (tests stub it). */
  fetchImpl?: FetchLike
  debug?: (message: string) => void
}

export class ModelManager {
  private provider: EmbeddingProvider | null = null
  private state: { downloading: boolean; progress: ModelDownloadProgress | null; error: string | null } = {
    downloading: false,
    progress: null,
    error: null,
  }

  constructor(private readonly options: ModelManagerOptions) {}

  /** Directory the model files live in. */
  get cacheDir(): string {
    return this.options.cacheDir
  }

  /**
   * Provider used for downloads and by the vector leg.
   *
   * Cached so a download that ran while the vector leg was off (no model in the
   * cache) is reused once the model is there.
   */
  providerFor(): EmbeddingProvider | null {
    if (this.provider) return this.provider
    const settings = this.options.settings
    const factory = this.options.createProvider ?? createEmbeddingProvider
    const provider =
      this.options.injectedProvider ??
      (settings.provider === 'off' || settings.provider === 'http'
        ? null
        : factory(settings, { cacheDir: this.options.cacheDir, debug: this.options.debug }))
    if (provider) this.provider = provider
    return provider
  }

  /** Model id the provider loads (falls back to the configured id). */
  modelId(): string {
    return this.providerFor()?.model ?? this.options.settings.model
  }

  private configured(): boolean {
    if (this.options.isConfigured) return this.options.isConfigured()
    const settings = this.options.settings
    return settings.provider !== 'off' && settings.backend !== 'off'
  }

  /** State of the embedding model: what is on disk and whether a download runs. */
  status(): ModelStatus {
    const settings = this.options.settings
    const cache = scanModelCache(this.options.cacheDir, this.modelId())
    return {
      provider: settings.provider,
      model: this.modelId(),
      configured: this.configured(),
      enabled: this.options.isEnabled?.() ?? false,
      dir: cache.dir,
      cached: cache.cached,
      files: cache.files,
      bytes: cache.bytes,
      downloading: this.state.downloading,
      // Progress belongs to a running download; a plain prewarm of an already
      // cached model would otherwise leave a stale 100 % behind.
      progress: this.state.downloading ? this.state.progress : null,
      error: this.state.error,
    }
  }

  /**
   * Download (and load) the embedding model in the background.
   *
   * @throws when the settings do not ask for semantic search at all.
   */
  download(): ModelStatus {
    if (!this.configured()) {
      throw new Error(
        'Vector search is disabled: switch the embeddings provider to "local" and the backend away from "off" first.',
      )
    }
    const provider = this.providerFor()
    if (!provider) {
      // No embedding runtime in this host (a single-file plugin): fall back to a
      // plain file download so the weights are on disk for a later runtime.
      void this.downloadFilesOnly(this.options.settings.model)
      return this.status()
    }
    if (this.state.downloading) return this.status()

    const model = provider.model
    const cache = scanModelCache(this.options.cacheDir, model)
    if (!cache.cached) {
      // A model already in memory would make `prewarm` return without fetching
      // anything, and leftovers of a killed download are useless to the loader.
      const swept = sweepModelTempFiles(this.options.cacheDir, model)
      if (swept.files > 0) {
        this.options.debug?.(
          `embeddings: removed ${swept.files} partial downloads (${swept.bytes} bytes) of ${model}`,
        )
      }
      provider.reload?.()
      this.options.debug?.(`embeddings: reloading ${model}, the cache is incomplete`)
    }

    this.state = { downloading: true, progress: null, error: null }
    provider.watchProgress?.((progress: ModelDownloadProgress) => {
      this.state.progress = progress
    })
    void provider
      .prewarm()
      .then(() => {
        const after = scanModelCache(this.options.cacheDir, model)
        if (after.cached || !provider.id.startsWith('local')) {
          this.state = { downloading: false, progress: null, error: null }
          this.options.onCached?.()
          this.options.debug?.(`embeddings: ${model} is cached and loaded`)
        } else {
          this.state = {
            downloading: false,
            progress: null,
            error: `No model files were written to ${after.dir}; check the network and the plugin log.`,
          }
          this.options.debug?.(`embeddings: ${this.state.error}`)
        }
      })
      .catch((error: unknown) => {
        // The runtime may be unusable in this host (missing native modules in a
        // bundled plugin); the files themselves can still be fetched.
        this.options.debug?.(`embeddings: provider download failed (${error instanceof Error ? error.message : String(error)}); falling back to a plain file download`)
        void this.downloadFilesOnly(model)
      })
      .finally(() => {
        provider.watchProgress?.(null)
      })
    return this.status()
  }

  /** Fetch the model files over HTTP without loading the model. */
  private async downloadFilesOnly(model: string): Promise<void> {
    this.state = { downloading: true, progress: null, error: null }
    try {
      const result = await downloadModelFiles({
        cacheDir: this.options.cacheDir,
        model,
        onProgress: progress => {
          this.state.progress = progress
        },
        debug: this.options.debug,
        ...(this.options.fetchImpl ? { fetchImpl: this.options.fetchImpl } : {}),
      })
      const after = scanModelCache(this.options.cacheDir, model)
      this.options.debug?.(`embeddings: downloaded ${result.files} files (${result.bytes} bytes) of ${model} without loading it`)
      this.state = { downloading: false, progress: null, error: after.cached ? null : `No ONNX weights were written to ${after.dir}` }
      if (after.cached) this.options.onCached?.()
    } catch (error) {
      this.state = {
        downloading: false,
        progress: null,
        error: error instanceof Error ? error.message : String(error),
      }
      this.options.debug?.(`embeddings: file download failed (${this.state.error})`)
    }
  }

  /** Delete the cached model files; the next load downloads them again. */
  remove(): ModelStatus {
    removeModelCache(this.options.cacheDir, this.modelId())
    this.state = { downloading: false, progress: null, error: null }
    return this.status()
  }
}
