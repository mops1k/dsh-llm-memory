/**
 * Kilo panel: JSON API over KiloService plus the shared web bundle. Binds only
 * its own port and degrades gracefully when the port is taken (ADR-007).
 */
import { readFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

import {
  createBackup,
  deleteBackup,
  listBackups,
  restoreBackup,
  verifyBackup,
} from '@llm-memory/core/infrastructure/backup'

import { embeddedLegacyHtml, embeddedWebBundle } from './web-bundle.js'
import { handleLegacyApi, type LegacyContext } from './legacy-api.js'
import type { KiloService } from './service.js'
import type { KiloMemoryConfig } from './config.js'

export interface KiloWebHandle {
  readonly url: string | null
  readonly disabledReason: string | null
  close(): Promise<void>
}

function legacyContext(options: { service: KiloService; config: KiloMemoryConfig; saveConfig?: (next: KiloMemoryConfig) => void }): LegacyContext {
  return { service: options.service, config: options.config, ...(options.saveConfig ? { saveConfig: options.saveConfig } : {}) }
}

/** The original dashboard, with its API calls pointed at the compatibility routes. */
function legacyPage(): string {
  const html = embeddedLegacyHtml()
  if (!html) return sharedPage('en')
  return html.replaceAll('"/api" + path', '"/api/legacy" + path')
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text) })
  res.end(text)
}

function html(res: ServerResponse, body: string): void {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end(body)
}

/** Operations the shared UI performs, mapped onto the compatibility API. */
const KILO_ROUTES: Record<string, { method: string; path: string }> = {
  'ui.snapshot': { method: 'GET', path: '/api/legacy/ui/snapshot' },
  'settings.snapshot': { method: 'GET', path: '/api/legacy/settings/snapshot' },
  status: { method: 'GET', path: '/api/legacy/status' },
  'items.list': { method: 'GET', path: '/api/legacy/items' },
  'items.get': { method: 'GET', path: '/api/legacy/items/{{id}}' },
  graph: { method: 'GET', path: '/api/legacy/graph' },
  'lint.report': { method: 'GET', path: '/api/legacy/lint' },
  'heal.report': { method: 'POST', path: '/api/legacy/heal' },
  health: { method: 'GET', path: '/api/legacy/health' },
  'backup.list': { method: 'GET', path: '/api/legacy/backups' },
  'model.status': { method: 'GET', path: '/api/legacy/model/status' },
  'items.save': { method: 'POST', path: '/api/legacy/items' },
  'items.update': { method: 'PUT', path: '/api/legacy/items/{{id}}' },
  'items.forget': { method: 'POST', path: '/api/legacy/items/{{id}}/forget' },
  'items.delete': { method: 'DELETE', path: '/api/legacy/items/{{id}}' },
  'settings.save': { method: 'PUT', path: '/api/legacy/settings' },
  'ui.locale.set': { method: 'PUT', path: '/api/legacy/config' },
  'action.lint.run': { method: 'GET', path: '/api/legacy/lint' },
  'action.heal.report': { method: 'POST', path: '/api/legacy/heal' },
  'action.heal.apply': { method: 'POST', path: '/api/legacy/heal' },
  'action.backup.create': { method: 'POST', path: '/api/legacy/backups/create' },
  'action.backup.verify': { method: 'POST', path: '/api/legacy/backups/verify' },
  'action.backup.restore': { method: 'POST', path: '/api/legacy/backups/restore' },
  'action.backup.delete': { method: 'POST', path: '/api/legacy/backups/delete' },
  'action.model.status': { method: 'GET', path: '/api/legacy/model/status' },
  'action.model.download': { method: 'POST', path: '/api/legacy/model/download' },
  'action.model.remove': { method: 'POST', path: '/api/legacy/model/remove' },
}

/** The shared schema-driven panel; the data still comes from the compat API. */
function sharedPage(locale: 'en' | 'ru'): string {
  return `<!doctype html>
<html lang="${locale}"><head><meta charset="utf-8"><title>LLM Memory</title>
<style>body{font-family:system-ui,sans-serif;margin:0;padding:0}</style></head>
<body><div id="root"></div>
<script type="module">
  const root = document.getElementById('root')
  const locale = ${JSON.stringify(locale)}
  const routes = ${JSON.stringify(KILO_ROUTES)}
  import('/web.js')
    .then(({ mount, HttpUiHost }) => mount(root, new HttpUiHost({ kind: 'kilo', baseUrl: location.origin, locale, routes })))
    .catch(error => {
      root.innerHTML = '<pre style="font:14px/1.4 monospace;padding:16px;color:#b00020">' +
        'UI bundle failed to load: ' + String(error) + '</pre>'
    })
</script></body></html>`
}

function bundlePath(): string | null {
  try {
    return fileURLToPath(new URL('../../../ui/lib/web.js', import.meta.url))
  } catch {
    return null
  }
}

function readBundle(): string | null {
  const embedded = embeddedWebBundle()
  if (embedded) return embedded
  const path = bundlePath()
  if (!path) return null
  try {
    return readFileSync(join(path), 'utf8')
  } catch {
    return null
  }
}

export async function startKiloWebServer(options: {
  service: KiloService
  config: KiloMemoryConfig
  host?: string
  port?: number
  /** Persist a settings patch; without it the panel stays read-only. */
  saveConfig?: (config: KiloMemoryConfig) => void
}): Promise<KiloWebHandle> {
  const host = options.host ?? options.config.web.host
  const port = options.port ?? options.config.web.port
  if (!options.config.web.enabled) {
    return { url: null, disabledReason: 'web disabled in config', close: async () => {} }
  }

  const server: Server = createServer((req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://${host}`)
      if (req.method === 'GET' && url.pathname === '/') return html(res, sharedPage(options.config.uiLocale))
      if (req.method === 'GET' && url.pathname === '/legacy') return html(res, legacyPage())
      if (url.pathname.startsWith('/api/legacy/')) {
        const legacyPath = url.pathname.slice('/api/legacy'.length)
        void handleLegacyApi(req, legacyPath, url.searchParams, legacyContext(options), (status, body) => json(res, status, body))
        return
      }
      if (req.method === 'GET' && url.pathname === '/web.js') {
        const bundle = readBundle()
        if (!bundle) return json(res, 404, { error: 'web bundle is not built' })
        res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
        return res.end(bundle)
      }
      if (req.method === 'GET' && url.pathname.startsWith('/api/')) {
        const operation = url.pathname.slice('/api/'.length)
        return json(res, 200, dataFor(options.service, operation, options.config, url.searchParams))
      }
      if (req.method === 'POST' && url.pathname.startsWith('/api/')) {
        const operation = url.pathname.slice('/api/'.length)
        let body = ''
        req.on('data', chunk => (body += String(chunk)))
        req.on('end', () => {
          try {
            const payload = body ? (JSON.parse(body) as { operation?: string; input?: unknown }) : {}
            if (operation === 'backup') return json(res, 200, backupOperation(options.service, payload.operation, payload.input))
            const next = mutate(operation, payload.input, options.config)
            if (operation === 'settings' && !('error' in next)) options.saveConfig?.(next)
            return json(res, 200, next)
          } catch (error) {
            return json(res, 400, { error: String(error) })
          }
        })
        return
      }
      json(res, 404, { error: 'not found' })
    } catch (error) {
      json(res, 500, { error: String(error) })
    }
  })

  const bound = await new Promise<{ ok: true } | { ok: false; reason: string }>(resolve => {
    const fail = (reason: string): void => resolve({ ok: false, reason })
    server.once('error', error => {
      const code = (error as NodeJS.ErrnoException).code
      fail(code === 'EADDRINUSE' ? `port ${port} is busy` : String(error))
    })
    server.listen(port, host, () => resolve({ ok: true }))
  })

  if (!bound.ok) {
    return { url: null, disabledReason: bound.reason, close: async () => {} }
  }
  const address = server.address()
  const actualPort = typeof address === 'object' && address ? address.port : port
  return {
    url: `http://${host}:${actualPort}/`,
    disabledReason: null,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  }
}

function toSummary(record: { archive: string; createdAt: string; bytes: number; encrypted?: boolean }): Record<string, unknown> {
  return {
    name: record.archive.split(/[\\/]/).pop() ?? record.archive,
    createdAt: record.createdAt,
    sizeBytes: record.bytes,
    includesVectors: false,
    verified: undefined,
    encrypted: record.encrypted ?? false,
  }
}

function backupOperation(service: KiloService, operation: string | undefined, input: unknown): unknown {
  const target = service.backupTarget()
  const payload = (input ?? {}) as { archive?: string; name?: string; confirm?: string; passphrase?: string }
  const archive = payload.archive ?? (payload.name ? join(target.backupsDir, payload.name) : '')
  switch (operation) {
    case 'backup.create':
      return createBackup({ harness: 'kilo', ...target, ...(payload.passphrase ? { passphrase: payload.passphrase } : {}) })
    case 'backup.list':
      return listBackups(target.backupsDir, payload.passphrase).map(toSummary)
    case 'backup.verify':
      return verifyBackup(archive, payload.passphrase)
    case 'backup.restore':
      return restoreBackup({ harness: 'kilo', ...target, archive, confirm: payload.confirm ?? '', ...(payload.passphrase ? { passphrase: payload.passphrase } : {}) })
    case 'backup.delete':
      return { deleted: deleteBackup(archive, payload.confirm, target.backupsDir) }
    default:
      return { error: `unknown backup operation ${operation ?? ''}` }
  }
}

function dataFor(
  service: KiloService,
  operation: string,
  config: KiloMemoryConfig,
  query: URLSearchParams,
): unknown {
  switch (operation) {
    case 'status':
      return service.status()
    case 'list': {
      const result = service.recall('', { limit: Number(query.get('limit') ?? 50), touch: false })
      return result.items
    }
    case 'get': {
      const id = query.get('id') ?? ''
      const entry = service.store.get(id)
      return entry ?? null
    }
    case 'graph':
      return service.graph()
    case 'lint':
      return service.lint()
    case 'health':
      return { vectors: { enabled: false, provider: 'off' }, model: null, ports: {} }
    case 'settings':
      return config
    case 'backup':
      return listBackups(service.backupTarget().backupsDir).map(toSummary)
    default:
      return { error: `unknown operation ${operation}` }
  }
}

function mutate(operation: string, input: unknown, config: KiloMemoryConfig): KiloMemoryConfig | { error: string } {
  if (operation !== 'settings') return { error: `unknown operation ${operation}` }
  if (input === null || typeof input !== 'object') return { error: 'settings payload must be an object' }
  const patch = input as Partial<KiloMemoryConfig>
  return {
    ...config,
    ...patch,
    memory: { ...config.memory, ...patch.memory },
    web: { ...config.web, ...patch.web },
  }
}

export type { IncomingMessage }
