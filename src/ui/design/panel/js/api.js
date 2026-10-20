/** Transport layer: the dev server (demo/live DSH) and the embedded panel
 * (legacy JSON API of Kilo/OpenCode). Semantics follow docs/panel-api.md. */
class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

function withParams(path, params = {}) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '' || value === 'all') continue
    query.set(key, String(value))
  }
  const text = query.toString()
  return text ? `${path}?${text}` : path
}

export function createLiveApi(config) {
  const base = (config.apiBase || '/api').replace(/\/+$/, '')

  async function request(path, options = {}) {
    const method = options.method ?? 'GET'
    const init = { method, headers: {} }
    if (options.body !== undefined) {
      init.headers['content-type'] = 'application/json'
      init.body = JSON.stringify(options.body)
    }
    const response = await fetch(withParams(`${base}${path}`, options.params), init)
    const text = await response.text()
    let body = null
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      body = text
    }
    if (!response.ok) {
      const message = body && typeof body === 'object' && body.error ? body.error : `HTTP ${response.status}`
      throw new ApiError(message, response.status)
    }
    return body
  }

  const api = {
    mode: 'live',
    source: config.source ?? base,
    settingsReadonly: true,

    status: params => request('/status', { params: { project: params?.project } }),
    projects: async () => {
      const status = await request('/status')
      return Object.keys(status.byProject ?? {}).sort()
    },
    items: params => request('/items', {
      params: {
        query: params.query,
        kind: params.kind,
        scope: params.scope,
        status: params.status,
        project: params.project,
        limit: params.limit,
        offset: params.offset,
      },
    }),
    item: id => request('/item', { params: { id } }).then(body => body.item ?? body),
    saveItem: payload => request('/save', { method: 'POST', body: payload }).then(body => body.item ?? body),
    forgetEntry: id => request('/forget', { method: 'POST', body: { id } }),
    deleteEntry: id => request('/delete', { method: 'POST', body: { id } }),
    graph: params => request('/graph', { params: { project: params?.project } }),
    lint: params => request('/lint', { params: { project: params?.project } }),
    heal: mode => request('/heal', { method: 'POST', body: { mode: mode === 'apply-safe' || mode === 'apply' ? 'apply-safe' : 'report' } }),
    backups: async () => {
      const body = await request('/backup')
      const list = Array.isArray(body) ? body : body?.backups ?? []
      return list.map(record => ({
        ...record,
        name: record.name ?? String(record.archive ?? '').split(/[\\/]/).pop(),
        sizeBytes: record.sizeBytes ?? record.bytes,
        createdAt: record.createdAt,
        encrypted: Boolean(record.encrypted),
      }))
    },
    createBackup: async () => {
      const body = await request('/backup', { method: 'POST', body: { operation: 'backup.create' } })
      return body?.report ?? body
    },
    verifyBackup: async name => {
      const body = await request('/backup', { method: 'POST', body: { operation: 'backup.verify', name } })
      return body?.report ?? body
    },
    restoreBackup: async name => {
      const body = await request('/backup', { method: 'POST', body: { operation: 'backup.restore', name, confirm: 'RESTORE' } })
      return body?.report ?? body
    },
    deleteBackup: async name => {
      const body = await request('/backup', { method: 'POST', body: { operation: 'backup.delete', name, confirm: 'DELETE' } })
      return body?.report ?? body
    },
    modelStatus: () => request('/model/status'),
    downloadModel: () => request('/model/download', { method: 'POST' }),
    removeModel: () => request('/model/remove', { method: 'POST' }),
    vectorsHealth: () => request('/vectors/health'),
    vectorsMap: async params => {
      const body = await request('/vectors/map', { params: { refresh: '1' } })
      const map = body?.map ?? body ?? null
      if (!map) return { map: null, query: null, reason: body?.reason ?? null }
      let query = null
      if (params?.q) {
        try {
          query = await request('/vectors/map/query', {
            method: 'POST',
            body: { text: params.q, limit: params.topK },
          })
          if (query && Array.isArray(query.hits)) {
            const points = new Map((map.points ?? []).map(point => [point.id, point]))
            query = {
              ...query,
              nearest: query.hits.map(hit => ({
                id: hit.id,
                title: points.get(hit.id)?.title ?? hit.id,
                kind: points.get(hit.id)?.kind,
                score: hit.score,
              })),
            }
          }
        } catch {
          query = null
        }
      }
      return { map, query }
    },
    rebuildVectors: () => request('/vectors/rebuild', { method: 'POST' }),
    recall: async (query, params = {}) => {
      const body = await request('/recall', {
        method: 'POST',
        body: { query, ...(params.limit ? { limit: params.limit } : {}) },
      })
      const items = body?.items ?? []
      return {
        items: items.map(item => ({ ...item, sources: item.sources ?? ['bm25'] })),
        total: body?.total ?? items.length,
        text: body?.text ?? '',
        sources: Object.fromEntries(items.map(item => [item.id, item.sources ?? []])),
      }
    },
    settingsSnapshot: async () => null,
    updateSettings: async () => {
      throw new ApiError('settings are stored by the DSH settings service, not by the panel API')
    },
  }
  return api
}

function basename(path) {
  return String(path ?? '').split(/[\\/]/).pop() ?? ''
}

/** The legacy adapter returns `content`; screens of the design read `text`. */
function normalizeEntry(item) {
  if (!item || typeof item !== 'object') return item
  return {
    ...item,
    text: item.text ?? item.content ?? '',
    tags: Array.isArray(item.tags) ? item.tags : [],
    supersededBy: Array.isArray(item.supersededBy) ? item.supersededBy : [],
  }
}

/**
 * Transport for the embedded panel (Kilo and OpenCode): the compatibility JSON
 * surface of `src/adapters/panel/legacy-api.ts`, mounted under `/api/legacy`.
 * Responses are normalized to the shapes the screens already consume.
 */
export function createLegacyApi(config) {
  const base = (config.apiBase || '/api/legacy').replace(/\/+$/, '')

  async function request(path, options = {}) {
    const method = options.method ?? 'GET'
    const init = { method, headers: {} }
    if (options.body !== undefined) {
      init.headers['content-type'] = 'application/json'
      init.body = JSON.stringify(options.body)
    }
    const response = await fetch(withParams(`${base}${path}`, options.params), init)
    const text = await response.text()
    let body = null
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      body = text
    }
    if (!response.ok) {
      const message = body && typeof body === 'object' && body.error ? body.error : `HTTP ${response.status}`
      throw new ApiError(message, response.status)
    }
    return body
  }

  return {
    mode: 'live',
    kind: config.kind ?? 'kilo',
    source: base,
    settingsReadonly: false,

    status: params => request('/status', { params: { project: params?.project } })
      .then(body => body?.status ?? body),
    projects: () => request('/projects')
      .then(body => (Array.isArray(body?.projects) ? body.projects : Object.keys(body?.byProject ?? {}).sort())),
    items: params => request('/items', {
      params: {
        q: params.query,
        kind: params.kind,
        tier: params.tier,
        scope: params.scope,
        status: params.status,
        project: params.project,
        limit: params.limit,
        offset: params.offset,
        sort: params.sort,
      },
    }).then(body => ({
      items: (body?.items ?? []).map(normalizeEntry),
      total: body?.total ?? (body?.items ?? []).length,
      limit: body?.limit,
      offset: body?.offset,
      query: params.query ?? '',
    })),
    item: id => request(`/items/${encodeURIComponent(id)}`).then(body => normalizeEntry(body?.item ?? body)),
    saveItem: payload => request('/items', { method: 'POST', body: payload }).then(body => normalizeEntry(body?.item ?? body)),
    forgetEntry: id => request(`/items/${encodeURIComponent(id)}/forget`, { method: 'POST' }),
    deleteEntry: id => request(`/items/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    graph: params => request('/graph', { params: { project: params?.project } })
      .then(({ ok, ...graph }) => graph),
    lint: params => request('/lint', { params: { project: params?.project } }).then(body => body?.report ?? body),
    heal: mode => request('/heal', {
      method: 'POST',
      body: { mode: mode === 'apply-safe' || mode === 'apply' ? 'apply-safe' : 'report' },
    }).then(body => body?.report ?? body),
    backups: async () => {
      const body = await request('/backups')
      const list = Array.isArray(body) ? body : body?.backups ?? []
      return list.map(record => ({
        ...record,
        name: record.name ?? basename(record.archive),
        archive: record.archive ?? record.name,
        sizeBytes: record.sizeBytes ?? record.bytes,
        createdAt: record.createdAt,
        encrypted: Boolean(record.encrypted),
      }))
    },
    createBackup: () => request('/backups/create', { method: 'POST' }).then(body => body?.report ?? body),
    verifyBackup: name => request('/backups/verify', { method: 'POST', body: { name } }).then(body => body?.report ?? body),
    restoreBackup: name => request('/backups/restore', { method: 'POST', body: { name, confirm: 'RESTORE' } }).then(body => body?.report ?? body),
    deleteBackup: name => request('/backups/delete', { method: 'POST', body: { name, confirm: 'DELETE' } }).then(body => body?.report ?? body),
    modelStatus: () => request('/model/status').then(body => body?.status ?? body),
    downloadModel: () => request('/model/download', { method: 'POST' }).then(body => body?.status ?? body),
    removeModel: () => request('/model/remove', { method: 'POST' }).then(body => body?.status ?? body),
    vectorsHealth: () => request('/vectors/health').then(body => body?.health ?? body),
    vectorsMap: async params => {
      const body = await request('/vectors/map', {
        params: { refresh: '1', q: params?.q, limit: params?.topK },
      })
      const map = body?.map ?? null
      let query = body?.query ?? null
      if (!map) return { map: null, query: null, reason: body?.reason ?? null }
      if (query && Array.isArray(query.hits)) {
        const points = new Map((map.points ?? []).map(point => [point.id, point]))
        query = {
          ...query,
          nearest: query.hits.map(hit => ({
            id: hit.id,
            title: points.get(hit.id)?.title ?? hit.id,
            kind: points.get(hit.id)?.kind,
            score: hit.score,
          })),
        }
      }
      return { map, query }
    },
    rebuildVectors: () => request('/vectors/rebuild', { method: 'POST' }),
    repairVectors: () => request('/vectors/repair', { method: 'POST' }).then(body => body?.report ?? body),
    embedVectors: () => request('/vectors/embed', { method: 'POST' }).then(body => body?.status ?? body),
    recall: async (query, params = {}) => {
      const body = await request('/recall', {
        params: { q: query, limit: params.limit, project: params.project },
      })
      const sources = body?.sources ?? {}
      const items = (body?.items ?? []).map(item => normalizeEntry({
        ...item,
        sources: item.sources ?? sources[item.id] ?? ['bm25'],
      }))
      return {
        items,
        total: body?.total ?? items.length,
        text: body?.text ?? '',
        sources,
      }
    },
    settingsSnapshot: () => request('/settings/snapshot').then(body => body?.snapshot ?? body),
    updateSettings: patch => request('/settings', { method: 'PUT', body: patch }),
  }
}

/**
 * Host SDK for the embedded panel: both locales of the universal schema plus
 * the current settings values. The panel switches language without a reload.
 */
export async function loadHostSdk(base, requestedLocale = 'ru') {
  const root = (base || '/api/legacy').replace(/\/+$/, '')
  const locales = {}
  let version = 1
  let operations = []
  const values = {}

  async function loadOne(locale) {
    const [uiResponse, settingsResponse] = await Promise.all([
      fetch(`${root}/ui/snapshot?locale=${locale}`, { cache: 'no-store' }),
      fetch(`${root}/settings/snapshot?locale=${locale}`, { cache: 'no-store' }),
    ])
    if (!uiResponse.ok) throw new ApiError(`UI snapshot failed: HTTP ${uiResponse.status}`, uiResponse.status)
    const ui = await uiResponse.json()
    const settingsBody = settingsResponse.ok ? await settingsResponse.json() : {}
    const snapshot = settingsBody?.snapshot ?? settingsBody
    version = ui.version ?? version
    operations = ui.operations ?? operations
    return {
      views: ui.views ?? [],
      actions: ui.actions ?? [],
      settingsGroups: snapshot?.groups ?? [],
      values: snapshot?.values ?? {},
    }
  }

  for (const locale of ['ru', 'en']) {
    try {
      locales[locale] = await loadOne(locale)
    } catch (error) {
      if (locale === requestedLocale) throw error
    }
  }
  const fallback = locales[requestedLocale] ?? locales.ru ?? locales.en
  for (const locale of ['ru', 'en']) {
    locales[locale] = locales[locale] ?? fallback
  }
  Object.assign(values, locales.ru?.values ?? {}, locales.en?.values ?? {})
  return {
    version,
    operations,
    locales: Object.fromEntries(
      Object.entries(locales).map(([locale, entry]) => [locale, {
        views: entry.views,
        actions: entry.actions,
        settingsGroups: entry.settingsGroups,
      }]),
    ),
    values,
  }
}

export async function createApi(config) {
  if (config.mode === 'live' && config.apiBase) return createLiveApi(config)
  if (config.mode === 'legacy' && config.apiBase) return createLegacyApi(config)
  // The embedded page is never demo-only: `__LM_EMBEDDED__` is defined at
  // build time so esbuild drops the synthetic store from the shipped panel.
  if (typeof __LM_EMBEDDED__ !== 'undefined' && __LM_EMBEDDED__) {
    throw new ApiError('panel transport is not configured by the host')
  }
  const { createDemoApi } = await import('./demo.js')
  return createDemoApi()
}

export { ApiError }
