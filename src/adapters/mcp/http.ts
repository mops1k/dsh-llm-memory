/**
 * Streamable HTTP transport in its JSON shape (plan §15.3).
 *
 * One endpoint (`POST /mcp`) answers every request with a JSON-RPC body or 202
 * for a notification; this server offers no server-initiated messages, so GET
 * and DELETE are 405, there is no session id and no SSE resumption. Binding is
 * loopback unless `--allow-external-bind` was given, and a bearer token is
 * mandatory. The `Origin` header is checked against loopback hosts (DNS
 * rebinding, spec requirement).
 *
 * @module dsh-llm-memory/adapters/mcp/http
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import type { AddressInfo } from 'node:net'

import type { JsonRpcResponse } from './protocol.js'
import type { McpServer } from './server.js'
import type { McpLimits } from './config.js'

export interface HttpTransportOptions {
  server: McpServer
  /** Bearer token; an empty one disables the transport with a clear reason. */
  token: string
  host?: string
  port?: number
  /** Required to bind beyond loopback (plan §15.7). */
  allowExternalBind?: boolean
  /** Extra origins allowed beyond loopback ones. */
  allowedOrigins?: readonly string[]
  limits?: McpLimits
  log?: (line: string) => void
}

export interface HttpTransportHandle {
  /** `null` when the transport is disabled (busy port, bad bind, no token). */
  readonly url: string | null
  readonly disabledReason: string | null
  close(): Promise<void>
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1'])
const DEFAULT_LIMITS: McpLimits = { maxRequestBytes: 256 * 1024, maxEntryBytes: 1024 * 1024, maxResponseBytes: 2 * 1024 * 1024 }

function isLoopbackHost(host: string): boolean {
  return LOOPBACK.has(host) || host.startsWith('127.')
}

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
    ...headers,
  })
  res.end(text)
}

function rpcError(code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id: null, error: { code, message } }
}

function originAllowed(origin: string | undefined, allowed: readonly string[]): boolean {
  if (origin === undefined) return true
  if (allowed.includes(origin)) return true
  try {
    return LOOPBACK.has(new URL(origin).hostname)
  } catch {
    return false
  }
}

function authorized(header: string | undefined, token: string): boolean {
  if (!header) return false
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  if (!match) return false
  const given = Buffer.from(match[1] ?? '', 'utf8')
  const expected = Buffer.from(token, 'utf8')
  if (given.length !== expected.length) return false
  return timingSafeEqual(given, expected)
}

function readBody(req: IncomingMessage, limit: number): Promise<{ text: string; tooLarge: boolean }> {
  return new Promise(resolve => {
    const chunks: Buffer[] = []
    let size = 0
    let tooLarge = false
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      resolve({ text: tooLarge ? '' : Buffer.concat(chunks).toString('utf8'), tooLarge })
    }
    req.on('data', (chunk: Buffer) => {
      if (tooLarge) return
      size += chunk.length
      if (size > limit) {
        tooLarge = true
        chunks.length = 0
        return
      }
      chunks.push(chunk)
    })
    req.on('end', finish)
    req.on('close', finish)
    req.on('error', finish)
  })
}

function listen(server: Server, port: number, host: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  return new Promise(resolve => {
    server.once('error', (error: NodeJS.ErrnoException) => {
      resolve({ ok: false, reason: error.code === 'EADDRINUSE' ? `port ${port} is busy` : String(error) })
    })
    server.listen(port, host, () => resolve({ ok: true }))
  })
}

export async function startHttpTransport(options: HttpTransportOptions): Promise<HttpTransportHandle> {
  const log = options.log ?? ((line: string): void => void process.stderr.write(`${line}\n`))
  const host = options.host ?? '127.0.0.1'
  const port = options.port ?? 8790
  const limits = options.limits ?? DEFAULT_LIMITS
  const disabled = (reason: string): HttpTransportHandle => {
    log(`[llm-memory-mcp] HTTP transport disabled: ${reason}`)
    return { url: null, disabledReason: reason, close: async () => {} }
  }

  if (options.token.trim().length === 0) {
    return disabled('HTTP transport needs a bearer token: pass --token, set LLM_MEMORY_MCP_TOKEN or mcp.token in the config')
  }
  if (!isLoopbackHost(host) && options.allowExternalBind !== true) {
    return disabled(`refusing to bind ${host}: loopback only (use --allow-external-bind to override)`)
  }

  const server = createServer((req, res) => {
    void route(req, res).catch(error => {
      try {
        json(res, 500, rpcError(-32603, error instanceof Error ? error.message : String(error)))
      } catch {
        res.destroy()
      }
    })
  })

  async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', `http://${host}`)
    if (!['/mcp', '/mcp/', '/'].includes(url.pathname)) {
      json(res, 404, rpcError(-32601, `not found: ${url.pathname}`))
      return
    }
    if (req.method !== 'POST') {
      json(res, 405, rpcError(-32600, 'this server answers POST /mcp only'), { allow: 'POST' })
      return
    }
    if (!originAllowed(req.headers.origin, options.allowedOrigins ?? [])) {
      json(res, 403, rpcError(-32600, 'forbidden origin'))
      return
    }
    if (!authorized(req.headers.authorization, options.token)) {
      json(res, 401, rpcError(-32600, 'unauthorized'), { 'www-authenticate': 'Bearer realm="llm-memory"' })
      return
    }
    const version = req.headers['mcp-protocol-version']
    if (typeof version === 'string' && !options.server.supportedVersions.includes(version)) {
      json(res, 400, rpcError(-32600, `unsupported protocol version: ${version}`))
      return
    }
    const contentType = String(req.headers['content-type'] ?? '').toLowerCase()
    if (!contentType.startsWith('application/json')) {
      json(res, 415, rpcError(-32600, 'content-type must be application/json'))
      return
    }

    const body = await readBody(req, limits.maxRequestBytes)
    if (body.tooLarge) {
      json(res, 413, rpcError(-32600, `request exceeds the ${limits.maxRequestBytes}-byte limit`))
      return
    }
    const response = await options.server.dispatch(body.text, { transport: 'http' })
    if (response === null) {
      res.writeHead(202, { 'cache-control': 'no-store' })
      res.end()
      return
    }
    json(res, 200, response)
  }

  const bound = await listen(server, port, host)
  if (!bound.ok) {
    server.close()
    return disabled(bound.reason)
  }
  const address = server.address() as AddressInfo | null
  const actualPort = address && typeof address === 'object' ? address.port : port
  return {
    url: `http://${host}:${actualPort}/mcp`,
    disabledReason: null,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  }
}
