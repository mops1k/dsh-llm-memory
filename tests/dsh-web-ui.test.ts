import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { mergeConfig } from '@llm-memory/core/domain/config'
import { MemoryEngine } from '@llm-memory/core/application/engine'
import { createWebHandler, normalizeWebPath, type WebHandler } from '../src/dsh/web'
import { cleanupRoot, makeTempRoot } from './helpers'

let root: string
let engine: MemoryEngine
let handler: WebHandler

beforeEach(() => {
  root = makeTempRoot('dsh-ui-')
  engine = new MemoryEngine({ storageRoot: root })
  handler = createWebHandler(engine, mergeConfig({ webPath: '/llm-memory' }), { storageRoot: root })
})

afterEach(() => {
  engine.close()
  cleanupRoot(root)
})

function request(method: string, url: string, body?: unknown): Promise<{ status: number; body: string }> {
  const req = new Readable({ read() {} }) as unknown as IncomingMessage & {
    method: string
    url: string
    headers: Record<string, string>
    socket: { remoteAddress: string }
  }
  req.method = method
  req.url = url
  req.headers = { 'content-type': 'application/json' }
  req.socket = { remoteAddress: '127.0.0.1' }
  if (body !== undefined) req.push(JSON.stringify(body))
  req.push(null)
  let status = 0
  let bodyText = ''
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    writableEnded: false,
    setHeader(name: string, value: string) {
      this.headers[name.toLowerCase()] = value
    },
    end(chunk?: string) {
      this.writableEnded = true
      bodyText = chunk ?? ''
      status = this.statusCode
    },
  } as unknown as ServerResponse
  return Promise.resolve(handler(req, res)).then(() => ({ status, body: bodyText }))
}

const base = normalizeWebPath('/llm-memory')

describe('DSH headless WebUI', () => {
  it('serves the shared UI page and bundle', async () => {
    const page = await request('GET', `${base}/ui`)
    expect(page.status).toBe(200)
    expect(page.body).toContain('/ui/web-ui.js')
    expect(page.body).toContain('/api/ui')
    expect(page.body).toContain("import(base + '/ui/web-ui.js')")
    expect(page.body).not.toContain("from '/ui/web-ui.js'")
    const bundle = await request('GET', `${base}/ui/web-ui.js`)
    expect(bundle.status).toBe(200)
    expect(bundle.body).toContain('mount')
  })

  it('routes UI operations through the DSH bridge', async () => {
    const saved = await request('POST', `${base}/api/ui`, { operation: 'save', input: { text: 'ui bridge fact', scope: 'user' } })
    expect(saved.status).toBe(200)
    const listed = await request('POST', `${base}/api/ui`, { operation: 'list' })
    expect(JSON.parse(listed.body)).toHaveLength(1)
    const created = await request('POST', `${base}/api/ui`, { operation: 'backup.create' })
    expect(JSON.parse(created.body).name).toMatch(/\.llmmem$/)
    const backups = await request('POST', `${base}/api/ui`, { operation: 'backup.list' })
    expect(JSON.parse(backups.body)).toHaveLength(1)
    const missing = await request('POST', `${base}/api/ui`, { input: {} })
    expect(missing.status).toBe(400)
  })
})
