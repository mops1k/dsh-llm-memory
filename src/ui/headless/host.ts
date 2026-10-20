/**
 * UI host: adapters provide data and navigation; the shared UI never knows
 * where it runs (ADR-004).
 */
import { createTranslator, resolveLocale, type Translator, type UiLocale } from './i18n.js'
import { THEMES, type ThemeTokens } from '../theme/tokens.js'

export type UiHostKind = 'kilo' | 'opencode' | 'mcp' | 'dsh'

export type UiOperation =
  | 'status'
  | 'list'
  | 'get'
  | 'recall'
  | 'save'
  | 'forget'
  | 'delete'
  | 'lint'
  | 'graph'
  | 'health'
  | 'settings.get'
  | 'settings.set'
  | 'backup.list'
  | 'backup.create'
  | 'backup.verify'
  | 'backup.restore'
  | 'backup.delete'

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

/** Web hosts (Kilo, OpenCode, MCP) talk to their own HTTP API. */
export class HttpUiHost implements UiHost {
  readonly kind: UiHostKind
  private readonly base: string
  private readonly fetchImpl: typeof fetch
  private readonly localePref: UiLocale | undefined

  constructor(options: { kind: UiHostKind; baseUrl: string; locale?: UiLocale; fetchImpl?: typeof fetch }) {
    this.kind = options.kind
    this.base = options.baseUrl.replace(/\/+$/, '')
    this.localePref = options.locale
    // Keep the method bound to the browser's window: an unbound `fetch` call
    // throws "Illegal invocation" when a page script republishes window.fetch.
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
  }

  async request<T>(operation: UiOperation, input?: unknown): Promise<T> {
    const [group] = operation.split('.')
    const method = operation === 'status' || operation === 'list' || operation === 'get' || operation === 'graph' || operation === 'health' || operation === 'lint' || operation.endsWith('.list') || operation.endsWith('.get')
      ? 'GET'
      : 'POST'
    const url =
      method === 'GET'
        ? `${this.base}/api/${group === 'settings' ? 'settings' : group}${input && typeof input === 'object' ? `?${new URLSearchParams(input as Record<string, string>).toString()}` : ''}`
        : `${this.base}/api/${group === 'settings' ? 'settings' : group}`
    const response = await this.fetchImpl(url, {
      method,
      headers: { 'content-type': 'application/json' },
      body: method === 'GET' ? undefined : JSON.stringify({ operation, input }),
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
