/**
 * WebUI host half: HTTP routes served through `ctx.webServer` for the shell
 * client plugin (iframe) and REST/RPC endpoints.
 *
 * The pure {@link createWebHandler} owns routing so it can be unit-tested with
 * mock request/response objects; {@link registerMemoryWeb} only wires it to the
 * dsh web server. Routes are loopback-only and carry no authentication, exactly
 * like every other plugin-owned prefix route.
 *
 * @module dsh-llm-memory/dsh/web
 */
import { readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'

import type { Context } from '@deepseek-ai/cordis'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'

import type { MemoryConfig } from '../core/config.js'
import type { MemoryEngine, SaveInput, UpdatePatch } from '../core/engine.js'
import {
  detectImportProjects,
  IMPORT_SOURCES,
  mergeImportedProjects,
  runImport,
  type ImportedProject,
  type ImportSourceName,
} from '../core/import/index.js'
import type { MemoryFilter, MemoryKind, MemoryTier } from '../core/types.js'
import {
  clampImportance,
  isMemoryKind,
  isMemoryScope,
  isMemoryStatus,
  isMemoryTier,
} from '../core/types.js'
import { exportRulesToDshAgents, previewRulesExport } from './rules-export.js'
import {
  findWorkspacePathByKey,
  registerImportedWorkspaces,
  registerProjectRoots,
  type ProjectRootRegistrationReport,
  type WorkspaceRegistryLike,
  type WorkspaceSyncReport,
} from './workspaces.js'

/** Maximum accepted request body size in bytes. */
export const MAX_BODY_BYTES = 1024 * 1024

/** Async request handler shaped like a `WebRoute` handler. */
export type WebHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>

/** HTTP error carrying the status code written to the response. */
class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

/** Normalize a configured web path into an absolute, slash-only prefix. */
export function normalizeWebPath(value: string | undefined): string {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  const withSlash = trimmed.length === 0 ? '/llm-memory' : trimmed.startsWith('/') ? trimmed : `/${trimmed}`
  const stripped = withSlash.replace(/\/+$/u, '')
  return stripped.length === 0 ? '/llm-memory' : stripped
}

/** True when the peer is the loopback interface (or unknown, as in tests). */
function isLoopback(req: IncomingMessage): boolean {
  const address = (req.socket as { remoteAddress?: string } | undefined)?.remoteAddress
  if (address === undefined || address.length === 0) return true
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

/** Write one JSON response. */
function sendJson(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value, null, 2)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(body)
}

/** Write one HTML response. */
function sendHtml(res: ServerResponse, html: string): void {
  res.statusCode = 200
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(html)
}

/** Read and validate a JSON object body, enforcing the size limit. */
function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise<string>((resolvePromise, rejectPromise) => {
    const chunks: Buffer[] = []
    let size = 0
    let settled = false
    const fail = (error: unknown): void => {
      if (settled) return
      settled = true
      rejectPromise(error)
    }
    req.on('data', (chunk: Buffer | string) => {
      if (settled) return
      const buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
      size += buffer.length
      if (size > limit) {
        fail(new HttpError(413, 'Request body is too large.'))
        try {
          req.destroy()
        } catch {
          /* ignore */
        }
        return
      }
      chunks.push(buffer)
    })
    req.on('end', () => {
      if (settled) return
      settled = true
      resolvePromise(Buffer.concat(chunks).toString('utf8'))
    })
    req.on('error', (error) => fail(error))
  })
}

/** Parse a JSON object body, returning `{}` for an empty payload. */
async function readJsonBody(req: IncomingMessage, limit: number): Promise<Record<string, unknown>> {
  const text = await readBody(req, limit)
  if (text.trim().length === 0) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON.')
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HttpError(400, 'Request body must be a JSON object.')
  }
  return parsed as Record<string, unknown>
}

/** Case-insensitive string field helper. */
function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/** Parse an array of non-empty strings, dropping everything else. */
function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const trimmed = item.trim()
    if (trimmed.length > 0) out.push(trimmed)
  }
  return out
}

/** Parse an integer query/body value with bounds. */
function asInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  const rounded = Math.round(n)
  if (rounded < min) return min
  if (rounded > max) return max
  return rounded
}

/** One query parameter, treating blank values as absent. */
function param(url: URL, name: string): string | undefined {
  const value = url.searchParams.get(name)
  if (value === null) return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

/** The UI page is read relative to the compiled module so it ships in `ui/`. */
function loadUiHtml(): string {
  return readFileSync(new URL('../../ui/web-ui.html', import.meta.url), 'utf8')
}

/** Build the create/update payload accepted by the save route. */
function saveInputFrom(body: Record<string, unknown>): SaveInput {
  const text = asString(body.text)?.trim() ?? ''
  if (text.length === 0) throw new HttpError(400, 'Field "text" is required and must not be empty.')
  const title = asString(body.title)?.trim()
  const scope = asString(body.scope)
  const project = asString(body.project)?.trim()
  const keywords = asString(body.keywords)
  const tags = asStringArray(body.tags)
  const supersedes = asStringArray(body.supersedes)
  const related = asStringArray(body.related)
  const kind = asKind(body.kind)
  const tier = asTier(body.tier)
  return {
    text,
    ...(title !== undefined && title.length > 0 ? { title } : {}),
    ...(kind !== undefined ? { kind } : {}),
    ...(scope === 'project' || scope === 'user' ? { scope } : {}),
    ...(project !== undefined && project.length > 0 ? { project } : {}),
    ...(tier !== undefined ? { tier } : {}),
    ...(body.importance !== undefined ? { importance: clampImportance(body.importance) } : {}),
    ...(tags !== undefined ? { tags } : {}),
    ...(keywords !== undefined ? { keywords } : {}),
    ...(supersedes !== undefined ? { supersedes } : {}),
    ...(related !== undefined ? { related } : {}),
  }
}

/** Narrow a body value to a memory kind (undefined when absent or invalid). */
function asKind(value: unknown): MemoryKind | undefined {
  return isMemoryKind(value) ? value : undefined
}

/** Narrow a body value to a memory tier. */
function asTier(value: unknown): MemoryTier | undefined {
  return isMemoryTier(value) ? value : undefined
}

/** Build the patch accepted by the update path of the save route. */
function updatePatchFrom(body: Record<string, unknown>): UpdatePatch {
  const patch: UpdatePatch = {}
  const title = asString(body.title)?.trim()
  if (title !== undefined && title.length > 0) patch.title = title
  const text = asString(body.text)?.trim()
  if (text !== undefined && text.length > 0) patch.text = text
  const kind = asKind(body.kind)
  if (kind !== undefined) patch.kind = kind
  const tier = asTier(body.tier)
  if (tier !== undefined) patch.tier = tier
  if (isMemoryStatus(body.status)) patch.status = body.status
  if (body.importance !== undefined) patch.importance = clampImportance(body.importance)
  const tags = asStringArray(body.tags)
  if (tags !== undefined) patch.tags = tags
  const keywords = asString(body.keywords)
  if (keywords !== undefined) patch.keywords = keywords
  const supersedes = asStringArray(body.supersedes)
  if (supersedes !== undefined) patch.supersedes = supersedes
  const related = asStringArray(body.related)
  if (related !== undefined) patch.related = related
  if (body.confidence !== undefined) {
    const confidence = typeof body.confidence === 'number' ? body.confidence : Number(body.confidence)
    if (Number.isFinite(confidence)) patch.confidence = Math.min(1, Math.max(0, confidence))
  }
  return patch
}

/** Narrow a body value to a supported import source name. */
function isImportSourceName(value: unknown): value is ImportSourceName {
  return typeof value === 'string' && (IMPORT_SOURCES as readonly string[]).includes(value)
}

/** Workspace sync payload sent back to the UI. */
export type WorkspaceSyncPayload = WorkspaceSyncReport | { unavailable: true }

/** Host wiring that lets the pure handler reach `ctx.workspaceRegistry`. */
export interface WebHandlerOptions {
  /** Resolve the workspace registry lazily; may return undefined when absent. */
  getWorkspaceRegistry?: () => unknown
}

/**
 * Resolve `ctx.workspaceRegistry` without requiring it to be injected: try the
 * reflected property, the `ctx.get` mixin and finally the non-strict reflection
 * lookup, which is documented to work without an inject declaration.
 */
function resolveWorkspaceRegistry(ctx: Context): WorkspaceRegistryLike | undefined {
  const source = ctx as unknown as {
    workspaceRegistry?: unknown
    get?: (name: string) => unknown
    reflect?: { get?: (name: string, strict?: boolean) => unknown }
  }
  const candidates: Array<() => unknown> = [
    () => source.workspaceRegistry,
    () => source.get?.('workspaceRegistry'),
    () => source.reflect?.get?.('workspaceRegistry', false),
  ]
  for (const read of candidates) {
    try {
      const registry = asWorkspaceRegistry(read())
      if (registry) return registry
    } catch {
      /* try the next resolution path */
    }
  }
  return undefined
}

/** Accept a value shaped like `ctx.workspaceRegistry`. */
function asWorkspaceRegistry(value: unknown): WorkspaceRegistryLike | undefined {
  if (value === null || typeof value !== 'object') return undefined
  const candidate = value as Partial<WorkspaceRegistryLike>
  if (
    typeof candidate.create !== 'function' ||
    typeof candidate.resolveByPath !== 'function' ||
    typeof candidate.list !== 'function'
  ) {
    return undefined
  }
  return candidate as WorkspaceRegistryLike
}

/** Parse an explicit `projects` array from a request body. */
function asProjectArray(value: unknown): ImportedProject[] {
  if (!Array.isArray(value)) return []
  const out: ImportedProject[] = []
  for (const item of value) {
    if (item === null || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const key = asString(record['key'])?.trim() ?? ''
    if (key.length === 0) continue
    const root = asString(record['root'])?.trim()
    out.push({ key, root: root !== undefined && root.length > 0 ? root : null })
  }
  return out
}

/** Format the import reports for the JSON response. */
function importResponse(reports: ReturnType<typeof runImport>): Record<string, unknown> {
  const totals = { imported: 0, updated: 0, skipped: 0, droppedRelations: 0 }
  for (const report of reports) {
    totals.imported += report.imported
    totals.updated += report.updated
    totals.skipped += report.skipped
    totals.droppedRelations += report.droppedRelations
  }
  return { reports, totals, projects: mergeImportedProjects(reports.map((report) => report.projects)) }
}

/**
 * Build the pure HTTP handler for the plugin's prefix route.
 *
 * Supported endpoints (all relative to the configured `webPath`):
 * `GET /ui`, `GET /api/status`, `GET /api/lint`, `GET /api/graph`,
 * `GET /api/items?query=&kind=&scope=&project=&status=&limit=&offset=`,
 * `GET /api/item?id=`, `POST /api/save`, `POST /api/forget`,
 * `POST /api/delete`, `POST /api/import`, `POST /api/workspaces/sync`,
 * `POST /api/heal`, `GET|POST /api/rules/preview`, `POST /api/rules/export`.
 */
export function createWebHandler(
  engine: MemoryEngine,
  config: MemoryConfig,
  options: WebHandlerOptions = {},
): WebHandler {
  const base = normalizeWebPath(config.webPath)
  /** Projects from the most recent import, reused by the sync endpoint. */
  let lastProjects: ImportedProject[] = []

  const syncWorkspaces = async (projects: ImportedProject[]): Promise<WorkspaceSyncPayload> => {
    const registry = options.getWorkspaceRegistry
      ? asWorkspaceRegistry(options.getWorkspaceRegistry())
      : undefined
    if (!registry) return { unavailable: true }
    return registerImportedWorkspaces(registry, projects)
  }

  const handleGet = (rel: string, url: URL, res: ServerResponse): void => {
    if (rel === '/ui') {
      sendHtml(res, loadUiHtml())
      return
    }
    if (rel === '/api/status') {
      sendJson(res, 200, engine.statusReport())
      return
    }
    if (rel === '/api/lint') {
      sendJson(res, 200, engine.lintReport())
      return
    }
    if (rel === '/api/graph') {
      sendJson(res, 200, engine.graph())
      return
    }
    if (rel === '/api/items') {
      const kind = param(url, 'kind')
      const scope = param(url, 'scope')
      const status = param(url, 'status')
      const project = param(url, 'project')
      const query = param(url, 'query')
      const limit = asInt(param(url, 'limit'), 50, 1, 1000)
      const offset = asInt(param(url, 'offset'), 0, 0, 1_000_000)
      const filter: MemoryFilter = { status: isMemoryStatus(status) ? status : 'all', sort: 'updated', limit, offset }
      if (isMemoryKind(kind)) filter.kind = kind
      if (isMemoryScope(scope)) filter.scope = scope
      if (project !== undefined) filter.project = project
      const result = engine.list(filter)
      let items = result.items
      if (query !== undefined) {
        const needle = query.toLowerCase()
        items = items.filter((entry) =>
          `${entry.title}\n${entry.text}\n${entry.tags.join(' ')}\n${entry.keywords}`.toLowerCase().includes(needle),
        )
      }
      sendJson(res, 200, {
        items,
        total: query !== undefined ? items.length : result.total,
        limit,
        offset,
        query: query ?? '',
      })
      return
    }
    if (rel === '/api/rules/preview') {
      sendJson(res, 200, previewRulesExport(config))
      return
    }
    if (rel === '/api/item') {
      const id = param(url, 'id')
      if (id === undefined) {
        sendJson(res, 400, { error: 'Missing required query parameter "id".' })
        return
      }
      const entry = engine.get(id)
      if (!entry) {
        sendJson(res, 404, { error: `Memory entry not found: ${id}` })
        return
      }
      sendJson(res, 200, { item: entry })
      return
    }
    sendJson(res, 404, { error: 'Not found' })
  }

  const handlePost = async (rel: string, req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (rel === '/api/save') {
      const body = await readJsonBody(req, MAX_BODY_BYTES)
      const id = asString(body.id)?.trim() ?? ''
      if (id.length > 0) {
        const existing = engine.get(id)
        if (!existing) throw new HttpError(404, `Memory entry not found: ${id}`)
        const updated = engine.update(id, updatePatchFrom(body))
        if (!updated) throw new HttpError(404, `Memory entry not found: ${id}`)
        sendJson(res, 200, { mode: 'updated', item: updated })
        return
      }
      const saved = engine.save(saveInputFrom(body))
      sendJson(res, 200, { mode: 'created', item: saved })
      return
    }
    if (rel === '/api/forget') {
      const body = await readJsonBody(req, MAX_BODY_BYTES)
      const id = asString(body.id)?.trim() ?? ''
      if (id.length === 0) throw new HttpError(400, 'Field "id" is required.')
      const result = engine.forget(id)
      if (!result.ok) throw new HttpError(404, result.message)
      sendJson(res, 200, { id, message: result.message, item: result.entry ?? null })
      return
    }
    if (rel === '/api/delete') {
      const body = await readJsonBody(req, MAX_BODY_BYTES)
      const id = asString(body.id)?.trim() ?? ''
      if (id.length === 0) throw new HttpError(400, 'Field "id" is required.')
      const deleted = engine.delete(id)
      if (!deleted) throw new HttpError(404, `Memory entry not found: ${id}`)
      sendJson(res, 200, { id, deleted: true })
      return
    }
    if (rel === '/api/import') {
      const body = await readJsonBody(req, MAX_BODY_BYTES)
      const requested = Array.isArray(body.sources) ? body.sources.filter(isImportSourceName) : []
      const importConfig = {
        importRoots: config.importRoots,
        importAutoDetect: config.importAutoDetect,
      }
      // Register project roots before importing so project pages land inside
      // each repository rather than in the global fallback directory.
      const discovered = detectImportProjects({ config: importConfig })
      const projectRegistration = registerProjectRoots(engine, discovered)
      const reports = runImport({
        store: engine.getStore(),
        config: importConfig,
        ...(requested.length > 0 ? { sources: requested } : {}),
      })
      lastProjects = mergeImportedProjects(reports.map((report) => report.projects))
      registerProjectRoots(engine, lastProjects)
      const workspaces = await syncWorkspaces(lastProjects)
      sendJson(res, 200, { ...importResponse(reports), workspaces, projectRegistration })
      return
    }
    if (rel === '/api/workspaces/sync') {
      const body = await readJsonBody(req, MAX_BODY_BYTES)
      const explicit = asProjectArray(body.projects)
      const projects =
        explicit.length > 0
          ? explicit
          : lastProjects.length > 0
            ? lastProjects
            : detectImportProjects({
                config: {
                  importRoots: config.importRoots,
                  importAutoDetect: config.importAutoDetect,
                },
              })
      const projectRegistration: ProjectRootRegistrationReport = registerProjectRoots(engine, projects)
      const workspaces = await syncWorkspaces(projects)
      sendJson(res, 200, { projects, workspaces, projectRegistration })
      return
    }
    if (rel === '/api/heal') {
      await readJsonBody(req, MAX_BODY_BYTES)
      sendJson(res, 200, engine.heal())
      return
    }
    if (rel === '/api/rules/preview') {
      await readJsonBody(req, MAX_BODY_BYTES)
      sendJson(res, 200, previewRulesExport(config))
      return
    }
    if (rel === '/api/rules/export') {
      await readJsonBody(req, MAX_BODY_BYTES)
      sendJson(res, 200, exportRulesToDshAgents(config))
      return
    }
    if (rel.startsWith('/api/')) {
      const getOnly = ['/api/status', '/api/lint', '/api/graph', '/api/items', '/api/item']
      if (getOnly.includes(rel)) {
        res.setHeader('Allow', 'GET')
      }
      sendJson(res, getOnly.includes(rel) ? 405 : 404, { error: 'Not found' })
      return
    }
    sendJson(res, 404, { error: 'Not found' })
  }

  return async (req, res) => {
    try {
      const method = (req.method ?? 'GET').toUpperCase()
      const url = new URL(req.url ?? '/', 'http://localhost')
      const pathname = url.pathname
      if (pathname !== base && !pathname.startsWith(`${base}/`)) {
        sendJson(res, 404, { error: 'Not found' })
        return
      }
      if (!isLoopback(req)) {
        sendJson(res, 403, { error: 'This endpoint is available on loopback only.' })
        return
      }
      const rel = pathname.slice(base.length) || '/'
      if (method === 'GET') {
        handleGet(rel, url, res)
        return
      }
      if (method === 'POST') {
        await handlePost(rel, req, res)
        return
      }
      res.setHeader('Allow', 'GET, POST')
      sendJson(res, 405, { error: `Method ${method} is not allowed.` })
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500
      const message = error instanceof HttpError ? error.message : 'Internal server error'
      if (res.writableEnded !== true) sendJson(res, status, { error: message })
    }
  }
}

/** Log a warning through the Cordis logger, falling back to the console. */
function warnWeb(ctx: Context, message: string): void {
  try {
    ctx.logger.warn(message)
  } catch {
    console.warn(`[dsh-llm-memory] ${message}`)
  }
}

/**
 * Register the plugin's HTTP routes (UI page, REST API, rules export/import).
 * The prefix route lives for as long as the plugin fiber.
 */
export function registerMemoryWeb(ctx: Context, engine: MemoryEngine, config: MemoryConfig): void {
  const base = normalizeWebPath(config.webPath)
  const handler = createWebHandler(engine, config, {
    getWorkspaceRegistry: () => resolveWorkspaceRegistry(ctx),
  })
  const route: WebRoute = { kind: 'prefix', path: base, handler }
  try {
    ctx.effect(() => ctx.webServer.register(route))
  } catch (error) {
    warnWeb(ctx, `Web routes at "${base}" were not registered: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Resolve a project root through `ctx.workspaceRegistry` when the service is
 * reachable. Used as the engine's fallback resolver: explicit overrides and
 * `projects.json` take precedence, this only covers freshly opened workspaces.
 */
export function resolveWorkspaceProjectRoot(ctx: Context, key: string): string | null {
  const registry = resolveWorkspaceRegistry(ctx)
  if (!registry) return null
  return findWorkspacePathByKey(registry, key)
}
