/**
 * Stub embedding worker for the provider tests.
 *
 * Speaks just enough of the `embed-worker` protocol to answer `prewarm` and
 * `embed`, with a delay so a test can replace the worker while a request is in
 * flight — the race that killed downloads on 2026-10-15.
 */
import { parentPort } from 'node:worker_threads'

if (!parentPort) throw new Error('stub-embed-worker must run as a worker thread')

parentPort.on('message', (message) => {
  if (message.type === 'prewarm') {
    setTimeout(() => {
      parentPort.postMessage({ id: message.id, ok: true, ready: true, model: 'stub-model', dim: 3 })
    }, 150)
    return
  }
  parentPort.postMessage({ id: message.id, ok: true, model: 'stub-model', dim: 3, buffers: [] })
})
