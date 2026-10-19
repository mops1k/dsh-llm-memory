/**
 * Background embedding queue.
 *
 * The queue keeps the vector index in step with the markdown store without ever
 * blocking a write: entries are collected in a pending set and embedded in
 * batches by the provider (a worker thread, so the host event loop stays free),
 * one entry at a time; a failed provider stops the pass and is retried later,
 * and after repeated failures the queue disables itself so memory keeps working
 * on its lexical FTS5 path.
 *
 * Work is driven by two sources: the store reports every changed entry id, and
 * `start()` sweeps all entries once so a fresh database (or new embeddings
 * settings) fills up in the background.
 *
 * @module dsh-llm-memory/core/embed-queue
 */
import { chunksUnchanged, entryChunks } from './chunks.js'
import type { EmbeddingConfig } from './config.js'
import type { MemoryStore } from './store.js'
import type {
  EmbeddingProvider,
  MemoryEntry,
  VectorBackend,
  VectorIndex,
  VectorRecord,
} from './types.js'

/** Progress and health of the queue, reported to the settings UI and logs. */
export interface EmbeddingQueueStatus {
  model: string
  backend: VectorBackend
  /** Indexed chunks. */
  chunks: number
  /** Entries with at least one indexed chunk. */
  entries: number
  /** Approximate size of the stored vectors in bytes. */
  bytes: number
  /** Entries still waiting in the queue. */
  pending: number
  /** Entries embedded since this process started. */
  embedded: number
  running: boolean
  disabled: boolean
  lastError: string | null
}

/** Collaborators of the queue. */
export interface EmbeddingQueueOptions {
  store: MemoryStore
  index: VectorIndex
  provider: EmbeddingProvider
  config: EmbeddingConfig
  debug: (message: string) => void
  /**
   * When true the queue never schedules timers; the caller drives it with
   * {@link EmbeddingQueue.processAll}. Tests use this for determinism.
   */
  manual?: boolean
}

/** Delay before a pass is retried after a provider failure. */
const RETRY_MS = 30_000

/** Stop trying after this many consecutive provider failures. */
const MAX_FAILURES = 3

/** Keeps the vector index in step with the store. */
export class EmbeddingQueue {
  private readonly store: MemoryStore
  private readonly index: VectorIndex
  private readonly provider: EmbeddingProvider
  private readonly config: EmbeddingConfig
  private readonly debug: (message: string) => void
  private readonly manual: boolean
  private readonly pending = new Set<string>()
  private timer: NodeJS.Timeout | null = null
  private running = false
  private stopped = false
  private failures = 0
  private lastError: string | null = null
  private embedded = 0

  constructor(options: EmbeddingQueueOptions) {
    this.store = options.store
    this.index = options.index
    this.provider = options.provider
    this.config = options.config
    this.debug = options.debug
    this.manual = options.manual === true
  }

  /** Queue entries for (re)embedding; unknown ids are dropped when processed. */
  enqueue(ids: readonly string[]): void {
    if (this.stopped) return
    let added = 0
    for (const id of ids) {
      if (id.length === 0 || this.pending.has(id)) continue
      this.pending.add(id)
      added++
    }
    if (added > 0) this.schedule(0)
  }

  /** Queue every entry once: the initial backfill and a periodic safety net. */
  sweep(): void {
    if (this.stopped) return
    this.enqueue(this.store.allIds())
  }

  /** Load the model in the background and queue the first full sweep. */
  start(): void {
    if (this.stopped) return
    void this.provider
      .prewarm()
      .then(() => this.debug(`embeddings: ${this.provider.model} ready (worker)`))
      .catch((error: unknown) => this.recordFailure(error))
    this.sweep()
  }

  /** Stop scheduling work; in-flight embedding finishes on its own. */
  stop(): void {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  /** Run a whole pass and resolve when the queue is empty (tests, rebuilds). */
  async processAll(ids?: readonly string[]): Promise<void> {
    if (ids) this.enqueue(ids)
    else this.sweep()
    await this.drain()
  }

  status(): EmbeddingQueueStatus {
    const stats = this.index.stats()
    return {
      model: this.provider.model,
      backend: this.index.backend,
      chunks: stats.chunks,
      entries: stats.entries,
      bytes: stats.bytes,
      pending: this.pending.size,
      embedded: this.embedded,
      running: this.running,
      disabled: this.stopped,
      lastError: this.lastError,
    }
  }

  private recordFailure(error: unknown): void {
    this.failures++
    this.lastError = error instanceof Error ? error.message : String(error)
    this.debug(`embeddings: ${this.lastError}`)
    if (this.failures >= MAX_FAILURES) {
      this.stopped = true
      this.debug(`embeddings: disabled after ${MAX_FAILURES} consecutive failures; lexical search stays active`)
    }
  }

  private schedule(delay: number): void {
    if (this.stopped || this.manual || this.timer) return
    if (delay <= 0 && this.running) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.drain()
    }, delay)
    // A pending queue must not keep a headless process alive.
    this.timer.unref?.()
  }

  private async drain(): Promise<void> {
    if (this.running || this.stopped) return
    this.running = true
    try {
      while (this.pending.size > 0 && !this.stopped) {
        const batch: string[] = []
        const perPass = Math.max(1, this.config.batchSize)
        for (const id of this.pending) {
          if (batch.length >= perPass) break
          batch.push(id)
        }
        for (const id of batch) this.pending.delete(id)
        const ok = await this.embedEntries(batch)
        if (!ok) break
      }
    } catch (error) {
      this.recordFailure(error)
    } finally {
      this.running = false
      if (!this.stopped && this.pending.size > 0) this.schedule(this.failures > 0 ? RETRY_MS : 0)
    }
  }

  /** Embed the changed chunks of one batch of entries. */
  private async embedEntries(ids: readonly string[]): Promise<boolean> {
    const jobs: Array<{ entry: MemoryEntry; chunks: ReturnType<typeof entryChunks> }> = []
    const texts: string[] = []
    for (const id of ids) {
      const entry = this.store.get(id)
      if (!entry) {
        this.index.remove(id)
        continue
      }
      const chunks = entryChunks(entry, this.config)
      if (chunks.length === 0) continue
      const stored = this.index.storedHashes(id)
      if (chunksUnchanged(stored, chunks)) {
        // The text is unchanged, so nothing gets embedded — but the entry may
        // have moved project or changed kind/scope/tier/status, and every vector
        // row carries a copy of that metadata. Leaving it stale made filtered
        // searches answer with yesterday's scope (16.10.2026 finding).
        this.refreshMetadata(entry)
        continue
      }
      jobs.push({ entry, chunks })
      for (const chunk of chunks) texts.push(chunk.text)
    }
    if (texts.length === 0) return true

    let vectors: Float32Array[]
    try {
      const batch = await this.provider.embed(texts, 'passage')
      vectors = batch.vectors
      this.failures = 0
      this.lastError = null
    } catch (error) {
      this.recordFailure(error)
      for (const job of jobs) this.pending.add(job.entry.id)
      return false
    }

    let cursor = 0
    for (const job of jobs) {
      const records: VectorRecord[] = job.chunks.map((chunk) => {
        const vector = vectors[cursor++]
        if (!vector) throw new Error(`embeddings: the provider returned fewer vectors than texts (${job.entry.id})`)
        return {
          entryId: job.entry.id,
          chunkIndex: chunk.chunkIndex,
          scope: job.entry.scope,
          project: job.entry.project,
          kind: job.entry.kind,
          tier: job.entry.tier,
          status: job.entry.status,
          hash: chunk.hash,
          vector,
        }
      })
      // The chunk set changed, so stale positions are dropped before the write.
      this.index.remove(job.entry.id)
      this.index.upsert(records)
      this.embedded++
    }
    return true
  }

  /**
   * Rewrites the stored rows of one entry with its current metadata, keeping the
   * vectors as they are. The chunk hash covers text and model only, so this is
   * the only path a metadata-only change can travel to reach the vector table.
   */
  private refreshMetadata(entry: MemoryEntry): boolean {
    const rows = this.index.records([entry.id])
    if (rows.length === 0) return false
    const stale = rows.some(
      (row) =>
        row.scope !== entry.scope ||
        row.project !== entry.project ||
        row.kind !== entry.kind ||
        row.tier !== entry.tier ||
        row.status !== entry.status,
    )
    if (!stale) return false
    this.index.upsert(
      rows.map((row) => ({
        ...row,
        scope: entry.scope,
        project: entry.project,
        kind: entry.kind,
        tier: entry.tier,
        status: entry.status,
      })),
    )
    return true
  }
}
