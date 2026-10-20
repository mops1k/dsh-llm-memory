/**
 * Shared panel server: the design page plus the compatibility JSON API over the
 * shared `MemoryService`. Every HTTP-panel harness binds its own port and
 * degrades gracefully when the port is taken (ADR-007).
 */
import { readFileSync } from 'node:fs'
import { createServer, type Server, type ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'

import { handleLegacyApi, type LegacyContext } from './legacy-api.js'
import type { MemoryService } from '../../core/application/memory-service.js'
import type { HarnessConfig } from '../../core/domain/harness-config.js'
import type { UiHostKind } from '../../ui/headless/host.js'
import type { UiLocale } from '../../ui/headless/i18n.js'

export interface PanelHostInfo {
  kind: UiHostKind
  apiBase: string
  locale: UiLocale
}

export interface PanelServerOptions {
  service: MemoryService
  config: HarnessConfig
  /** Host wiring injected into the page (kind, API base, locale). */
  panel: PanelHostInfo
  /** Embedded page getter (bundle build); null falls back to the source tree. */
  html: () => string | null
  host?: string
  port?: number
  /** Persist a settings patch; without it the panel stays read-only. */
  saveConfig?: (config: HarnessConfig) => void
}

export interface PanelHandle {
  readonly url: string | null
  readonly disabledReason: string | null
  close(): Promise<void>
}

function legacyContext(options: PanelServerOptions): LegacyContext {
  return {
    service: options.service,
    config: options.config,
    locale: options.panel.locale,
    ...(options.saveConfig ? { saveConfig: options.saveConfig } : {}),
  }
}

function injectHost(html: string, panel: PanelHostInfo): string {
  const script = `<script>window.__LM_PANEL__ = ${JSON.stringify({ kind: panel.kind, apiBase: panel.apiBase, locale: panel.locale })};</script>`
  return html.includes('</head>') ? html.replace('</head>', `${script}</head>`) : script + html
}

/** The shared panel design, embedded at build time or read from the tree. */
function panelPage(options: PanelServerOptions): string {
  const embedded = options.html()
  if (embedded) return injectHost(embedded, options.panel)
  for (const candidate of ['../../ui/design/panel.html', '../../../src/ui/design/panel.html']) {
    try {
      return injectHost(readFileSync(fileURLToPath(new URL(candidate, import.meta.url)), 'utf8'), options.panel)
    } catch {
      // try the next location (source run vs compiled lib)
    }
  }
  return fallbackPage()
}

/** Fallback when the dashboard is not embedded (source runs and tests). */
function fallbackPage(): string {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>LLM Memory</title></head>
<body><p>LLM Memory: panel bundle is not embedded in this build.</p></body></html>`
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
  })
  res.end(text)
}

function html(res: ServerResponse, body: string): void {
  // The page ships inside the plugin: after an update the browser must not keep
  // serving the previous design from its cache.
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
  res.end(body)
}

export async function startPanelServer(options: PanelServerOptions): Promise<PanelHandle> {
  const host = options.host ?? options.config.web.host
  const port = options.port ?? options.config.web.port
  if (!options.config.web.enabled) {
    return { url: null, disabledReason: 'web disabled in config', close: async () => {} }
  }

  const server: Server = createServer((req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://${host}`)
      if (req.method === 'GET' && url.pathname === '/') return html(res, panelPage(options))
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
