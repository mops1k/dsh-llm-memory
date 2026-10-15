/**
 * The settings page offers a "Download model" button, so the model cache has to
 * be measurable (size, file count, whether the weights exist) and a download has
 * to report progress. Both live in `core/model-cache.ts` and are covered here
 * without touching the network.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  createProgressTracker,
  modelCacheDir,
  removeModelCache,
  scanModelCache,
  sweepModelTempFiles,
  type ModelDownloadProgress,
} from '../src/core/model-cache'

const MODEL = 'Xenova/multilingual-e5-small'
let roots: string[] = []

function tempCache(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-model-cache-'))
  roots.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of roots) rmSync(dir, { recursive: true, force: true })
  roots = []
})

describe('scanModelCache', () => {
  it('reports an empty cache before anything is downloaded', () => {
    const cache = tempCache()
    const status = scanModelCache(cache, MODEL)
    expect(status.dir).toBe(join(cache, 'Xenova', 'multilingual-e5-small'))
    expect(status.cached).toBe(false)
    expect(status.files).toBe(0)
    expect(status.bytes).toBe(0)
  })

  it('counts files and marks the model cached once the weights exist', () => {
    const cache = tempCache()
    const dir = modelCacheDir(cache, MODEL)
    mkdirSync(join(dir, 'onnx'), { recursive: true })
    writeFileSync(join(dir, 'config.json'), '{}')
    writeFileSync(join(dir, 'tokenizer.json'), 'x'.repeat(100))
    writeFileSync(join(dir, 'onnx', 'model_quantized.onnx'), 'y'.repeat(2048))

    const status = scanModelCache(cache, MODEL)
    expect(status.cached).toBe(true)
    expect(status.files).toBe(3)
    expect(status.bytes).toBe(2 + 100 + 2048)
  })

  it('does not treat an empty weights file as a usable model', () => {
    const cache = tempCache()
    const dir = modelCacheDir(cache, MODEL)
    mkdirSync(join(dir, 'onnx'), { recursive: true })
    writeFileSync(join(dir, 'onnx', 'model_quantized.onnx'), '')

    const status = scanModelCache(cache, MODEL)
    expect(status.cached).toBe(false)
    expect(status.files).toBe(1)
  })

  it('removes the model directory only', () => {
    const cache = tempCache()
    const dir = modelCacheDir(cache, MODEL)
    mkdirSync(join(dir, 'onnx'), { recursive: true })
    writeFileSync(join(dir, 'onnx', 'model_quantized.onnx'), 'y'.repeat(16))
    const other = modelCacheDir(cache, 'Xenova/other-model')
    mkdirSync(other, { recursive: true })
    writeFileSync(join(other, 'model.onnx'), 'z')

    const status = removeModelCache(cache, MODEL)
    expect(existsSync(dir)).toBe(false)
    expect(status.cached).toBe(false)
    expect(status.files).toBe(0)
    expect(existsSync(other)).toBe(true)
  })
})

describe('sweepModelTempFiles', () => {
  it('removes leftovers of interrupted downloads and keeps the real files', () => {
    const cache = tempCache()
    const dir = modelCacheDir(cache, MODEL)
    mkdirSync(join(dir, 'onnx'), { recursive: true })
    writeFileSync(join(dir, 'config.json'), '{}')
    writeFileSync(join(dir, 'onnx', 'model_quantized.onnx'), 'y'.repeat(32))
    writeFileSync(join(dir, 'onnx', 'model_quantized.onnx.tmp.1056.z4l09u'), 'z'.repeat(4096))
    writeFileSync(join(dir, 'onnx', 'model_quantized.onnx.tmp.1183.1448hsi'), 'z'.repeat(2048))

    const swept = sweepModelTempFiles(cache, MODEL)
    expect(swept.files).toBe(2)
    expect(swept.bytes).toBe(4096 + 2048)
    expect(existsSync(join(dir, 'onnx', 'model_quantized.onnx.tmp.1056.z4l09u'))).toBe(false)
    expect(existsSync(join(dir, 'onnx', 'model_quantized.onnx'))).toBe(true)
    expect(scanModelCache(cache, MODEL).cached).toBe(true)
  })

  it('reports nothing for a cache without leftovers', () => {
    const cache = tempCache()
    expect(sweepModelTempFiles(cache, MODEL)).toEqual({ files: 0, bytes: 0 })
  })
})

describe('createProgressTracker', () => {
  it('aggregates per-file events into one percentage', () => {
    const seen: ModelDownloadProgress[] = []
    const track = createProgressTracker((progress) => seen.push(progress))

    track({ status: 'initiate', file: 'config.json' })
    track({ status: 'progress', file: 'config.json', loaded: 50, total: 100 })
    track({ status: 'done', file: 'config.json' })
    track({ status: 'progress', file: 'onnx/model_quantized.onnx', loaded: 300, total: 900 })

    expect(seen.at(-1)).toEqual({
      files: 2,
      doneFiles: 1,
      loadedBytes: 400,
      totalBytes: 1000,
      percent: 40,
      file: 'onnx/model_quantized.onnx',
    })
  })

  it('falls back to zero percent while no total is known', () => {
    const seen: ModelDownloadProgress[] = []
    const track = createProgressTracker((progress) => seen.push(progress))
    track({ status: 'download', file: 'tokenizer.json' })
    expect(seen.at(-1)).toMatchObject({ files: 1, percent: 0, loadedBytes: 0, totalBytes: 0 })
  })

  it('ignores events without a file name', () => {
    let calls = 0
    const track = createProgressTracker(() => {
      calls += 1
    })
    track(undefined)
    track({ status: 'progress', loaded: 10, total: 100 })
    expect(calls).toBe(0)
  })
})
