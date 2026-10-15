/**
 * Local model cache: where the embedding model lives, how much space it takes
 * and how a download progresses.
 *
 * The model is cached inside the memory root (`<storageRoot>/_models`) instead of
 * the default cache inside `node_modules`, which a reinstall wipes. The settings
 * page reports this state and can start the download, so the aggregation of
 * transformers.js progress events lives here too: one place, unit-testable.
 *
 * @module dsh-llm-memory/core/model-cache
 */
import { readdirSync, rmSync, statSync, type Dirent } from 'node:fs'
import { join } from 'node:path'

/** Aggregated progress of one model download, as reported by transformers.js. */
export interface ModelDownloadProgress {
  /** Files whose download has been announced. */
  files: number
  /** Files already written completely. */
  doneFiles: number
  /** Bytes written so far, summed over the announced files. */
  loadedBytes: number
  /** Bytes announced so far; grows while new files appear. */
  totalBytes: number
  /** Whole-percent completion of the announced bytes (0-100). */
  percent: number
  /** File being written right now, when the library names one. */
  file?: string
}

/** On-disk state of the cached model. */
export interface ModelCacheStatus {
  /** Directory the model is cached in. */
  dir: string
  /** Whether the ONNX weights are on disk, that is the model can be loaded. */
  cached: boolean
  /** Files in the cache directory. */
  files: number
  /** Total size of the cache directory in bytes. */
  bytes: number
}

/** Directory transformers.js caches one model in. */
export function modelCacheDir(cacheDir: string, model: string): string {
  return join(cacheDir, ...model.split('/').filter((part) => part.length > 0))
}

/**
 * Measure the cached model.
 *
 * @param cacheDir - Root of the model cache (`<storageRoot>/_models`).
 * @param model - Model id, for example `Xenova/multilingual-e5-small`.
 * @returns The directory, its file count and size, and whether the weights exist.
 */
export function scanModelCache(cacheDir: string, model: string): ModelCacheStatus {
  const dir = modelCacheDir(cacheDir, model)
  let files = 0
  let bytes = 0
  let weights = 0
  const walk = (path: string): void => {
    let entries: Dirent[]
    try {
      entries = readdirSync(path, { withFileTypes: true })
    } catch {
      // Missing directory (nothing downloaded yet) or an unreadable one.
      return
    }
    for (const entry of entries) {
      const child = join(path, entry.name)
      if (entry.isDirectory()) {
        walk(child)
        continue
      }
      if (!entry.isFile()) continue
      files += 1
      try {
        const size = statSync(child).size
        bytes += size
        if (size > 0 && entry.name.endsWith('.onnx')) weights += 1
      } catch {
        // A download may replace a file while we measure it; skip it.
      }
    }
  }
  walk(dir)
  return { dir, cached: weights > 0, files, bytes }
}

/**
 * Delete leftovers of interrupted downloads.
 *
 * transformers.js writes `…onnx.tmp.<pid>.<random>` and renames it only once the
 * file is complete; a killed process (a harness restart, for example) leaves the
 * partial file behind. Without this sweep every restart adds another hundred
 * megabytes of junk that the next download ignores anyway.
 *
 * @param cacheDir - Root of the model cache.
 * @param model - Model id whose directory is swept.
 * @returns How many files were removed and how many bytes they held.
 */
export function sweepModelTempFiles(cacheDir: string, model: string): { files: number; bytes: number } {
  let files = 0
  let bytes = 0
  const walk = (path: string): void => {
    let entries: Dirent[]
    try {
      entries = readdirSync(path, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const child = join(path, entry.name)
      if (entry.isDirectory()) {
        walk(child)
        continue
      }
      if (!entry.isFile() || !entry.name.includes('.tmp.')) continue
      try {
        const size = statSync(child).size
        rmSync(child, { force: true })
        files += 1
        bytes += size
      } catch {
        // Already gone or not removable; the download path reports its own errors.
      }
    }
  }
  walk(modelCacheDir(cacheDir, model))
  return { files, bytes }
}

/**
 * Delete the cached model of one model id.
 *
 * Destructive: the caller owns the user confirmation.
 *
 * @param cacheDir - Root of the model cache.
 * @param model - Model id whose files are removed.
 * @returns The cache state after the removal (a missing directory).
 */
export function removeModelCache(cacheDir: string, model: string): ModelCacheStatus {
  rmSync(modelCacheDir(cacheDir, model), { recursive: true, force: true })
  return scanModelCache(cacheDir, model)
}

/**
 * Build the `progress_callback` transformers.js expects.
 *
 * The library reports progress per file (config, tokenizer, one or more `onnx`
 * shards), so the tracker keeps the last `loaded`/`total` per file and sums them
 * into one number the UI can show.
 *
 * @param onUpdate - Called after every event with the aggregated snapshot.
 * @returns A callback to hand to `pipeline(..., { progress_callback })`.
 */
export function createProgressTracker(
  onUpdate: (progress: ModelDownloadProgress) => void,
): (item: unknown) => void {
  const entries = new Map<string, { loaded: number; total: number; done: boolean }>()
  return (item: unknown): void => {
    if (typeof item !== 'object' || item === null) return
    const event = item as { status?: unknown; file?: unknown; loaded?: unknown; total?: unknown }
    const file = typeof event.file === 'string' && event.file.length > 0 ? event.file : undefined
    if (file === undefined) return
    const state = entries.get(file) ?? { loaded: 0, total: 0, done: false }
    if (typeof event.loaded === 'number' && Number.isFinite(event.loaded)) state.loaded = event.loaded
    if (typeof event.total === 'number' && Number.isFinite(event.total) && event.total > 0) {
      state.total = event.total
    }
    if (event.status === 'done') {
      state.done = true
      if (state.total > 0) state.loaded = state.total
    }
    entries.set(file, state)
    let loadedBytes = 0
    let totalBytes = 0
    let doneFiles = 0
    for (const entry of entries.values()) {
      loadedBytes += entry.loaded
      totalBytes += entry.total
      if (entry.done) doneFiles += 1
    }
    const percent =
      totalBytes > 0 ? Math.min(100, Math.max(0, Math.round((loadedBytes / totalBytes) * 100))) : 0
    onUpdate({
      files: entries.size,
      doneFiles,
      loadedBytes,
      totalBytes,
      percent,
      file: event.status === 'done' ? undefined : file,
    })
  }
}
