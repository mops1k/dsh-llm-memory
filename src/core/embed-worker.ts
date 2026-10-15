/**
 * Worker entry point for embedding.
 *
 * ONNX inference does not yield the host event loop, so every embedding that is
 * not a single short query runs here; see `./embeddings.ts` for the reasoning
 * and the measurements. The worker holds one model instance and answers
 * `embed` / `prewarm` requests from {@link WorkerEmbeddingProvider}, returning
 * one transferable buffer per vector.
 *
 * @module dsh-llm-memory/core/embed-worker
 */
import { parentPort, workerData } from 'node:worker_threads'

import { debug } from './log.js'
import { LocalEmbeddingProvider } from './embeddings.js'
import type { EmbedWorkerData, EmbedWorkerRequest } from './embeddings.js'
import type { EmbeddingRole } from './types.js'

const port = parentPort
if (!port) throw new Error('embed-worker must be started as a worker thread')

const data = workerData as EmbedWorkerData | undefined
if (!data || !data.config) throw new Error('embed-worker started without workerData')

const provider = new LocalEmbeddingProvider(data.config, {
  cacheDir: data.cacheDir,
  dtype: data.dtype,
  debug,
})

port.on('message', (message: EmbedWorkerRequest) => {
  void (async () => {
    try {
      if (message.type === 'prewarm') {
        await provider.prewarm()
        port.postMessage({ id: message.id, ok: true, ready: true, model: provider.model, dim: provider.dim })
        return
      }
      const role: EmbeddingRole = message.role === 'query' ? 'query' : 'passage'
      const batch = await provider.embed(message.texts ?? [], role)
      const buffers = batch.vectors.map((vector) =>
        vector.buffer.slice(vector.byteOffset, vector.byteOffset + vector.byteLength),
      )
      port.postMessage(
        { id: message.id, ok: true, model: batch.model, dim: batch.dim, buffers },
        buffers as unknown as ArrayBuffer[],
      )
    } catch (error) {
      port.postMessage({
        id: message.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })()
})
