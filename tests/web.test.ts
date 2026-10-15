import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import { Readable } from 'node:stream'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { mergeConfig } from '../src/core/config'
import { MemoryEngine } from '../src/core/engine'
import { createWebHandler, normalizeWebPath, type WebHandler } from '../src/dsh/web'
import { cleanupRoot, makeTempRoot } from './helpers'
import { FakeEmbeddingProvider } from './helpers/fake-embeddings'

interface MockResponse {
  statusCode: number
  headers: Record<string, string>
  body: string
  writableEnded: boolean
  setHeader(name: string, value: string): void
  end(chunk?: string): void
}

let root: string
let engine: MemoryEngine
let handler: WebHandler

beforeEach(() => {
  root = makeTempRoot('dsh-web-')
  engine = new MemoryEngine({ storageRoot: root, project: 'demo' })
  handler = createWebHandler(engine, mergeConfig({ webPath: '/llm-memory' }))
})

afterEach(() => {
  engine.close()
  cleanupRoot(root)
})

function makeRequest(method: string, url: string, body?: unknown, address = '127.0.0.1'): IncomingMessage {
  const req = new Readable({ read() {} }) as unknown as IncomingMessage & {
    method: string
    url: string
    headers: Record<string, string>
    socket: { remoteAddress: string }
  }
  req.method = method
  req.url = url
  req.headers = { 'content-type': 'application/json' }
  req.socket = { remoteAddress: address }
  const payload = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body)
  process.nextTick(() => {
    if (payload.length > 0) req.push(payload)
    req.push(null)
  })
  return req
}

function makeResponse(): MockResponse {
  const res: MockResponse = {
    statusCode: 200,
    headers: {},
    body: '',
    writableEnded: false,
    setHeader(name, value) {
      res.headers[name.toLowerCase()] = String(value)
    },
    end(chunk) {
      if (chunk !== undefined) res.body += chunk
      res.writableEnded = true
    },
  }
  return res
}

async function call(method: string, url: string, body?: unknown, address?: string): Promise<MockResponse> {
  const res = makeResponse()
  await handler(
    makeRequest(method, url, body, address) as unknown as IncomingMessage,
    res as unknown as ServerResponse,
  )
  return res
}

function json(res: MockResponse): Record<string, unknown> {
  return JSON.parse(res.body) as Record<string, unknown>
}

/** Write the weights file of the configured model, so the cache looks complete. */
function writeStubWeights(storageRoot: string): void {
  const dir = join(storageRoot, '_models', 'Xenova', 'multilingual-e5-small', 'onnx')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'model_quantized.onnx'), 'y'.repeat(8))
}

/**
 * Local-looking provider: the "did anything land on disk" guard only applies to
 * `id === 'local'`, and the tests need to observe the reload call.
 */
class StubLocalProvider extends FakeEmbeddingProvider {
  readonly id = 'local'
  readonly model = 'Xenova/multilingual-e5-small'
  reloadCalls = 0
  private readonly writeCache?: () => void

  constructor(writeCache?: () => void) {
    super()
    this.writeCache = writeCache
  }

  reload(): void {
    this.reloadCalls += 1
  }

  override async prewarm(): Promise<void> {
    this.prewarmed = true
    if (this.writeCache) this.writeCache()
  }
}

describe('normalizeWebPath', () => {
  it('normalizes configured paths', () => {
    expect(normalizeWebPath(undefined)).toBe('/llm-memory')
    expect(normalizeWebPath('')).toBe('/llm-memory')
    expect(normalizeWebPath('llm-memory')).toBe('/llm-memory')
    expect(normalizeWebPath('/llm-memory/')).toBe('/llm-memory')
  })
})

describe('createWebHandler', () => {
  it('serves the status report as JSON', async () => {
    engine.save({ text: 'The project uses Node 24.', title: 'Runtime', kind: 'facts' })
    const res = await call('GET', '/llm-memory/api/status')
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('application/json')
    const data = json(res)
    expect(data.total).toBe(1)
    expect(data.active).toBe(1)
    expect(typeof data.dbPath).toBe('string')
  })

  it('serves the UI page as HTML', async () => {
    const res = await call('GET', '/llm-memory/ui')
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/html')
    expect(res.body).toContain('LLM Memory')
  })

  it('lists entries and reads a single item', async () => {
    const saved = engine.save({ text: 'Alpha fact about builds.', title: 'Alpha', kind: 'facts' })
    engine.save({ text: 'Beta preference.', title: 'Beta', kind: 'preferences' })

    const list = await call('GET', '/llm-memory/api/items?kind=facts&limit=10')
    expect(list.statusCode).toBe(200)
    const listed = json(list)
    expect(Array.isArray(listed.items)).toBe(true)
    expect((listed.items as unknown[]).length).toBe(1)

    const item = await call('GET', `/llm-memory/api/item?id=${saved.id}`)
    expect(item.statusCode).toBe(200)
    expect((json(item).item as { id: string }).id).toBe(saved.id)

    const missing = await call('GET', '/llm-memory/api/item?id=m_missing')
    expect(missing.statusCode).toBe(404)
  })

  it('answers 404 for unknown paths and paths outside the prefix', async () => {
    expect((await call('GET', '/llm-memory/api/nope')).statusCode).toBe(404)
    expect((await call('GET', '/somewhere/else')).statusCode).toBe(404)
  })

  it('rejects non-loopback peers', async () => {
    const res = await call('GET', '/llm-memory/api/status', undefined, '10.0.0.5')
    expect(res.statusCode).toBe(403)
  })

  it('answers 405 for a wrong method on a known route', async () => {
    const res = await call('POST', '/llm-memory/api/status', {})
    expect(res.statusCode).toBe(405)
    expect(res.headers['allow']).toBe('GET')
  })

  it('creates, updates, forgets and deletes entries through the API', async () => {
    const created = await call('POST', '/llm-memory/api/save', {
      title: 'Decision',
      text: 'Use PostgreSQL.',
      kind: 'decisions',
      tags: ['db'],
    })
    expect(created.statusCode).toBe(200)
    const createdBody = json(created)
    expect(createdBody.mode).toBe('created')
    const id = (createdBody.item as { id: string }).id
    expect(engine.get(id)?.title).toBe('Decision')

    const updated = await call('POST', '/llm-memory/api/save', { id, text: 'Use PostgreSQL 16.' })
    expect(updated.statusCode).toBe(200)
    expect(json(updated).mode).toBe('updated')
    expect(engine.get(id)?.text).toBe('Use PostgreSQL 16.')

    const forgotten = await call('POST', '/llm-memory/api/forget', { id })
    expect(forgotten.statusCode).toBe(200)
    expect(engine.get(id)?.status).toBe('superseded')

    const deleted = await call('POST', '/llm-memory/api/delete', { id })
    expect(deleted.statusCode).toBe(200)
    expect(json(deleted).deleted).toBe(true)
    expect(engine.get(id)).toBeNull()

    const missing = await call('POST', '/llm-memory/api/delete', { id })
    expect(missing.statusCode).toBe(404)
  })

  it('validates the save body', async () => {
    const noText = await call('POST', '/llm-memory/api/save', { title: 'x' })
    expect(noText.statusCode).toBe(400)
    const badJson = await call('POST', '/llm-memory/api/save', '{not json')
    expect(badJson.statusCode).toBe(400)
  })

  it('heals broken links through the API', async () => {
    const a = engine.save({ text: 'Alpha body.', title: 'Alpha' })
    engine.save({ text: 'Beta body.', title: 'Beta' })
    engine.update(a.id, { related: ['m_missing'] })
    expect(engine.lintReport().brokenLinks).toHaveLength(1)

    const res = await call('POST', '/llm-memory/api/heal', {})
    expect(res.statusCode).toBe(200)
    const report = json(res)
    expect(report.removedLinks).toBe(1)
    expect(report.brokenAfter).toBe(0)
    expect(engine.lintReport().brokenLinks).toHaveLength(0)
  })
})

describe('rules preview route', () => {
  const originalDshHome = process.env['DSH_HOME']

  afterEach(() => {
    if (originalDshHome === undefined) delete process.env['DSH_HOME']
    else process.env['DSH_HOME'] = originalDshHome
  })

  it('returns the preview as JSON without touching AGENTS.md', async () => {
    const dshHome = join(root, 'dsh-home')
    const kiloDir = join(root, 'kilo')
    mkdirSync(kiloDir, { recursive: true })
    writeFileSync(join(kiloDir, 'AGENTS.md'), '# Kilo AGENTS\n\nPreview rule.\n', 'utf8')
    process.env['DSH_HOME'] = dshHome

    const previewHandler = createWebHandler(
      engine,
      mergeConfig({
        webPath: '/llm-memory',
        importAutoDetect: false,
        importRoots: [kiloDir],
        rulesSource: 'kilo-verbatim',
      }),
    )
    const target = join(dshHome, 'AGENTS.md')

    const res = makeResponse()
    await previewHandler(
      makeRequest('POST', '/llm-memory/api/rules/preview', {}) as unknown as IncomingMessage,
      res as unknown as ServerResponse,
    )
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('application/json')
    const data = json(res)
    expect(data.target).toBe(target)
    expect(data.mode).toBe('create')
    expect(typeof data.block).toBe('string')
    expect(data.block).toContain('Preview rule.')
    expect(Array.isArray(data.sources)).toBe(true)
    expect((data.sources as unknown[]).length).toBe(1)
    expect(existsSync(target)).toBe(false)

    const getRes = makeResponse()
    await previewHandler(
      makeRequest('GET', '/llm-memory/api/rules/preview') as unknown as IncomingMessage,
      getRes as unknown as ServerResponse,
    )
    expect(getRes.statusCode).toBe(200)
    expect(json(getRes).block).toContain('Preview rule.')
    expect(existsSync(target)).toBe(false)
  })
})

describe('model cache routes', () => {
  it('reports the cache state and refuses a download while vector search is off', async () => {
    const status = await call('GET', '/llm-memory/api/model/status')
    expect(status.statusCode).toBe(200)
    const state = json(status)
    expect(state.cached).toBe(false)
    expect(state.enabled).toBe(false)
    expect(String(state.dir)).toContain('_models')

    const download = await call('POST', '/llm-memory/api/model/download', {})
    expect(download.statusCode).toBe(400)
    expect(String(json(download).error)).toContain('disabled')
  })

  it('starts a download through an injected provider and clears the flag', async () => {
    const provider = new StubLocalProvider(() => writeStubWeights(root))
    const own = new MemoryEngine({ storageRoot: root, project: 'demo', embeddingProvider: provider })
    const ownHandler = createWebHandler(own, mergeConfig({ webPath: '/llm-memory' }))
    const invoke = async (method: string, url: string, body?: unknown): Promise<MockResponse> => {
      const res = makeResponse()
      await ownHandler(
        makeRequest(method, url, body) as unknown as IncomingMessage,
        res as unknown as ServerResponse,
      )
      return res
    }

    const started = await invoke('POST', '/llm-memory/api/model/download', {})
    expect(started.statusCode).toBe(200)
    expect(json(started).downloading).toBe(true)
    expect(provider.prewarmed).toBe(true)

    await new Promise((resolve) => setTimeout(resolve, 0))
    const settled = json(await invoke('GET', '/llm-memory/api/model/status'))
    expect(settled.downloading).toBe(false)
    expect(settled.cached).toBe(true)
    expect(settled.error).toBe(null)
    own.close()
  })

  it('skips the reload when the model is already cached', async () => {
    writeStubWeights(root)
    const provider = new StubLocalProvider()
    const own = new MemoryEngine({ storageRoot: root, project: 'demo', embeddingProvider: provider })
    const ownHandler = createWebHandler(own, mergeConfig({ webPath: '/llm-memory' }))

    const res = makeResponse()
    await ownHandler(
      makeRequest('POST', '/llm-memory/api/model/download', {}) as unknown as IncomingMessage,
      res as unknown as ServerResponse,
    )
    expect(res.statusCode).toBe(200)
    expect(provider.reloadCalls).toBe(0)
    own.close()
  })

  it('reloads the provider and reports an error when a local download writes nothing', async () => {
    const provider = new StubLocalProvider()
    const own = new MemoryEngine({ storageRoot: root, project: 'demo', embeddingProvider: provider })
    const ownHandler = createWebHandler(own, mergeConfig({ webPath: '/llm-memory' }))

    await ownHandler(
      makeRequest('POST', '/llm-memory/api/model/download', {}) as unknown as IncomingMessage,
      makeResponse() as unknown as ServerResponse,
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    const status = makeResponse()
    await ownHandler(
      makeRequest('GET', '/llm-memory/api/model/status') as unknown as IncomingMessage,
      status as unknown as ServerResponse,
    )
    // An in-memory model must be dropped, otherwise nothing is fetched at all.
    expect(provider.reloadCalls).toBe(1)
    expect(json(status).cached).toBe(false)
    expect(String(json(status).error)).toContain('No model files')
    own.close()
  })

  it('keeps the vector leg off while the model is missing', async () => {
    const provider = new StubLocalProvider()
    const own = new MemoryEngine({ storageRoot: root, project: 'demo', embeddingProvider: provider })
    const ownHandler = createWebHandler(own, mergeConfig({ webPath: '/llm-memory' }))

    // Building the vector leg must not start a download in the background: that
    // is what made a restart fetch 130 MB behind the user's back.
    own.startVectors()
    const status = makeResponse()
    await ownHandler(
      makeRequest('GET', '/llm-memory/api/model/status') as unknown as IncomingMessage,
      status as unknown as ServerResponse,
    )
    const state = json(status)
    expect(state.configured).toBe(true)
    expect(state.enabled).toBe(false)
    expect(state.cached).toBe(false)
    expect(provider.prewarmed).toBe(false)
    own.close()
  })

  it('deletes a cached model through the API', async () => {
    const dir = join(root, '_models', 'Xenova', 'multilingual-e5-small', 'onnx')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'model_quantized.onnx'), 'y'.repeat(8))

    expect(json(await call('GET', '/llm-memory/api/model/status')).cached).toBe(true)
    const removed = await call('POST', '/llm-memory/api/model/remove', {})
    expect(removed.statusCode).toBe(200)
    expect(json(removed).cached).toBe(false)
    expect(existsSync(join(root, '_models', 'Xenova', 'multilingual-e5-small'))).toBe(false)
  })
})

describe('semantic map routes', () => {
  /** Engine with three embedded entries plus its own handler. */
  async function vectorHandler(): Promise<{
    engine: MemoryEngine
    invoke: (method: string, url: string, body?: unknown) => Promise<MockResponse>
  }> {
    const own = new MemoryEngine({
      storageRoot: root,
      project: 'demo',
      manualEmbeddings: true,
      embeddingProvider: new FakeEmbeddingProvider(),
      config: { embeddings: { chunkChars: 200, chunkOverlap: 0 } },
    })
    own.save({ title: 'Индексация памяти', text: 'Fingerprint и reconcileFromDisk вместо полного reindex.' })
    own.save({ title: 'Язык общения', text: 'Ответы только на русском языке.' })
    own.save({ title: 'Векторный поиск', text: 'sqlite-vec и js дают одинаковые результаты поиска.' })
    await own.embedPending()
    const ownHandler = createWebHandler(own, mergeConfig({ webPath: '/llm-memory' }))
    const invoke = async (method: string, url: string, body?: unknown): Promise<MockResponse> => {
      const res = makeResponse()
      await ownHandler(
        makeRequest(method, url, body) as unknown as IncomingMessage,
        res as unknown as ServerResponse,
      )
      return res
    }
    return { engine: own, invoke }
  }

  it('returns coordinates for every embedded entry and caches them', async () => {
    const { engine: own, invoke } = await vectorHandler()

    const first = await invoke('GET', '/llm-memory/api/vectors/map')
    expect(first.statusCode).toBe(200)
    const payload = json(first)
    expect(payload.reason).toBe(null)
    const map = payload.map as Record<string, unknown>
    const points = map.points as Array<Record<string, unknown>>
    expect(points.length).toBe(3)
    expect(map.cached).toBe(false)
    expect(map.chunks).toBeGreaterThan(0)
    for (const point of points) {
      expect(Number.isFinite(point.x)).toBe(true)
      expect(Number.isFinite(point.y)).toBe(true)
      expect(point.chunks).toBeGreaterThan(0)
      expect(String(point.id)).toMatch(/^m_/)
    }
    const explained = map.explained as number[]
    expect(explained[0]).toBeGreaterThanOrEqual(explained[1]!)

    // Same counters, same store: the second call may reuse the coordinates…
    expect((json(await invoke('GET', '/llm-memory/api/vectors/map')).map as Record<string, unknown>).cached).toBe(true)
    // …and ?refresh=1 rebuilds them, which is deterministic, so the numbers match.
    const refreshed = json(await invoke('GET', '/llm-memory/api/vectors/map?refresh=1')).map as Record<string, unknown>
    expect(refreshed.cached).toBe(false)
    expect(refreshed.points).toEqual(map.points)
    own.close()
  })

  it('places a query on the map and rejects an empty one', async () => {
    const { engine: own, invoke } = await vectorHandler()

    const placed = await invoke('POST', '/llm-memory/api/vectors/map/query', { text: 'Fingerprint и reindex', limit: 3 })
    expect(placed.statusCode).toBe(200)
    const query = json(placed)
    expect(Number.isFinite(query.x)).toBe(true)
    expect(Number.isFinite(query.y)).toBe(true)
    const hits = query.hits as Array<Record<string, unknown>>
    expect(hits.length).toBeGreaterThan(0)
    expect(Number(hits[0]!.score)).toBeGreaterThan(0)
    expect(typeof query.model).toBe('string')

    for (const body of [{}, { text: '   ' }]) {
      const empty = await invoke('POST', '/llm-memory/api/vectors/map/query', body)
      expect(empty.statusCode).toBe(400)
      expect(String(json(empty).error)).toContain('text is required')
    }

    // The map itself is a GET route.
    const wrongMethod = await invoke('POST', '/llm-memory/api/vectors/map', {})
    expect(wrongMethod.statusCode).toBe(405)
    own.close()
  })

  it('explains an empty map when vector search is off', async () => {
    const off = json(await call('GET', '/llm-memory/api/vectors/map'))
    expect(off.map).toBe(null)
    expect(off.reason).toBe('not-configured')

    const query = await call('POST', '/llm-memory/api/vectors/map/query', { text: 'Fingerprint' })
    expect(query.statusCode).toBe(400)
    expect(String(json(query).error)).toContain('unavailable')
  })
})

describe('recall route', () => {
  it('returns hits with the legs that produced them and the rendered text', async () => {
    engine.save({ title: 'Нужный факт', text: 'Здесь встречается слово needle и больше ничего.' })
    engine.save({ title: 'Другое', text: 'Запись совсем про другое, без нужного слова.' })

    const response = await call('POST', '/llm-memory/api/recall', { query: 'needle' })
    expect(response.statusCode).toBe(200)
    const payload = json(response)
    const items = payload.items as Array<Record<string, unknown>>
    expect(items.length).toBeGreaterThan(0)
    expect(items[0]!['title']).toBe('Нужный факт')
    // No vector leg on this engine, so the lexical leg is what must be reported.
    expect(items[0]!['sources']).toContain('bm25')
    expect(String(payload.text)).toContain('Нужный факт')
    expect(payload.format).toBe('markdown')

    const jsonFormat = json(await call('POST', '/llm-memory/api/recall', { query: 'needle', format: 'json' }))
    expect(jsonFormat.format).toBe('json')
    expect(String(jsonFormat.text)).toContain('sources')

    const empty = await call('POST', '/llm-memory/api/recall', {})
    expect(empty.statusCode).toBe(400)
    expect(String(json(empty).error)).toContain('query is required')
  })
})
