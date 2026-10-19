import { describe, expect, it } from 'vitest'

import {
  assertConfirmation,
  ConfirmationError,
  createTranslator,
  DEFAULT_SETTINGS,
  DshUiHost,
  graphVm,
  healthVm,
  HttpUiHost,
  itemsVm,
  lintVm,
  localeFromSettings,
  MESSAGE_KEYS,
  resolveLocale,
  resolveSettings,
  settingsVm,
  statusVm,
  validateSettings,
  type UiOperation,
} from '@llm-memory/ui/headless'

const ru = createTranslator('ru')
const en = createTranslator('en')

describe('i18n', () => {
  it('resolves stored, host and default locale', () => {
    expect(resolveLocale('ru', 'en-US')).toBe('ru')
    expect(resolveLocale(null, 'ru-RU')).toBe('ru')
    expect(resolveLocale(undefined, 'de-DE')).toBe('en')
    expect(resolveLocale('xx', 'ru')).toBe('ru')
  })

  it('has the same message keys in both locales', () => {
    for (const key of MESSAGE_KEYS) {
      expect(en.t(key)).toBeTruthy()
      expect(ru.t(key)).toBeTruthy()
      expect(en.t(key)).not.toBe(ru.t(key))
    }
  })
})

describe('settings schema', () => {
  it('has defaults and validates numbers, enums and locale', () => {
    expect(validateSettings({})).toEqual([])
    expect(validateSettings({ recallLimit: 0 })).toEqual([{ key: 'recallLimit', message: 'must be >= 1' }])
    expect(validateSettings({ recallTextChars: 625 })).toEqual([{ key: 'recallTextChars', message: 'must be a multiple of 50' }])
    expect(validateSettings({ recallFormat: 'yaml' })).toEqual([{ key: 'recallFormat', message: 'must be one of markdown, table, timeline, json' }])
    expect(validateSettings({ uiLocale: 'de' })).toHaveLength(1)
    expect(validateSettings({ autonomous: 'yes' })).toEqual([{ key: 'autonomous', message: 'must be true/false' }])
  })

  it('merges stored values over defaults and reads the locale', () => {
    const merged = resolveSettings({ recallLimit: 7, unknownKey: 'kept' })
    expect(merged.recallLimit).toBe(7)
    expect(merged.unknownKey).toBe('kept')
    expect(merged.recallFormat).toBe(DEFAULT_SETTINGS.recallFormat)
    expect(localeFromSettings({ uiLocale: 'ru' })).toBe('ru')
    expect(localeFromSettings({})).toBe('en')
  })
})

describe('view models', () => {
  const entries = [
    { id: 'm_1', title: 'A', kind: 'facts', tier: 'normal', status: 'active', scope: 'user', importance: 4, updatedAt: '2026-01-01T00:00:00.000Z' },
    { id: 'm_2', title: 'B', kind: 'rules', tier: 'important', status: 'active', scope: 'project', project: 'proj', updatedAt: '2026-01-02T00:00:00.000Z' },
  ]

  it('status, items and graph', () => {
    const status = statusVm({ total: 2, active: 2, byScope: { user: 1, project: 1 }, projects: 1 }, en)
    expect(status.rows[0]).toEqual({ label: 'Entries', value: '2' })
    expect(status.rows[2]?.value).toBe('user: 1, project: 1')
    expect(itemsVm(entries)[1]?.project).toBe('proj')
    const graph = graphVm({
      entities: [ { id: 'm_1', name: 'A' }, { id: 'm_2', name: 'B' }, { id: 'm_3', name: 'C' } ],
      edges: [ { source: 'm_1', target: 'm_2' }, { source: 'm_1', target: 'm_3' } ],
    })
    expect(graph.entities).toBe(3)
    expect(graph.hubs[0]).toEqual({ id: 'm_1', name: 'A', degree: 2 })
  })

  it('lint, health and settings screens', () => {
    expect(lintVm({ issues: [] })).toEqual({ ok: true, issues: [] })
    const health = healthVm({ vectors: { enabled: false, provider: 'off' }, model: { name: 'e5', present: false }, ports: { '8787': 'free' } }, ru)
    expect(health.vectors).toBe('off (off)')
    expect(health.model).toBe('e5 (missing)')
    expect(health.ports).toEqual([{ port: '8787', state: 'free' }])
    const settings = settingsVm(resolveSettings({}), ru)
    expect(settings.sections.map(section => section.id)).toContain('ui')
    const uiSection = settings.sections.find(section => section.id === 'ui')
    expect(uiSection?.fields[0]?.options).toEqual(['ru', 'en'])
  })
})

describe('hosts', () => {
  it('HttpUiHost maps operations to its own API', async () => {
    const calls: { url: string; method: string }[] = []
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), method: String(init?.method) })
      return { ok: true, status: 200, json: async () => ({ total: 1 }) } as Response
    }) as unknown as typeof fetch
    const host = new HttpUiHost({ kind: 'kilo', baseUrl: 'http://127.0.0.1:8787/', locale: 'ru', fetchImpl: fakeFetch })
    expect(await host.request<{ total: number }>('status')).toEqual({ total: 1 })
    expect(calls[0]).toEqual({ url: 'http://127.0.0.1:8787/api/status', method: 'GET' })
    expect(host.locale()).toBe('ru')
    expect(host.theme().colorAccent).toBe('#6d4aff')
  })

  it('HttpUiHost surfaces HTTP errors', async () => {
    const fakeFetch = (async () => ({ ok: false, status: 500, json: async () => ({}) }) as Response) as unknown as typeof fetch
    const host = new HttpUiHost({ kind: 'mcp', baseUrl: 'http://127.0.0.1:8789', fetchImpl: fakeFetch })
    await expect(host.request('list')).rejects.toThrow(/HTTP 500/)
  })

  it('DshUiHost calls the in-process bridge', async () => {
    const seen: UiOperation[] = []
    const host = new DshUiHost({ bridge: async operation => { seen.push(operation); return { total: 3 } } })
    expect(await host.request('status')).toEqual({ total: 3 })
    expect(seen).toEqual(['status'])
    expect(host.kind).toBe('dsh')
  })
})

describe('backup contract', () => {
  it('requires the typed confirmation word', () => {
    expect(() => assertConfirmation('RESTORE', 'restore')).toThrow(ConfirmationError)
    expect(() => assertConfirmation('DELETE', 'yes')).toThrow(/type DELETE/)
    expect(() => assertConfirmation('RESTORE', 'RESTORE')).not.toThrow()
  })

  it('binds the ambient fetch to globalThis (browser "Illegal invocation" guard)', async () => {
    const original = globalThis.fetch
    const thisValues: unknown[] = []
    globalThis.fetch = function (this: unknown) {
      thisValues.push(this)
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    } as typeof fetch
    try {
      const host = new HttpUiHost({ kind: 'kilo', baseUrl: 'http://example.test' })
      await expect(host.request('status')).resolves.toEqual({ ok: true })
      expect(thisValues[0]).toBe(globalThis)
    } finally {
      globalThis.fetch = original
    }
  })
})
