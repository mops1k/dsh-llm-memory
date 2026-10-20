/**
 * MCP transports: newline JSON-RPC over stdio and Streamable HTTP.
 *
 * stdio is the main mode (a client spawns the process); HTTP is loopback plus a
 * bearer token, per plan §15.3/15.7. The HTTP checks cover what the spec makes
 * mandatory for a local server: token, Origin, version header, 405 for the
 * methods this server does not offer, and a body ceiling.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it } from 'vitest'

import { DEFAULT_MCP_CONFIG, resolveMcpConfig } from '@llm-memory/adapter/mcp/config'
import { startHttpTransport, type HttpTransportHandle } from '@llm-memory/adapter/mcp/http'
import { McpServer } from '@llm-memory/adapter/mcp/server'
import { McpService } from '@llm-memory/adapter/mcp/service'
import { startStdioTransport } from '@llm-memory/adapter/mcp/stdio'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

interface Harness {
  service: McpService
  server: McpServer
}

function setup(limits?: Record<string, number>): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'llm-mcp-transport-'))
  dirs.push(dir)
  const home = join(dir, 'home')
  const repo = join(dir, 'repo')
  mkdirSync(home, { recursive: true })
  mkdirSync(repo, { recursive: true })
  const config = resolveMcpConfig({ ...DEFAULT_MCP_CONFIG, ...(limits ? { mcp: { limits } } : {}) })
  const service = new McpService({ config, clientId: 'cursor', home, projectRoot: repo })
  service.init()
  const server = new McpServer({ service, config })
  return { service, server }
}

async function waitFor<T>(read: () => T | null, timeoutMs = 3000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = read()
    if (value !== null) return value
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('timed out waiting for a condition')
}

describe('stdio transport', () => {
  it('answers newline-delimited requests and stays silent on notifications', async () => {
    const harness = setup()
    const input = new PassThrough()
    const output = new PassThrough()
    const lines: string[] = []
    let buffer = ''
    output.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8')
      const parts = buffer.split('\n')
      buffer = parts.pop() ?? ''
      lines.push(...parts.filter(line => line.trim().length > 0))
    })
    const handle = startStdioTransport({ server: harness.server, input, output })
    try {
      input.write('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25"}}\n')
      input.write('{"jsonrpc":"2.0","id":2,"method":"tools/list"}\n')
      input.write('not json\n')
      input.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n')
      const got = await waitFor(() => (lines.length >= 3 ? lines : null))
      expect(got).toHaveLength(3)
      const initialize = JSON.parse(got[0]!)
      expect(initialize.id).toBe(1)
      expect(initialize.result.serverInfo.name).toBe('llm-memory-mcp')
      const tools = JSON.parse(got[1]!)
      expect(tools.result.tools.map((tool: { name: string }) => tool.name)).toContain('llm_memory_save')
      const parseError = JSON.parse(got[2]!)
      expect(parseError.id).toBeNull()
      expect(parseError.error.code).toBe(-32700)
    } finally {
      handle.close()
      harness.service.close()
    }
  })

  it('stops reading after the input ends', async () => {
    const harness = setup()
    const input = new PassThrough()
    const output = new PassThrough()
    const handle = startStdioTransport({ server: harness.server, input, output })
    try {
      const closed = handle.closed
      input.end()
      await closed
    } finally {
      harness.service.close()
    }
  })
})

describe('Streamable HTTP transport', () => {
  const handles: HttpTransportHandle[] = []

  async function start(overrides: { limits?: Record<string, number>; host?: string; token?: string } = {}): Promise<{ url: string; handle: HttpTransportHandle }> {
    const harness = setup(overrides.limits)
    services.push(harness.service)
    const handle = await startHttpTransport({
      server: harness.server,
      token: overrides.token ?? 'secret-token',
      host: overrides.host ?? '127.0.0.1',
      port: 0,
      ...(overrides.limits ? { limits: { ...DEFAULT_MCP_CONFIG.mcp.limits, ...overrides.limits } } : {}),
    })
    handles.push(handle)
    if (handle.url === null) throw new Error(`transport did not start: ${handle.disabledReason}`)
    return { url: handle.url, handle }
  }

  const services: McpService[] = []
  afterEach(async () => {
    for (const handle of handles.splice(0)) await handle.close()
    for (const service of services.splice(0)) service.close()
  })

  function post(url: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
    return fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer secret-token', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  }

  it('answers a request with JSON and keeps the id', async () => {
    const { url } = await start()
    const response = await post(url, { jsonrpc: '2.0', id: 7, method: 'initialize', params: { protocolVersion: '2025-11-25' } })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    const body = (await response.json()) as { id: number; result: { serverInfo: { name: string } } }
    expect(body.id).toBe(7)
    expect(body.result.serverInfo.name).toBe('llm-memory-mcp')
  })

  it('requires the bearer token', async () => {
    const { url } = await start()
    const without = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    expect(without.status).toBe(401)
    expect(without.headers.get('www-authenticate')).toContain('Bearer')
    const wrong = await post(url, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { authorization: 'Bearer nope' })
    expect(wrong.status).toBe(401)
  })

  it('rejects a foreign Origin and accepts a local one', async () => {
    const { url } = await start()
    const foreign = await post(url, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { origin: 'http://evil.example' })
    expect(foreign.status).toBe(403)
    const local = await post(url, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { origin: 'http://localhost:6274' })
    expect(local.status).toBe(200)
  })

  it('accepts notifications with 202 and refuses GET/DELETE', async () => {
    const { url } = await start()
    const notification = await post(url, { jsonrpc: '2.0', method: 'notifications/initialized' })
    expect(notification.status).toBe(202)
    expect(await notification.text()).toBe('')
    const get = await fetch(url, { headers: { authorization: 'Bearer secret-token' } })
    expect(get.status).toBe(405)
    const del = await fetch(url, { method: 'DELETE', headers: { authorization: 'Bearer secret-token' } })
    expect(del.status).toBe(405)
  })

  it('rejects an unsupported protocol version header', async () => {
    const { url } = await start()
    const response = await post(url, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { 'mcp-protocol-version': '1999-01-01' })
    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: { code: number } }
    expect(body.error.code).toBe(-32600)
  })

  it('rejects a body over the ceiling with 413', async () => {
    const { url } = await start({ limits: { maxRequestBytes: 512 } })
    const response = await post(url, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'llm_memory_save', arguments: { text: 'x'.repeat(600) } } })
    expect(response.status).toBe(413)
  })

  it('refuses a non-loopback bind without the explicit flag and a missing token', async () => {
    const harness = setup()
    services.push(harness.service)
    const external = await startHttpTransport({ server: harness.server, token: 't', host: '0.0.0.0', port: 0 })
    expect(external.url).toBeNull()
    expect(external.disabledReason).toMatch(/allow-external-bind/)
    const tokenless = await startHttpTransport({ server: harness.server, token: '', port: 0 })
    expect(tokenless.url).toBeNull()
    expect(tokenless.disabledReason).toMatch(/token/)
  })

  it('reports a busy port instead of throwing', async () => {
    const harness = setup()
    services.push(harness.service)
    const first = await startHttpTransport({ server: harness.server, token: 't', host: '127.0.0.1', port: 0 })
    handles.push(first)
    const port = Number(new URL(first.url!).port)
    const second = await startHttpTransport({ server: harness.server, token: 't', host: '127.0.0.1', port })
    expect(second.url).toBeNull()
    expect(second.disabledReason).toMatch(/busy/)
  })
})
