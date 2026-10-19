/**
 * Field mapping between the canonical `MemoryEntry` and the physical rows of
 * known harness stores (Kilo `memories`, DSH `memories`). Pure functions: they
 * never open a database and never see paths, only column names (ADR-002).
 */
import {
  clampImportance,
  isMemoryKind,
  isMemoryStatus,
  isMemoryTier,
  type MemoryEntry,
  type MemoryScope,
  type MemoryScopeInput,
} from './types.js'

/** Kilo's `global` is the same layer as DSH's `user`: both are cross-project. */
export function normalizeScope(value: MemoryScopeInput | string | undefined): MemoryScope {
  if (value === 'project') return 'project'
  // 'user' | 'global' | unknown -> user layer, so old rows never lose their place.
  return 'user'
}

export function toStoredScope(value: MemoryScopeInput | undefined): 'project' | 'user' | 'global' {
  return value === 'project' ? 'project' : 'global'
}

function list(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(item => String(item))
  if (typeof value !== 'string' || value.trim() === '') return []
  try {
    const parsed: unknown = JSON.parse(value)
    if (Array.isArray(parsed)) return parsed.map(item => String(item))
  } catch {
    // fall through to comma-separated form
  }
  return value.split(',').map(item => item.trim()).filter(Boolean)
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function number(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function kind(value: unknown): MemoryEntry['kind'] {
  return typeof value === 'string' && isMemoryKind(value) ? value : 'facts'
}

function tier(value: unknown): MemoryEntry['tier'] {
  return typeof value === 'string' && isMemoryTier(value) ? value : 'normal'
}

function status(value: unknown): MemoryEntry['status'] {
  return typeof value === 'string' && isMemoryStatus(value) ? value : 'active'
}

function consolidation(value: unknown): MemoryEntry['consolidation'] {
  return value === 'episodic' || value === 'semantic' || value === 'procedural' ? value : undefined
}

function lastSegment(path: string | undefined): string {
  if (!path) return ''
  const segment = path.split(/[\\/]/).filter(Boolean).pop() ?? ''
  return segment.toLowerCase().replace(/[^a-z0-9._-]+/g, '-')
}

const KILO_COLUMNS = new Set([
  'id', 'scope', 'kind', 'tier', 'status', 'title', 'content', 'tags', 'keywords',
  'importance', 'source', 'supersedes', 'supersededBy', 'related', 'createdAt',
  'updatedAt', 'lastAccess', 'accessCount', 'file', 'mtimeMs', 'project_root',
  'confidence', 'consolidation',
])

export function entryFromKiloRow(row: Record<string, unknown>): MemoryEntry {
  const extra: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) if (!KILO_COLUMNS.has(key)) extra[key] = value
  const now = new Date().toISOString()
  return {
    id: String(row.id ?? ''),
    scope: normalizeScope(row.scope as string | undefined),
    project: lastSegment(text(row.project_root) ?? text(row.project)),
    kind: kind(row.kind),
    tier: tier(row.tier),
    status: status(row.status),
    title: String(row.title ?? ''),
    text: String(row.content ?? ''),
    tags: list(row.tags),
    keywords: String(row.keywords ?? ''),
    importance: clampImportance(typeof row.importance === 'number' ? row.importance : 3),
    supersedes: list(row.supersedes),
    supersededBy: list(row.supersededBy),
    related: list(row.related),
    ...(text(row.source) ? { source: text(row.source) } : {}),
    origin: 'kilo',
    createdAt: text(row.createdAt) ?? now,
    updatedAt: text(row.updatedAt) ?? now,
    ...(number(row.confidence) !== undefined ? { confidence: number(row.confidence) } : {}),
    ...(text(row.lastAccess) ? { lastAccess: text(row.lastAccess) } : {}),
    ...(number(row.accessCount) !== undefined ? { accessCount: number(row.accessCount) } : {}),
    ...(consolidation(row.consolidation) ? { consolidation: consolidation(row.consolidation) } : {}),
    ...(Object.keys(extra).length > 0 ? { extra } : {}),
  }
}

/** Canonical entry -> Kilo `memories` row (snake_case columns are handled by the writer). */
export function entryToKiloRow(entry: MemoryEntry): Record<string, unknown> {
  const row = {
    id: entry.id,
    scope: toStoredScope(entry.scope),
    kind: entry.kind,
    tier: entry.tier,
    status: entry.status,
    title: entry.title,
    content: entry.text,
    tags: JSON.stringify(entry.tags),
    keywords: entry.keywords,
    importance: entry.importance,
    source: entry.source ?? 'user',
    supersedes: JSON.stringify(entry.supersedes),
    supersededBy: JSON.stringify(entry.supersededBy),
    related: JSON.stringify(entry.related),
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    lastAccess: entry.lastAccess ?? entry.updatedAt,
    accessCount: entry.accessCount ?? 0,
    project_root: entry.project,
    confidence: entry.confidence ?? 0.5,
    consolidation: entry.consolidation ?? 'episodic',
  } satisfies Record<string, unknown>
  if (entry.extra) Object.assign(row, entry.extra)
  return row
}

const DSH_COLUMNS = new Set([
  'id', 'scope', 'project', 'kind', 'tier', 'status', 'title', 'text', 'tags', 'keywords',
  'importance', 'source', 'supersedes', 'superseded_by', 'related', 'createdAt', 'created_at',
  'updatedAt', 'updated_at', 'confidence', 'ext_key', 'path', 'file_size', 'file_mtime_ms',
  'content_hash',
])

export function entryFromDshRow(row: Record<string, unknown>): MemoryEntry {
  const extra: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(row)) if (!DSH_COLUMNS.has(key)) extra[key] = value
  const now = new Date().toISOString()
  return {
    id: String(row.id ?? ''),
    scope: normalizeScope(row.scope as string | undefined),
    project: String(row.project ?? ''),
    kind: kind(row.kind),
    tier: tier(row.tier),
    status: status(row.status),
    title: String(row.title ?? ''),
    text: String(row.text ?? ''),
    tags: list(row.tags),
    keywords: String(row.keywords ?? ''),
    importance: clampImportance(typeof row.importance === 'number' ? row.importance : 3),
    supersedes: list(row.supersedes),
    supersededBy: list(row.superseded_by ?? row.supersededBy),
    related: list(row.related),
    ...(text(row.source) ? { source: text(row.source) } : {}),
    origin: 'dsh',
    createdAt: text(row.created_at as string) ?? text(row.createdAt) ?? now,
    updatedAt: text(row.updated_at as string) ?? text(row.updatedAt) ?? now,
    ...(number(row.confidence) !== undefined ? { confidence: number(row.confidence) } : {}),
    ...(text(row.ext_key as string) ? { extKey: text(row.ext_key as string) } : {}),
    ...(number(row.file_size) !== undefined ? { extra: { ...extra, fileSize: number(row.file_size) } } : (Object.keys(extra).length > 0 ? { extra } : {})),
  }
}

export function entryToDshRow(entry: MemoryEntry): Record<string, unknown> {
  const row = {
    id: entry.id,
    scope: entry.scope,
    project: entry.project,
    kind: entry.kind,
    tier: entry.tier,
    status: entry.status,
    title: entry.title,
    text: entry.text,
    tags: JSON.stringify(entry.tags),
    keywords: entry.keywords,
    importance: entry.importance,
    source: entry.source ?? 'user',
    supersedes: JSON.stringify(entry.supersedes),
    superseded_by: JSON.stringify(entry.supersededBy),
    related: JSON.stringify(entry.related),
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    confidence: entry.confidence ?? 0.5,
    ext_key: entry.extKey ?? null,
  } satisfies Record<string, unknown>
  if (entry.extra) Object.assign(row, entry.extra)
  return row
}
