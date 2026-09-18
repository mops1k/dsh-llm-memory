import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import { Readable } from 'node:stream'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { mergeConfig } from '../src/core/config'
import { MemoryEngine } from '../src/core/engine'
import { createWebHandler, normalizeWebPath, type WebHandler } from '../src/dsh/web'
import { cleanupRoot, makeTempRoot } from './helpers'

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
