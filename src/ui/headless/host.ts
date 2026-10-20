/**
 * UI host: adapters provide data and navigation; the shared UI never knows
 * where it runs (ADR-004).
 */
import { createTranslator, resolveLocale, type Translator, type UiLocale } from './i18n.js'
import { THEMES, type ThemeTokens } from '../theme/tokens.js'

export type UiHostKind = 'kilo' | 'opencode' | 'mcp' | 'dsh'

/** Operation ids a host may be asked for (the UI schema owns the vocabulary). */
export type UiOperation = string

/**
 * One endpoint behind an operation. `path` may contain `{{field}}`
 * placeholders filled from the input object (e.g. `/items/{{id}}`).
 */
export interface UiRoute {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  path: string
}

export interface UiHost {
  readonly kind: UiHostKind
  request<T>(operation: UiOperation, input?: unknown): Promise<T>
  locale(): UiLocale
  theme(): ThemeTokens
  t(key: Parameters<Translator['t']>[0]): string
}

function baseHost(kind: UiHostKind, locale: UiLocale | undefined): Omit<UiHost, 'request'> {
  const resolved = resolveLocale(locale)
  const translator = createTranslator(resolved)
  return {
    kind,
    locale: () => resolved,
    theme: () => THEMES[kind],
    t: key => translator.t(key),
  }
}

/**
 * DSH-shaped endpoints, kept so older callers and tests keep working.
 * Harnesses with another API replace them through the `routes` option.
 */
const DEFAULT_ROUTES: Record<string, UiRoute> = {
  status: { method: 'GET', path: '/api/status' },
  list: { method: 'GET', path: '/api/items' },
  get: { method: 'GET', path: '/api/item' },
  recall: { method: 'GET', path: '/api/items' },
  graph: { method: 'GET', path: '/api/graph' },
  lint: { method: 'GET', path: '/api/lint' },
  health: { method: 'GET', path: '/api/vectors/health' },
  'settings.get': { method: 'GET', path: '/api/settings/schema' },
  'settings.set': { method: 'POST', path: '/api/settings' },
  'backup.list': { method: 'GET', path: '/api/backup' },
  'settings.snapshot': { method: 'GET', path: '/api/ui/snapshot' },
  'ui.snapshot': { method: 'GET', path: '/api/ui/snapshot' },
  'items.list': { method: 'GET', path: '/api/items' },
  'items.get': { method: 'GET', path: '/api/item' },
  'items.save': { method: 'POST', path: '/api/save' },
  'items.forget': { method: 'POST', path: '/api/forget' },
  'items.delete': { method: 'POST', path: '/api/delete' },
  'lint.report': { method: 'GET', path: '/api/lint' },
  'heal.report': { method: 'POST', path: '/api/heal' },
  'heal.apply': { method: 'POST', path: '/api/heal' },
  'model.status': { method: 'GET', path: '/api/model/status' },
  'vectors.health': { method: 'GET', path: '/api/vectors/health' },
  'vectors.map': { method: 'GET', path: '/api/vectors/map' },
}

function fillPath(path: string, input: unknown): string {
  if (input === null || typeof input !== 'object') return path
  return path.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = (input as Record<string, unknown>)[key]
    return encodeURIComponent(value === undefined ? '' : String(value))
  })
}

/** Web hosts (Kilo, OpenCode, MCP) talk to their own HTTP API. */
export class HttpUiHost implements UiHost {
  readonly kind: UiHostKind
  private readonly base: string
  private readonly fetchImpl: typeof fetch
  private readonly localePref: UiLocale | undefined
  private readonly routes: Record<string, UiRoute>

  constructor(options: {
    kind: UiHostKind
    baseUrl: string
    locale?: UiLocale
    fetchImpl?: typeof fetch
    /** Operation -> endpoint map; merged over the defaults. */
    routes?: Record<string, UiRoute>
  }) {
    this.kind = options.kind
    this.base = options.baseUrl.replace(/\/+$/, '')
    this.localePref = options.locale
    this.routes = { ...DEFAULT_ROUTES, ...options.routes }
    // Keep the method bound to the browser's window: an unbound `fetch` call
    // throws "Illegal invocation" when a page script republishes window.fetch.
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
  }

  async request<T>(operation: UiOperation, input?: unknown): Promise<T> {
    const route = this.routes[operation]
    if (!route) throw new Error(`operation "${operation}" is not available in ${this.kind}`)
    const method = route.method ?? 'GET'
    const path = fillPath(route.path, input)
    const query =
      method === 'GET' && input !== null && typeof input === 'object'
        ? new URLSearchParams(
            Object.entries(input as Record<string, unknown>)
              .filter(([, value]) => value !== undefined && value !== null)
              .map(([key, value]) => [key, String(value)] as [string, string]),
          ).toString()
        : ''
    const url = `${this.base}${path}${query.length > 0 ? `${path.includes('?') ? '&' : '?'}${query}` : ''}`
    const response = await this.fetchImpl(url, {
      method,
      headers: { 'content-type': 'application/json' },
      body: method === 'GET' ? undefined : JSON.stringify(input ?? {}),
    })
    if (!response.ok) throw new Error(`${operation} failed: HTTP ${response.status}`)
    return (await response.json()) as T
  }

  locale(): UiLocale {
    return resolveLocale(this.localePref)
  }

  theme(): ThemeTokens {
    return THEMES[this.kind]
  }

  t(key: Parameters<Translator['t']>[0]): string {
    return createTranslator(this.locale()).t(key)
  }
}

/** DSH runs in-process: a direct bridge, no web UI (ADR-004). */
export class DshUiHost implements UiHost {
  readonly kind: UiHostKind = 'dsh'
  private readonly bridge: (operation: UiOperation, input?: unknown) => Promise<unknown>
  private readonly localePref: UiLocale | undefined

  constructor(options: {
    bridge: (operation: UiOperation, input?: unknown) => Promise<unknown>
    locale?: UiLocale
  }) {
    this.bridge = options.bridge
    this.localePref = options.locale
  }

  async request<T>(operation: UiOperation, input?: unknown): Promise<T> {
    return (await this.bridge(operation, input)) as T
  }

  locale(): UiLocale {
    return resolveLocale(this.localePref)
  }

  theme(): ThemeTokens {
    return THEMES.dsh
  }

  t(key: Parameters<Translator['t']>[0]): string {
    return createTranslator(this.locale()).t(key)
  }
}

export function uiHostBrand(kind: UiHostKind): ReturnType<typeof baseHost> {
  return baseHost(kind, undefined)
}
