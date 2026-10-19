/**
 * The worker provider replaces its thread when a download has to re-read the
 * model from disk. Replacing it used to break downloads: `terminate()` makes
 * Node report the *old* worker with exit code 1, and the exit handler only
 * checked that some worker existed, so it failed the fresh worker that was
 * already loading the model. These tests pin the behaviour with a stub worker.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { mergeConfig } from '@llm-memory/core/domain/config'
import { WorkerEmbeddingProvider } from '@llm-memory/core/infrastructure/embeddings'

const workerPath = new URL('./helpers/stub-embed-worker.mjs', import.meta.url)
let roots: string[] = []

function makeProvider(progress = false) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-embed-worker-'))
  roots.push(root)
  const config = mergeConfig({}).embeddings
  const provider = new WorkerEmbeddingProvider(
    { ...config, provider: 'local' },
    { cacheDir: root, workerPath },
  )
  if (progress) provider.watchProgress(() => undefined)
  return provider
}

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
  roots = []
})

describe('WorkerEmbeddingProvider', () => {
  it('loads the model through the worker', async () => {
    const provider = makeProvider()
    await provider.prewarm()
    expect(provider.ready).toBe(true)
    provider.close()
  })

  it('keeps the replacement worker alive after reload terminates the old one', async () => {
    const provider = makeProvider(true)
    await provider.prewarm()
    expect(provider.ready).toBe(true)

    // Exactly what a download does: enable progress, drop the loaded worker,
    // then load again. The old worker's exit must not fail the new one.
    provider.reload()
    expect(provider.ready).toBe(false)
    await expect(provider.prewarm()).resolves.toBeUndefined()
    expect(provider.ready).toBe(true)
    provider.close()
  })

  it('rejects a request that was in flight when the worker is replaced', async () => {
    const provider = makeProvider()
    const inFlight = provider.prewarm()
    provider.reload()
    await expect(inFlight).rejects.toThrow(/reloaded/)
    provider.close()
  })
})
