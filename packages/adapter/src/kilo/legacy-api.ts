/**
 * Compatibility layer for the original kilo-memory dashboard (`web-ui.html`).
 * It exposes the old `/api/*` surface over the new KiloService, so the familiar
 * panel design keeps working on the unified core.
 */
import { writeFileSync } from 'node:fs'

import { selfHeal } from '@llm-memory/core/application/maintenance'
import { clampImportance, type MemoryEntry, type MemoryFilter } from '@llm-memory/core/domain/types'
import { writeItemPage } from '@llm-memory/core/application/wiki'

import type { KiloService } from './service.js'
import type { KiloMemoryConfig } from './config.js'

type Json = Record<string, unknown>

export interface LegacyContext {
  service: KiloService
  config: KiloMemoryConfig
  saveConfig?: (next: KiloMemoryConfig) => void
}

/** Selected project of the panel; `all` and empty mean no filter. */
function projectParam(params: URLSearchParams): string | undefined {
  const value = (params.get('project') ?? '').trim()
  return value === '' || value === 'all' ? undefined : value
}

function listFilter(params: URLSearchParams): MemoryFilter {
  const filter: MemoryFilter = { limit: 1000 }
  for (const key of ['scope', 'kind', 'tier', 'status'] as const) {
    const value = params.get(key)
    if (value && value !== 'all') filter[key] = value as never
  }
  const limit = Number(params.get('limit'))
  if (Number.isFinite(limit) && limit > 0) filter.limit = Math.min(limit, 5000)
  const offset = Number(params.get('offset'))
  if (Number.isFinite(offset) && offset > 0) filter.offset = Math.floor(offset)
  const project = params.get('project')
  if (project && project !== 'all') filter.project = project
  const sort = params.get('sort')
  if (sort === 'created' || sort === 'importance' || sort === 'updated') filter.sort = sort
  return filter
}

function toItem(entry: MemoryEntry): Json {
  return {
    id: entry.id,
    title: entry.title,
    content: entry.text,
    kind: entry.kind,
    tier: entry.tier,
    status: entry.status,
    scope: entry.scope,
    project: entry.project || undefined,
    importance: entry.importance,
    confidence: entry.confidence,
    keywords: entry.keywords,
    tags: entry.tags,
    consolidation: entry.consolidation,
    supersedes: entry.supersedes,
    supersededBy: entry.supersededBy,
    related: entry.related,
    accessCount: entry.accessCount,
    lastAccess: entry.lastAccess,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  }
}

async function readJson(req: import('node:http').IncomingMessage): Promise<Json> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk))
  const raw = Buffer.concat(chunks).toString('utf8')
  if (raw.trim().length === 0) return {}
  return JSON.parse(raw) as Json
}

function saveInput(body: Json): Parameters<KiloService['save']>[0] {
  const text = String(body.text ?? body.content ?? '').trim()
  return {
    text,
    ...(typeof body.title === 'string' ? { title: body.title } : {}),
    ...(typeof body.kind === 'string' ? { kind: body.kind as never } : {}),
    ...(typeof body.tier === 'string' ? { tier: body.tier as never } : {}),
    ...(body.scope === 'project' ? { scope: 'project' as const } : { scope: 'user' as const }),
    ...(typeof body.importance === 'number' ? { importance: body.importance } : {}),
    ...(Array.isArray(body.tags) ? { tags: body.tags.map(String) } : {}),
    ...(typeof body.keywords === 'string' ? { keywords: body.keywords } : {}),
  }
}

function updatePatch(body: Json): Partial<MemoryEntry> {
  const patch: Partial<MemoryEntry> = {}
  if (typeof body.title === 'string') patch.title = body.title
  if (typeof body.content === 'string') patch.text = body.content
  if (typeof body.text === 'string') patch.text = body.text
  if (typeof body.kind === 'string') patch.kind = body.kind as MemoryEntry['kind']
  if (typeof body.tier === 'string') patch.tier = body.tier as MemoryEntry['tier']
  if (typeof body.status === 'string') patch.status = body.status as MemoryEntry['status']
  if (typeof body.importance === 'number') patch.importance = clampImportance(body.importance)
  if (typeof body.confidence === 'number') patch.confidence = body.confidence
  if (typeof body.keywords === 'string') patch.keywords = body.keywords
  if (Array.isArray(body.tags)) patch.tags = body.tags.map(String)
  if (Array.isArray(body.related)) patch.related = body.related.map(String)
  if (typeof body.consolidation === 'string') patch.consolidation = body.consolidation as MemoryEntry['consolidation']
  return patch
}

/** Handle one legacy API request; returns null when the path is not ours. */
export async function handleLegacyApi(
  req: import('node:http').IncomingMessage,
  path: string,
  params: URLSearchParams,
  ctx: LegacyContext,
  json: (status: number, body: unknown) => void,
): Promise<boolean> {
  const method = (req.method ?? 'GET').toUpperCase()
  const { service, config } = ctx

  if (path === '/backups' && method === 'GET') {
    json(200, { ok: true, backups: service.backupList() })
    return true
  }
  if (path === '/backups/create' && method === 'POST') {
    try {
      json(200, { ok: true, report: service.backupCreate() })
    } catch (error) {
      json(400, { ok: false, error: error instanceof Error ? error.message : String(error) })
    }
    return true
  }
  if (path === '/backups/verify' && method === 'POST') {
    try {
      const body = await readJson(req)
      json(200, { ok: true, report: service.backupVerify(String(body['name'] ?? '')) })
    } catch (error) {
      json(400, { ok: false, error: error instanceof Error ? error.message : String(error) })
    }
    return true
  }
  if (path === '/backups/restore' && method === 'POST') {
    try {
      const body = await readJson(req)
      json(200, { ok: true, report: service.backupRestore(String(body['name'] ?? ''), body['confirm'] === undefined ? undefined : String(body['confirm'])) })
    } catch (error) {
      json(400, { ok: false, error: error instanceof Error ? error.message : String(error) })
    }
    return true
  }
  if (path === '/backups/delete' && method === 'POST') {
    try {
      const body = await readJson(req)
      json(200, { ok: true, deleted: service.backupDelete(String(body['name'] ?? ''), body['confirm'] === undefined ? undefined : String(body['confirm'])) })
    } catch (error) {
      json(400, { ok: false, error: error instanceof Error ? error.message : String(error) })
    }
    return true
  }
  if (path === '/settings/snapshot') {
    json(200, { ok: true, ...service.settingsSnapshot() })
    return true
  }
  if (path === '/settings' && method === 'PUT') {
    const body = await readJson(req)
    const result = service.applySettingsPatch(body as Json)
    ctx.saveConfig?.(config)
    json(200, { ok: true, ...result, config })
    return true
  }
  if (path === '/model/status') {
    json(200, { ok: true, status: service.modelStatus() })
    return true
  }
  if (path === '/model/download' && method === 'POST') {
    try {
      json(200, { ok: true, status: service.downloadModel() })
    } catch (error) {
      json(400, { ok: false, error: error instanceof Error ? error.message : String(error) })
    }
    return true
  }
  if (path === '/model/remove' && method === 'POST') {
    json(200, { ok: true, status: service.removeModel() })
    return true
  }
  if (path === '/health') {
    json(200, { ok: true, projectRoot: service.store.root, enabled: config.enabled, projects: Object.keys(service.store.projectRoots()), ts: new Date().toISOString() })
    return true
  }
  if (path === '/status') {
    json(200, { ok: true, status: service.status(projectParam(params)) })
    return true
  }
  if (path === '/projects') {
    json(200, { ok: true, projects: service.projects() })
    return true
  }
  if (path === '/config') {
    if (method === 'GET') json(200, { ok: true, config })
    else {
      const body = await readJson(req)
      const next = { ...config, ...body, memory: { ...config.memory, ...(body.memory as Json | undefined) }, web: { ...config.web, ...(body.web as Json | undefined) }, embeddings: { ...config.embeddings, ...(body.embeddings as Json | undefined) } } as KiloMemoryConfig
      ctx.saveConfig?.(next)
      json(200, { ok: true, config: next })
    }
    return true
  }
  if (path === '/items' && method === 'GET') {
    const filter = listFilter(params)
    const q = (params.get('q') ?? params.get('query') ?? '').trim()
    const result = q.length > 0 ? { items: service.store.search(q, filter), total: 0 } : service.store.list(filter)
    json(200, { ok: true, total: result.total || result.items.length, items: result.items.map(toItem) })
    return true
  }
  if (path === '/items' && method === 'POST') {
    const entry = service.save(saveInput(await readJson(req)))
    json(200, { ok: true, message: 'Сохранено.', item: toItem(entry) })
    return true
  }
  const match = path.match(/^\/items\/([^/]+)(\/forget)?$/)
  if (match) {
    const id = decodeURIComponent(match[1] ?? '')
    const entry = service.store.get(id)
    if (!entry) {
      json(404, { ok: false, error: 'Запись не найдена.' })
      return true
    }
    if (match[2] === '/forget' && method === 'POST') {
      service.forget(id)
      json(200, { ok: true })
      return true
    }
    if (method === 'GET') {
      json(200, { ok: true, item: toItem(entry) })
      return true
    }
    if (method === 'PUT' || method === 'PATCH') {
      const next: MemoryEntry = { ...entry, ...updatePatch(await readJson(req)), updatedAt: new Date().toISOString() }
      service.store.upsert(next)
      writeItemPage(service.store.root, next, next.scope === 'project' ? next.project : null, '.kilo/memory')
      json(200, { ok: true, item: toItem(next) })
      return true
    }
    if (method === 'DELETE') {
      const deleted = service.delete(id)
      json(deleted ? 200 : 404, { ok: deleted, item: undefined })
      return true
    }
  }
  if (path === '/graph') {
    json(200, { ok: true, ...service.graph(projectParam(params)) })
    return true
  }
  if (path === '/lint') {
    // The legacy page renders a markdown string, not a report object.
    const items = service.store.list({ limit: 1_000_000, ...(projectParam(params) ? { project: projectParam(params) as string } : {}) }).items
    const active = items.filter(item => item.status === 'active')
    const ids = new Set(items.map(item => item.id))
    const broken: string[] = []
    for (const item of active) {
      for (const field of ['supersedes', 'related', 'supersededBy'] as const) {
        for (const ref of item[field] ?? []) if (!ids.has(ref)) broken.push(`- **${item.title}** (\`${item.id}\`): ${field} → \`${ref}\``)
      }
    }
    const staleCutoff = Date.now() - 90 * 24 * 60 * 60 * 1000
    const stale = active.filter(item => Date.parse(item.updatedAt) < staleCutoff)
    const marks = [
      '## Сводка',
      `- всего записей: **${items.length}**, активных: **${active.length}**`,
      `- битых ссылок: **${broken.length}**, устаревших (>90 дней): **${stale.length}**`,
    ]
    if (broken.length > 0) marks.push('', '## Битые ссылки', ...broken)
    if (stale.length > 0) marks.push('', '## Устаревшие', ...stale.map(item => `- **${item.title}** — обновлено ${item.updatedAt}`))
    json(200, { ok: true, report: marks.join('\n') })
    return true
  }
  if (path === '/heal') {
    const body = await readJson(req)
    const mode = body['mode'] === 'apply-safe' ? 'apply-safe' : 'report'
    const result = selfHeal(service.store.list({ limit: 1_000_000, ...(projectParam(params) ? { project: projectParam(params) as string } : {}) }).items, mode)
    if (mode === 'apply-safe') {
      for (const entry of result.items) {
        service.store.upsert(entry)
        writeItemPage(service.store.root, entry, entry.scope === 'project' ? entry.project : null, '.kilo/memory')
      }
    }
    const fixed = result.issues.filter(issue => issue.fixed).length
    const lines = [
      `## Оздоровление (${mode === 'apply-safe' ? 'применено' : 'отчёт'})`,
      `- найдено проблем: **${result.issues.length}**, исправлено: **${fixed}**`,
      ...result.issues.map(issue => `- ${issue.kind}: \`${issue.entryId}\` — ${issue.detail}${issue.fixed ? ' *(исправлено)*' : ''}`),
    ]
    json(200, { ok: true, mode, report: lines.join('\n') })
    return true
  }
  return false
}

export function persistConfig(configPath: string) {
  return (next: KiloMemoryConfig): void => writeFileSync(configPath, JSON.stringify(next, null, 2), 'utf8')
}
