/**
 * Kilo panel: the shared design page plus the compatibility JSON API over
 * KiloService. Binds only its own port and degrades gracefully when the port
 * is taken (ADR-007).
 */
import { readFileSync } from 'node:fs'
import { createServer, type Server, type ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'


import { embeddedLegacyHtml } from './web-bundle.js'
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

/** Host wiring the shared design page receives (theme and API live here). */
const PANEL_HOST = { kind: 'kilo', apiBase: '/api/legacy', locale: 'ru' as const }

function injectHost(html: string): string {
  const script = `<script>window.__LM_PANEL__ = ${JSON.stringify(PANEL_HOST)};</script>`
  return html.includes('</head>') ? html.replace('</head>', `${script}</head>`) : script + html
}

/** The shared panel design, embedded at build time or read from the tree. */
function legacyPage(): string {
  const embedded = embeddedLegacyHtml()
  if (embedded) return injectHost(embedded)
  for (const candidate of ['../../ui/design/panel.html', '../../../src/ui/design/panel.html']) {
    try {
      return injectHost(readFileSync(fileURLToPath(new URL(candidate, import.meta.url)), 'utf8'))
    } catch {
      // try the next location (source run vs compiled lib)
    }
  }
  return fallbackPage()
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

/**
 * Fallback when the dashboard is not embedded into the single-file bundle
 * (source runs and tests): the real page is injected at build time.
 */
function fallbackPage(): string {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>LLM Memory</title></head>
<body><p>LLM Memory: panel bundle is not embedded in this build.</p></body></html>`
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
      if (req.method === 'GET' && url.pathname === '/') return html(res, legacyPage())
      if (url.pathname.startsWith('/api/legacy/')) {
        const legacyPath = url.pathname.slice('/api/legacy'.length)
        void handleLegacyApi(req, legacyPath, url.searchParams, legacyContext(options), (status, body) => json(res, status, body))
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





