/**
 * Embedding providers for the vector leg of memory retrieval.
 *
 * Two implementations share one interface: {@link LocalEmbeddingProvider} runs a
 * multilingual ONNX model (`@huggingface/transformers`, optional dependency) in
 * the current thread, and {@link WorkerEmbeddingProvider} runs the same model in
 * a `worker_threads` worker.
 *
 * The worker is the default because ONNX inference does not yield the event
 * loop: measured on 2026-10-15, a 64-text batch blocked the main thread for
 * 3.4 s with a single timer tick in between. A background backfill of ~1000
 * pages would freeze the host, so indexing runs in a worker while the main
 * thread stays responsive (the same 3.9 s produced 361 timer ticks, ~3.6 s).
 *
 * When the optional dependency is missing or the worker fails, the factory
 * returns `null` and the store keeps its lexical FTS5 path.
 *
 * @module dsh-llm-memory/core/embeddings
 */
import { Worker } from 'node:worker_threads'

import type { EmbeddingConfig } from './config.js'
import { ensureDir } from './paths.js'
import type { EmbeddingBatch, EmbeddingProvider, EmbeddingRole } from './types.js'

/** Options accepted by {@link createEmbeddingProvider}. */
export interface EmbeddingProviderOptions {
  /** Directory the model files are cached in (kept inside the memory root). */
  cacheDir: string
  /** ONNX dtype handed to transformers.js; `q8` selects the quantized model. */
  dtype?: string
  /** Run the model in this thread (tests) instead of a worker thread. */
  inline?: boolean
  /** Worker entry point; defaults to the compiled `./embed-worker.js` next to this module. */
  workerPath?: string | URL
  debug?: (message: string) => void
}

/** Shape of the text extractor transformers.js returns. */
interface TextExtractor {
  (texts: string[], options: Record<string, unknown>): Promise<{
    dims: number[]
    tolist(): number[][]
  }>
}

/** Message sent to the worker. */
export interface EmbedWorkerRequest {
  id: number
  type: 'embed' | 'prewarm'
  texts?: string[]
  role?: EmbeddingRole
}

/** Message received from the worker. */
export interface EmbedWorkerResponse {
  id: number
  ok?: boolean
  ready?: boolean
  error?: string
  model?: string
  dim?: number
  /** One transferable buffer per vector. */
  buffers?: ArrayBuffer[]
}

/** Data handed to the worker at construction time. */
export interface EmbedWorkerData {
  config: EmbeddingConfig
  cacheDir: string
  dtype: string
}

/**
 * Create the provider selected by `config.provider`.
 *
 * @returns the provider, or `null` when embeddings are disabled, not implemented
 * for the selected provider, or unsupported on this platform.
 */
export function createEmbeddingProvider(
  config: EmbeddingConfig,
  options: EmbeddingProviderOptions,
): EmbeddingProvider | null {
  if (config.provider === 'off') return null
  if (config.provider === 'http') {
    options.debug?.('embeddings: the http provider is not implemented yet; the vector leg stays off')
    return null
  }
  return options.inline ? new LocalEmbeddingProvider(config, options) : new WorkerEmbeddingProvider(config, options)
}

/** In-process provider: loads the ONNX model on first use. */
export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly id = 'local'
  readonly model: string
  readonly dim: number
  private readonly config: EmbeddingConfig
  private readonly options: EmbeddingProviderOptions
  private extractor: TextExtractor | null = null
  private loading: Promise<TextExtractor> | null = null
  private failure: Error | null = null

  constructor(config: EmbeddingConfig, options: EmbeddingProviderOptions) {
    this.config = config
    this.model = config.model
    this.dim = config.dim
    this.options = options
  }

  get ready(): boolean {
    return this.extractor !== null
  }

  /** Load the model, remembering a failure so later calls fail fast. */
  private async load(): Promise<TextExtractor> {
    if (this.extractor) return this.extractor
    if (this.failure) throw this.failure
    if (!this.loading) {
      this.loading = this.createExtractor().catch((error: unknown) => {
        this.loading = null
        this.failure = error instanceof Error ? error : new Error(String(error))
        throw this.failure
      })
    }
    this.extractor = await this.loading
    return this.extractor
  }

  private async createExtractor(): Promise<TextExtractor> {
    ensureDir(this.options.cacheDir)
    const module = (await import('@huggingface/transformers')) as unknown as {
      env?: { cacheDir?: string }
      pipeline: (task: string, model: string, options: Record<string, unknown>) => Promise<unknown>
    }
    // The model must live with the memory store: the default cache dir sits
    // inside node_modules and is wiped by a reinstall.
    if (module.env) module.env.cacheDir = this.options.cacheDir
    this.options.debug?.(`embeddings: loading ${this.model} (cache ${this.options.cacheDir})`)
    return (await module.pipeline('feature-extraction', this.model, {
      dtype: this.options.dtype ?? 'q8',
    })) as TextExtractor
  }

  async prewarm(): Promise<void> {
    const extractor = await this.load()
    // One tiny passage pays the tokenizer and graph warm-up cost up front.
    await extractor([`${this.config.passagePrefix}warmup`], { pooling: 'mean', normalize: true })
    this.options.debug?.(`embeddings: ${this.model} ready (${this.dim} dimensions)`)
  }

  async embed(texts: string[], role: EmbeddingRole): Promise<EmbeddingBatch> {
    const extractor = await this.load()
    const prefix = role === 'query' ? this.config.queryPrefix : this.config.passagePrefix
    const batchSize = Math.max(1, this.config.batchSize)
    const vectors: Float32Array[] = []
    for (let start = 0; start < texts.length; start += batchSize) {
      const batch = texts.slice(start, start + batchSize).map((text) => `${prefix}${text}`)
      const output = await extractor(batch, { pooling: 'mean', normalize: true })
      for (const row of output.tolist()) {
        if (row.length !== this.dim) {
          throw new Error(`embeddings: model ${this.model} returned ${row.length} dimensions, expected ${this.dim}`)
        }
        vectors.push(Float32Array.from(row))
      }
    }
    return { vectors, model: this.model, dim: this.dim }
  }
}

/**
 * Provider that delegates to a worker thread, keeping the host event loop free
 * while the model loads and while passages are embedded.
 */
export class WorkerEmbeddingProvider implements EmbeddingProvider {
  readonly id = 'local-worker'
  readonly model: string
  readonly dim: number
  private readonly config: EmbeddingConfig
  private readonly options: EmbeddingProviderOptions
  private worker: Worker | null = null
  private failure: Error | null = null
  private nextId = 1
  private readonly pending = new Map<
    number,
    { resolve: (batch: EmbeddingBatch) => void; reject: (error: Error) => void; prewarm: boolean }
  >()

  constructor(config: EmbeddingConfig, options: EmbeddingProviderOptions) {
    this.config = config
    this.model = config.model
    this.dim = config.dim
    this.options = options
  }

  get ready(): boolean {
    return this.worker !== null
  }

  private fail(error: Error): void {
    this.failure = error
    this.options.debug?.(`embeddings: ${error.message}`)
    for (const [, entry] of this.pending) entry.reject(error)
    this.pending.clear()
    const worker = this.worker
    this.worker = null
    if (worker) void worker.terminate().catch(() => undefined)
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker
    if (this.failure) throw this.failure
    const workerPath = this.options.workerPath ?? new URL('./embed-worker.js', import.meta.url)
    const workerData: EmbedWorkerData = {
      config: this.config,
      cacheDir: this.options.cacheDir,
      dtype: this.options.dtype ?? 'q8',
    }
    const worker = new Worker(workerPath, { workerData })
    worker.on('message', (message: EmbedWorkerResponse) => this.onMessage(message))
    worker.on('error', (error: Error) => this.fail(error))
    worker.on('exit', (code: number) => {
      if (this.worker !== null && code !== 0) this.fail(new Error(`embedding worker exited with code ${code}`))
    })
    this.worker = worker
    return worker
  }

  private onMessage(message: EmbedWorkerResponse): void {
    const entry = this.pending.get(message.id)
    if (!entry) return
    this.pending.delete(message.id)
    if (message.ok !== true) {
      entry.reject(new Error(message.error ?? 'embedding worker failed without a message'))
      return
    }
    if (entry.prewarm) {
      entry.resolve({ vectors: [], model: message.model ?? this.model, dim: message.dim ?? this.dim })
      return
    }
    const vectors = (message.buffers ?? []).map((buffer) => new Float32Array(buffer))
    entry.resolve({ vectors, model: message.model ?? this.model, dim: message.dim ?? this.dim })
  }

  private request(request: Omit<EmbedWorkerRequest, 'id'>): Promise<EmbeddingBatch> {
    const worker = this.ensureWorker()
    const id = this.nextId++
    const promise = new Promise<EmbeddingBatch>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, prewarm: request.type === 'prewarm' })
    })
    worker.postMessage({ ...request, id } satisfies EmbedWorkerRequest)
    return promise
  }

  async prewarm(): Promise<void> {
    await this.request({ type: 'prewarm' })
  }

  async embed(texts: string[], role: EmbeddingRole): Promise<EmbeddingBatch> {
    return this.request({ type: 'embed', texts, role })
  }

  /** Stop the worker and reject everything still in flight. */
  close(): void {
    this.fail(new Error('embedding worker closed'))
  }
}
