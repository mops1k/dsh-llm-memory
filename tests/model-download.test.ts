import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { ModelManager } from '@llm-memory/core/application/model-manager'
import { DEFAULT_CONFIG } from '@llm-memory/core/domain/config'
import { downloadModelFiles, type FetchLike } from '@llm-memory/core/infrastructure/model-download'

const dirs: string[] = []
function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'model-download-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function fakeFetch(files: Record<string, string>, calls: string[] = []): FetchLike {
  return async (input, init) => {
    calls.push((init?.method ?? 'GET') + ' ' + input)
    if (init?.method === 'HEAD') {
      const headName = input.split('/resolve/main/')[1] ?? ''
      const headBody = files[headName]
      const headBytes = headBody === undefined ? 0 : Buffer.byteLength(headBody)
      return {
        ok: headBody !== undefined,
        status: headBody === undefined ? 404 : 200,
        headers: { get: (header: string) => (header === 'content-length' ? String(headBytes) : null) },
        arrayBuffer: async () => new ArrayBuffer(0),
      }
    }
    if (input.endsWith('/api/models/org/model')) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        arrayBuffer: async () =>
          new TextEncoder().encode(JSON.stringify({ siblings: Object.keys(files).map(rfilename => ({ rfilename })) })).buffer,
      }
    }
    const name = input.split('/resolve/main/')[1] ?? ''
    const body = files[name]
    if (body === undefined) return { ok: false, status: 404, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) }
    const bytes = Buffer.from(body, 'utf8')
    return {
      ok: true,
      status: 200,
      headers: { get: (header: string) => (header === 'content-length' ? String(bytes.length) : null) },
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    }
  }
}

describe('download-only model fetch', () => {
  it('writes every model file into the cache and skips housekeeping files', async () => {
    const cache = temp()
    const files = {
      'config.json': '{"model":"x"}',
      'tokenizer.json': '{"vocab":{}}',
      'onnx/model.onnx': 'large',
      'onnx/model_quantized.onnx': 'onnx-weights',
      '.gitattributes': 'ignored',
    }
    const progress: number[] = []
    const result = await downloadModelFiles({
      cacheDir: cache,
      model: 'org/model',
      fetchImpl: fakeFetch(files),
      onProgress: p => progress.push(p.percent ?? 0),
    })
    const dir = join(cache, 'org', 'model')
    expect(result.files).toBe(3)
    expect(readFileSync(join(dir, 'onnx', 'model_quantized.onnx'), 'utf8')).toBe('onnx-weights')
    expect(existsSync(join(dir, 'onnx', 'model.onnx'))).toBe(false)
    expect(readFileSync(join(dir, 'config.json'), 'utf8')).toBe('{"model":"x"}')
    expect(existsSync(join(dir, '.gitattributes'))).toBe(false)
    expect(progress.at(-1)).toBe(100)
  })

  it('keeps a complete file instead of downloading it again', async () => {
    const cache = temp()
    const files = { 'onnx/model.onnx': 'weights', 'config.json': '{}' }
    const dir = join(cache, 'org', 'model')
    mkdirSync(join(dir, 'onnx'), { recursive: true })
    writeFileSync(join(dir, 'onnx', 'model.onnx'), 'weights')
    expect(statSync(join(dir, 'onnx', 'model.onnx')).size).toBe(Buffer.byteLength('weights'))
    const calls: string[] = []
    await downloadModelFiles({ cacheDir: cache, model: 'org/model', fetchImpl: fakeFetch(files, calls) })
    expect(calls.some(call => call.startsWith('GET ') && call.endsWith('model.onnx'))).toBe(false)
    expect(calls.some(call => call.startsWith('GET ') && call.endsWith('config.json'))).toBe(true)
  })

  it('reports a clear error when the repository cannot be listed', async () => {
    const cache = temp()
    const failing: FetchLike = async () => ({ ok: false, status: 404, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) })
    await expect(downloadModelFiles({ cacheDir: cache, model: 'org/model', fetchImpl: failing })).rejects.toThrow('Cannot list the model files')
  })
})

describe('ModelManager fallback without an embedding runtime', () => {
  it('downloads the files when no provider exists (single-file plugin)', async () => {
    const cache = temp()
    const manager = new ModelManager({
      settings: { ...DEFAULT_CONFIG.embeddings, provider: 'local', model: 'org/model', dim: 3 },
      cacheDir: cache,
      createProvider: () => null,
      fetchImpl: fakeFetch({ 'onnx/model.onnx': 'weights', 'config.json': '{}' }),
    })
    const started = manager.download()
    expect(started.downloading).toBe(true)
    let status = manager.status()
    for (let i = 0; i < 100 && status.downloading; i += 1) {
      await new Promise(resolve => setTimeout(resolve, 10))
      status = manager.status()
    }
    expect(status.downloading).toBe(false)
    expect(status.cached).toBe(true)
    expect(status.files).toBe(2)
  })
})
