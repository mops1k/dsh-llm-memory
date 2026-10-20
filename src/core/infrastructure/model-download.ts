/**
 * Download-only model fetch: pulls the files of a Hugging Face model into the
 * local cache without loading ONNX. Used as a fallback when the embedding
 * runtime is not available in the host (for example a single-file Bun plugin),
 * so the "Download model" button still puts the weights on disk and the panel
 * can report an honest state.
 */
import { createWriteStream, existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { modelCacheDir, type ModelDownloadProgress } from './model-cache.js'
import { windowsExtendedPath } from '../layout/paths.js'

export type FetchLike = (input: string, init?: { signal?: AbortSignal; method?: string }) => Promise<{
  ok: boolean
  status: number
  headers: { get(name: string): string | null }
  arrayBuffer(): Promise<ArrayBuffer>
  body?: AsyncIterable<Uint8Array> | null
}>

export interface DownloadModelOptions {
  /** Root of the model cache (`<storageRoot>/_models`). */
  cacheDir: string
  /** Model id, for example `Xenova/multilingual-e5-small`. */
  model: string
  onProgress?: (progress: ModelDownloadProgress) => void
  signal?: AbortSignal
  fetchImpl?: FetchLike
  /** Base URL of the hub (tests stub it). */
  endpoint?: string
  debug?: (message: string) => void
}

export interface DownloadModelResult {
  dir: string
  files: number
  bytes: number
}

/** Files that are not needed to load the model. */
const SKIP_FILES = new Set(['.gitattributes', 'README.md'])

/**
 * Fetch every file of `model` into `<cacheDir>/<model>`. Existing files with a
 * matching size are kept, so an interrupted run resumes instead of restarting.
 */
export async function downloadModelFiles(options: DownloadModelOptions): Promise<DownloadModelResult> {
  const endpoint = (options.endpoint ?? 'https://huggingface.co').replace(/\/+$/u, '')
  const doFetch = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike)
  const reportedDir = modelCacheDir(options.cacheDir, options.model)
  // Deep project roots can push the cache over MAX_PATH on Windows.
  const dir = windowsExtendedPath(reportedDir)
  mkdirSync(dir, { recursive: true })

  const meta = await doFetch(`${endpoint}/api/models/${options.model}`)
  if (!meta.ok) throw new Error(`Cannot list the model files: HTTP ${meta.status}`)
  const payload = JSON.parse(Buffer.from(await meta.arrayBuffer()).toString('utf8')) as {
    siblings?: Array<{ rfilename?: string }>
  }
  const all = (payload.siblings ?? [])
    .map(entry => entry.rfilename)
    .filter((name): name is string => typeof name === 'string' && name.length > 0 && !SKIP_FILES.has(name))
  // One ONNX variant is enough; the quantized one is what the runtime loads by
  // default and it is ~15x smaller than the full float weights.
  const preferred = ['onnx/model_quantized.onnx', 'onnx/model_int8.onnx', 'onnx/model_uint8.onnx', 'onnx/model_q4.onnx', 'onnx/model_fp16.onnx']
  const choice = preferred.find(name => all.includes(name)) ?? all.find(name => name.endsWith('.onnx'))
  const files = all.filter(name => !name.endsWith('.onnx') || name === choice)
  if (files.length === 0) throw new Error('The model repository has no files')

  const progress: ModelDownloadProgress = { files: files.length, doneFiles: 0, loadedBytes: 0, totalBytes: 0, percent: 0 }
  const emit = (): void => options.onProgress?.({ ...progress })
  emit()

  for (const name of files) {
    const target = join(dir, name)
    const url = `${endpoint}/${options.model}/resolve/main/${name}`
    // HEAD first: a complete file is kept without transferring its body again.
    const head = await doFetch(url, { method: 'HEAD' })
    const length = head.ok ? Number(head.headers.get('content-length') ?? 0) : 0
    const known = existsSync(target) ? statSync(target).size : -1
    if (length > 0 && known === length) {
      progress.totalBytes += length
      progress.loadedBytes += length
      progress.doneFiles += 1
      emit()
      continue
    }
    const response = await doFetch(url, options.signal ? { signal: options.signal } : {})
    if (!response.ok) throw new Error(`Cannot download ${name}: HTTP ${response.status}`)
    mkdirSync(dirname(target), { recursive: true })
    const bytes = Buffer.from(await response.arrayBuffer())
    mkdirSync(dirname(target), { recursive: true })
    await new Promise<void>((resolve, reject) => {
      const stream = createWriteStream(target)
      stream.on('error', reject)
      stream.on('finish', () => resolve())
      stream.end(bytes)
    })
    progress.totalBytes += bytes.length
    progress.loadedBytes += bytes.length
    progress.doneFiles += 1
    progress.percent = progress.totalBytes > 0 ? Math.round((progress.loadedBytes / progress.totalBytes) * 100) : 0
    progress.file = name
    emit()
  }

  const total = files.reduce((sum, name) => {
    try {
      return sum + statSync(join(dir, name)).size
    } catch {
      return sum
    }
  }, 0)
  return { dir, files: files.length, bytes: total }
}
