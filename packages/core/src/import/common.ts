/**
 * Shared helpers for the memory importers.
 *
 * Foreign stores expose slightly different column names and value shapes, so
 * the importers normalize them into the core `MemoryEntry` model here. The
 * change-detection helper powers idempotent re-imports.
 */
import { copyFileSync, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'

import {
  clampImportance,
  isMemoryKind,
  isMemoryStatus,
  isMemoryTier,
  type MemoryEntry,
  type MemoryImportance,
  type MemoryKind,
  type MemoryStatus,
  type MemoryTier,
} from '../types.js'

/** A project discovered while importing a foreign store. */
export interface ImportedProject {
  /** Local project key (directory basename); never empty. */
  key: string
  /** Raw project root as spelled by the source, or null when unknown. */
  root: string | null
}

/**
 * Register a project in a keyed map, keeping the first key spelling and filling
 * a missing root later. Blank keys are ignored; blank roots stay null.
 */
export function addImportedProject(
  map: Map<string, ImportedProject>,
  key: string,
  root: string | null | undefined,
): void {
  const trimmedKey = (key ?? '').trim()
  if (trimmedKey.length === 0) return
  const normalizedRoot = typeof root === 'string' && root.trim().length > 0 ? root.trim() : null
  const existing = map.get(trimmedKey)
  if (!existing) {
    map.set(trimmedKey, { key: trimmedKey, root: normalizedRoot })
    return
  }
  if (existing.root === null && normalizedRoot !== null) existing.root = normalizedRoot
}

/** Collapse several project lists into one stable, de-duplicated list. */
export function mergeImportedProjects(
  lists: readonly (readonly ImportedProject[])[],
): ImportedProject[] {
  const map = new Map<string, ImportedProject>()
  for (const list of lists) {
    for (const project of list) addImportedProject(map, project.key, project.root)
  }
  return [...map.values()]
}

/** A read-only database connection plus a cleanup hook for temp snapshots. */
export interface ReadOnlyDatabase {
  db: DatabaseSync
  /** Release any temporary snapshot created for a WAL database. */
  cleanup: () => void
}

function safeSize(file: string): number {
  try {
    return statSync(file).size
  } catch {
    return 0
  }
}

/**
 * Open a foreign SQLite database without ever touching it.
 *
 * A plain `{ readOnly: true }` connection to a WAL database still creates
 * `-wal`/`-shm` side files, which is forbidden for the Kilo store. When there is
 * no pending WAL we therefore open through an `immutable=1` URI: SQLite then
 * reads the main file directly and creates no side files. If a non-empty WAL is
 * present (recent uncommitted-to-main frames), the database is snapshotted into
 * a temp directory and the copy is opened instead, so the source stays
 * untouched while the latest committed data remains visible.
 */
export function openReadOnlyDatabase(dbPath: string): ReadOnlyDatabase {
  const walPath = `${dbPath}-wal`
  const shmPath = `${dbPath}-shm`
  const hasPendingWal = existsSync(walPath) && safeSize(walPath) > 0

  if (!hasPendingWal) {
    const db = new DatabaseSync(`${pathToFileURL(dbPath).href}?immutable=1`, { readOnly: true })
    db.exec('PRAGMA query_only = ON;')
    return { db, cleanup: () => undefined }
  }

  const dir = mkdtempSync(join(tmpdir(), 'dsh-llm-memory-read-'))
  const copy = join(dir, 'memory.db')
  copyFileSync(dbPath, copy)
  if (existsSync(walPath)) copyFileSync(walPath, `${copy}-wal`)
  if (existsSync(shmPath)) copyFileSync(shmPath, `${copy}-shm`)
  const db = new DatabaseSync(copy)
  db.exec('PRAGMA query_only = ON;')
  return {
    db,
    cleanup: () => {
      rmSync(dir, { recursive: true, force: true })
    },
  }
}

/**
 * Cheap presence check for a table inside a foreign SQLite file.
 *
 * Root detection must not create side files for every probed candidate, so the
 * file is first opened through an `immutable=1` URI: SQLite then reads the main
 * file directly. A freshly created WAL store keeps its schema only in the
 * pending `-wal` file, where `immutable` cannot see it — for those the database
 * is snapshotted exactly like a real import would.
 */
export function hasSqliteTable(dbPath: string, table: string): boolean {
  if (!existsSync(dbPath)) return false
  try {
    const db = new DatabaseSync(`${pathToFileURL(dbPath).href}?immutable=1`, { readOnly: true })
    try {
      if (sqliteTablePresent(db, table)) return true
    } finally {
      db.close()
    }
  } catch {
    /* not an immutable-readable SQLite file, fall through to the snapshot path */
  }

  let opened: ReadOnlyDatabase | null = null
  try {
    opened = openReadOnlyDatabase(dbPath)
    return sqliteTablePresent(opened.db, table)
  } catch {
    return false
  } finally {
    try {
      opened?.db.close()
    } catch {
      /* ignore close failure */
    }
    opened?.cleanup()
  }
}

function sqliteTablePresent(db: DatabaseSync, table: string): boolean {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .all(table) as unknown[]
  return rows.length > 0
}

/** Coerce a value into a string list (JSON array text, array or comma list). */
export function toStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item))
  if (typeof value !== 'string') return []
  const text = value.trim()
  if (text.length === 0) return []
  if (text.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(text)
      if (Array.isArray(parsed)) return parsed.map((item) => String(item))
    } catch {
      /* not a JSON array, fall through to comma splitting */
    }
  }
  return text
    .split(/,\s*/u)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

/** Coerce a value into an ISO timestamp, accepting ISO text and epoch ms/seconds. */
export function toIsoString(value: unknown, fallback = new Date().toISOString()): string {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = Math.abs(value) < 1e12 ? value * 1000 : value
    const date = new Date(ms)
    return Number.isNaN(date.getTime()) ? fallback : date.toISOString()
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const text = value.trim()
    if (/^\d+$/u.test(text)) return toIsoString(Number(text), fallback)
    const date = new Date(text)
    return Number.isNaN(date.getTime()) ? fallback : date.toISOString()
  }
  return fallback
}

const KIND_ALIASES: Record<string, MemoryKind> = {
  rule: 'rules',
  rules: 'rules',
  preference: 'preferences',
  preferences: 'preferences',
  decision: 'decisions',
  decisions: 'decisions',
  fact: 'facts',
  facts: 'facts',
  architecture: 'architecture',
  architectures: 'architecture',
  concept: 'concepts',
  concepts: 'concepts',
}

/** Normalize a foreign kind/category into a core kind. */
export function toMemoryKind(value: unknown, fallback: MemoryKind = 'facts'): MemoryKind {
  if (isMemoryKind(value)) return value
  if (typeof value === 'string') {
    const alias = KIND_ALIASES[value.trim().toLowerCase()]
    if (alias) return alias
  }
  return fallback
}

/** Normalize a foreign tier into a core tier. */
export function toMemoryTier(value: unknown, fallback: MemoryTier = 'normal'): MemoryTier {
  return isMemoryTier(value) ? value : fallback
}

/** Normalize a foreign status into a core status. */
export function toMemoryStatus(value: unknown, fallback: MemoryStatus = 'active'): MemoryStatus {
  return isMemoryStatus(value) ? value : fallback
}

/** Normalize a foreign importance value. */
export function toImportance(value: unknown): MemoryImportance {
  return clampImportance(value)
}

/** First non-empty line of a text, used as a fallback title. */
export function firstLine(text: string, maxLength = 120): string {
  const line = text.split(/\r?\n/u).find((candidate) => candidate.trim().length > 0) ?? ''
  const trimmed = line.trim()
  if (trimmed.length === 0) return 'untitled'
  // `slice` can stop on a space; the store trims titles, so leaving one would
  // make every re-import look like a change.
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength).trimEnd() : trimmed
}

/** Stringify a value, with a fallback for null/undefined. */
export function asString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return fallback
  return String(value)
}

/** Parse a finite number, returning undefined for anything else. */
export function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

/** Column names of a table (empty when the table does not exist). */
export function tableColumns(db: DatabaseSync, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<Record<string, unknown>>
  return new Set(rows.map((row) => asString(row['name'])))
}

/** Read the first value whose column exists on the row. */
export function pickColumn(
  row: Record<string, unknown>,
  columns: ReadonlySet<string>,
  names: readonly string[],
): unknown {
  for (const name of names) {
    if (!columns.has(name)) continue
    const value = row[name]
    if (value !== undefined && value !== null) return value
  }
  return undefined
}

/** An external key paired with the local id it resolved to. */
export interface ExternalIdResolution {
  extKey: string
  localId: string
}

/**
 * Build a lookup used to rewrite external relation ids onto local ids.
 *
 * Both the full external key (`<source>:<id>`) and the bare suffix (`<id>`) are
 * registered, because foreign stores usually store the bare id in
 * `supersedes`/`supersededBy`/`related` while our keys carry the source prefix.
 */
export function buildExternalIdMap(
  source: string,
  resolutions: readonly ExternalIdResolution[],
): Map<string, string> {
  const map = new Map<string, string>()
  const prefix = `${source}:`
  for (const { extKey, localId } of resolutions) {
    if (extKey.length === 0) continue
    if (!map.has(extKey)) map.set(extKey, localId)
    if (extKey.startsWith(prefix)) {
      const suffix = extKey.slice(prefix.length)
      if (suffix.length > 0 && !map.has(suffix)) map.set(suffix, localId)
    }
  }
  return map
}

/** Result of rewriting a relation list onto local ids. */
export interface RemappedRelations {
  ids: string[]
  /** References dropped because no local entry matched the external id. */
  dropped: number
}

/**
 * Rewrite external relation ids to local ids. A reference whose target was not
 * part of the imported batch is dropped so no broken link is persisted.
 * Duplicate results are collapsed.
 */
export function remapRelationIds(
  ids: readonly string[],
  source: string,
  map: ReadonlyMap<string, string>,
): RemappedRelations {
  const out: string[] = []
  let dropped = 0
  for (const id of ids) {
    const local = map.get(id) ?? map.get(`${source}:${id}`)
    if (local === undefined) {
      dropped++
      continue
    }
    if (!out.includes(local)) out.push(local)
  }
  return { ids: out, dropped }
}

/** Compare the imported fields of two entries (ignores ids and timestamps). */
export function sameImportedEntry(a: MemoryEntry, b: MemoryEntry): boolean {
  const signature = (entry: MemoryEntry): string =>
    JSON.stringify({
      scope: entry.scope,
      project: entry.project,
      kind: entry.kind,
      tier: entry.tier,
      status: entry.status,
      title: entry.title,
      text: entry.text,
      tags: entry.tags,
      keywords: entry.keywords,
      importance: entry.importance,
      supersedes: entry.supersedes,
      supersededBy: entry.supersededBy,
      related: entry.related,
      source: entry.source ?? '',
    })
  return signature(a) === signature(b)
}
