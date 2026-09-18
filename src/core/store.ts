/**
 * SQLite/FTS5 index over the markdown memory layers.
 *
 * Markdown pages are the source of truth; this store is a derived search index.
 * It is built on `node:sqlite` (`DatabaseSync`), uses WAL with a busy timeout,
 * opens lazily and rebuilds itself from disk when the database is missing or
 * empty.
 */
import { randomBytes } from 'node:crypto'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { appendLog, debug } from './log.js'
import {
  ensureDir,
  entryPathFor,
  readProjectsRegistry,
  removeFileIfExists,
  resolveStoragePaths,
  resolveStorageRoot,
  sanitizeProjectKey,
  writeProjectsRegistry,
} from './paths.js'
import { tokenize } from './ranking.js'
import { clampImportance, isMemoryKind, isMemoryScope, isMemoryStatus, isMemoryTier } from './types.js'
import type {
  MemoryEntry,
  MemoryEntryInit,
  MemoryFilter,
  MemoryListResult,
  MemoryStoreOptions,
} from './types.js'
import { decodePage, deleteItemPage, migrateFlatPages, readAllPages, writeItemPage } from './wiki.js'

/** Values accepted by prepared statement parameters in this module. */
type SqlParam = string | number | null

/** Generate a new stable entry id. */
export function genMemoryId(): string {
  return `m_${randomBytes(6).toString('hex')}`
}

function firstLine(text: string): string {
  const line = text.split(/\r?\n/).find((candidate) => candidate.trim().length > 0) ?? ''
  const trimmed = line.trim()
  return trimmed.length > 0 ? trimmed.slice(0, 80) : 'untitled'
}

/** Build a fully populated entry from partial input. */
export function newMemoryEntry(init: MemoryEntryInit = {}): MemoryEntry {
  const text = (init.text ?? '').trim()
  const now = new Date().toISOString()
  return {
    id: init.id ?? genMemoryId(),
    scope: init.scope ?? 'project',
    project: init.project ?? '',
    kind: init.kind ?? 'facts',
    tier: init.tier ?? 'normal',
    status: init.status ?? 'active',
    title: init.title && init.title.trim().length > 0 ? init.title.trim() : firstLine(text),
    text,
    tags: [...(init.tags ?? [])],
    keywords: init.keywords ?? '',
    importance: clampImportance(init.importance ?? 3),
    supersedes: [...(init.supersedes ?? [])],
    supersededBy: [...(init.supersededBy ?? [])],
    related: [...(init.related ?? [])],
    ...(init.source !== undefined ? { source: init.source } : {}),
    ...(init.extKey !== undefined ? { extKey: init.extKey } : {}),
    createdAt: init.createdAt ?? now,
    updatedAt: init.updatedAt ?? now,
    ...(init.confidence !== undefined ? { confidence: init.confidence } : {}),
  }
}

function asString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return fallback
  return String(value)
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function asArray(value: unknown): string[] {
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value)
      return Array.isArray(parsed) ? parsed.map(String) : []
    } catch {
      return []
    }
  }
  return Array.isArray(value) ? value.map(String) : []
}

function rowToEntry(row: Record<string, unknown>): MemoryEntry {
  const confidence = asNumber(row['confidence'])
  const source = asString(row['source'])
  const extKey = asString(row['ext_key'])
  const scope = row['scope']
  const kind = row['kind']
  const tier = row['tier']
  const status = row['status']
  return {
    id: asString(row['id']),
    scope: isMemoryScope(scope) ? scope : 'project',
    project: asString(row['project']),
    kind: isMemoryKind(kind) ? kind : 'facts',
    tier: isMemoryTier(tier) ? tier : 'normal',
    status: isMemoryStatus(status) ? status : 'active',
    title: asString(row['title']),
    text: asString(row['text']),
    tags: asArray(row['tags']),
    keywords: asString(row['keywords']),
    importance: clampImportance(row['importance']),
    supersedes: asArray(row['supersedes']),
    supersededBy: asArray(row['superseded_by']),
    related: asArray(row['related']),
    ...(source.length > 0 ? { source } : {}),
    ...(extKey.length > 0 ? { extKey } : {}),
    createdAt: asString(row['created_at']),
    updatedAt: asString(row['updated_at']),
    ...(confidence !== undefined ? { confidence } : {}),
  }
}

function normalizeLimit(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined
  return Math.floor(value)
}

function normalizeOffset(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0
  return Math.floor(value)
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}

const DEFAULT_ORDER = 'm.updated_at DESC, m.id ASC'

const ORDER_BY: Record<string, string> = {
  updated: DEFAULT_ORDER,
  created: 'm.created_at DESC, m.id ASC',
  importance: 'm.importance DESC, m.updated_at DESC',
  confidence: 'm.confidence DESC, m.updated_at DESC',
  title: 'm.title ASC, m.id ASC',
}

function orderByClause(sort: string | undefined): string {
  return ORDER_BY[sort ?? 'updated'] ?? DEFAULT_ORDER
}

/**
 * Derived memory index. Construct with a storage root (or `dbPath` override)
 * and use the methods below; the database is opened on first use.
 */
export class MemoryStore {
  readonly root: string
  readonly dbPath: string
  private db: DatabaseSync | null = null
  private ftsAvailable = false
  private ready = false
  /** Cached `key -> absolute project root` registry (`projects.json`). */
  private projects: Record<string, string> = {}
  private projectsLoaded = false

  constructor(options: MemoryStoreOptions = {}) {
    const paths = resolveStoragePaths(resolveStorageRoot(options.storageRoot))
    this.root = paths.root
    this.dbPath = options.dbPath ?? paths.dbPath
  }

  /** Whether the underlying database connection is open. */
  get isOpen(): boolean {
    return this.db !== null
  }

  /** Whether the FTS5 index is available in this SQLite build. */
  get hasFts(): boolean {
    return this.ftsAvailable
  }

  /** Load (or reload) the project registry from `projects.json`. */
  private loadProjects(force = false): void {
    if (this.projectsLoaded && !force) return
    this.projects = readProjectsRegistry(this.root)
    this.projectsLoaded = true
  }

  /** Absolute project root registered for a key, or null when unknown. */
  getProjectRoot(key: string): string | null {
    const projectKey = sanitizeProjectKey(key)
    if (projectKey.length === 0) return null
    this.loadProjects()
    const value = this.projects[projectKey]
    return typeof value === 'string' && value.length > 0 ? value : null
  }

  /** Register a project root in the in-memory cache and `projects.json`. */
  setProjectRoot(key: string, projectRoot: string): void {
    const projectKey = sanitizeProjectKey(key)
    const value = (projectRoot ?? '').trim()
    if (projectKey.length === 0 || value.length === 0) return
    this.loadProjects()
    if (this.projects[projectKey] === value) return
    this.projects[projectKey] = value
    writeProjectsRegistry(this.root, this.projects)
  }

  /** All registered project roots. */
  projectRoots(): Record<string, string> {
    this.loadProjects()
    return { ...this.projects }
  }

  /** Project root that owns a project-scope entry (null for user scope). */
  private projectRootOf(entry: Pick<MemoryEntry, 'scope' | 'project'>): string | null {
    if (entry.scope !== 'project') return null
    return this.getProjectRoot(entry.project)
  }

  /** Absolute markdown path of an entry under the current registry. */
  private filePathFor(entry: Pick<MemoryEntry, 'id' | 'kind' | 'title' | 'scope' | 'project'>): string {
    return entryPathFor(this.root, entry, this.projectRootOf(entry))
  }

  /** Open the database lazily (idempotent). */
  open(): void {
    if (this.db) return
    ensureDir(dirname(this.dbPath))
    const db = new DatabaseSync(this.dbPath)
    try {
      db.exec('PRAGMA journal_mode = WAL;')
      db.exec('PRAGMA busy_timeout = 5000;')
    } catch (error) {
      debug(`pragma setup failed: ${String(error)}`)
    }
    this.db = db
    this.ensureSchema()
  }

  private requireDb(): DatabaseSync {
    if (!this.db) throw new Error('MemoryStore is not open')
    return this.db
  }

  private ensureReady(): void {
    this.open()
    if (this.ready) return
    this.ready = true
    this.loadProjects()
    // Move legacy flat pages into their `<kind>/` subdirectory before reading.
    // A non-zero count means the index may hold stale paths, so rebuild it.
    const migration = migrateFlatPages(this.root, this.projects)
    const row = this.requireDb().prepare('SELECT COUNT(*) AS count FROM memories').get()
    const count = asNumber(row?.['count']) ?? 0
    if (count === 0 || migration.moved > 0) this.reindexFromDisk()
  }

  private ensureSchema(): void {
    const db = this.requireDb()
    db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL DEFAULT 'project',
        project TEXT NOT NULL DEFAULT '',
        kind TEXT NOT NULL DEFAULT 'facts',
        tier TEXT NOT NULL DEFAULT 'normal',
        status TEXT NOT NULL DEFAULT 'active',
        title TEXT NOT NULL DEFAULT '',
        text TEXT NOT NULL DEFAULT '',
        tags TEXT NOT NULL DEFAULT '[]',
        keywords TEXT NOT NULL DEFAULT '',
        importance INTEGER NOT NULL DEFAULT 3,
        supersedes TEXT NOT NULL DEFAULT '[]',
        superseded_by TEXT NOT NULL DEFAULT '[]',
        related TEXT NOT NULL DEFAULT '[]',
        source TEXT,
        ext_key TEXT,
        path TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL DEFAULT '',
        confidence REAL
      );
    `)
    db.exec('CREATE INDEX IF NOT EXISTS idx_memories_scope_project ON memories(scope, project);')
    db.exec('CREATE INDEX IF NOT EXISTS idx_memories_status ON memories(status);')
    db.exec('CREATE INDEX IF NOT EXISTS idx_memories_kind ON memories(kind);')
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_ext_key ON memories(ext_key) WHERE ext_key IS NOT NULL;')
    this.ensureColumns()
    this.ftsAvailable = this.ensureFts()
  }

  /** Add columns that may be missing in databases created by older versions. */
  private ensureColumns(): void {
    const db = this.requireDb()
    const columns = new Set(
      (db.prepare('PRAGMA table_info(memories)').all() as Array<Record<string, unknown>>).map((row) => asString(row['name'])),
    )
    const add = (name: string, ddl: string): void => {
      if (columns.has(name)) return
      try {
        db.exec(`ALTER TABLE memories ADD COLUMN ${ddl}`)
      } catch (error) {
        debug(`migration for column ${name} failed: ${String(error)}`)
      }
    }
    add('source', 'source TEXT')
    add('ext_key', 'ext_key TEXT')
    add('path', "path TEXT NOT NULL DEFAULT ''")
    add('superseded_by', "superseded_by TEXT NOT NULL DEFAULT '[]'")
    add('confidence', 'confidence REAL')
  }

  /** Create the FTS5 table, rebuilding it when it lacks the required `id` column. */
  private ensureFts(): boolean {
    const db = this.requireDb()
    try {
      const columns = db.prepare('PRAGMA table_info(memories_fts)').all() as Array<Record<string, unknown>>
      if (columns.length > 0 && !columns.some((row) => asString(row['name']) === 'id')) {
        db.exec('DROP TABLE memories_fts;')
      }
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
          id, title, text, tags, keywords, tokenize = 'unicode61'
        );
      `)
      return true
    } catch (error) {
      debug(`FTS5 unavailable: ${String(error)}`)
      return false
    }
  }

  private transaction(fn: () => void): void {
    const db = this.requireDb()
    db.exec('BEGIN')
    try {
      fn()
      db.exec('COMMIT')
    } catch (error) {
      try {
        db.exec('ROLLBACK')
      } catch {
        /* ignore rollback failure */
      }
      throw error
    }
  }

  private syncFts(entry: MemoryEntry): void {
    if (!this.ftsAvailable) return
    const db = this.requireDb()
    try {
      db.prepare('DELETE FROM memories_fts WHERE id = ?').run(entry.id)
      db.prepare('INSERT INTO memories_fts (id, title, text, tags, keywords) VALUES (?, ?, ?, ?, ?)').run(
        entry.id,
        entry.title,
        entry.text,
        entry.tags.join(' '),
        entry.keywords,
      )
    } catch (error) {
      debug(`FTS sync failed for ${entry.id}: ${String(error)}`)
    }
  }

  private writeRow(entry: MemoryEntry, file: string): void {
    const db = this.requireDb()
    db.prepare(
      `INSERT INTO memories (
         id, scope, project, kind, tier, status, title, text, tags, keywords, importance,
         supersedes, superseded_by, related, source, ext_key, path, created_at, updated_at, confidence
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         scope = excluded.scope,
         project = excluded.project,
         kind = excluded.kind,
         tier = excluded.tier,
         status = excluded.status,
         title = excluded.title,
         text = excluded.text,
         tags = excluded.tags,
         keywords = excluded.keywords,
         importance = excluded.importance,
         supersedes = excluded.supersedes,
         superseded_by = excluded.superseded_by,
         related = excluded.related,
         source = excluded.source,
         ext_key = excluded.ext_key,
         path = excluded.path,
         created_at = excluded.created_at,
         updated_at = excluded.updated_at,
         confidence = excluded.confidence`,
    ).run(
      entry.id,
      entry.scope,
      entry.project,
      entry.kind,
      entry.tier,
      entry.status,
      entry.title,
      entry.text,
      JSON.stringify(entry.tags),
      entry.keywords,
      entry.importance,
      JSON.stringify(entry.supersedes),
      JSON.stringify(entry.supersededBy),
      JSON.stringify(entry.related),
      entry.source ?? null,
      entry.extKey ?? null,
      file,
      entry.createdAt,
      entry.updatedAt,
      entry.confidence ?? null,
    )
    this.syncFts(entry)
  }

  private getRow(id: string): Record<string, unknown> | null {
    const row = this.requireDb().prepare('SELECT * FROM memories WHERE id = ?').get(id)
    return row ?? null
  }

  private buildWhere(filter: MemoryFilter): { sql: string; params: SqlParam[] } {
    const clauses: string[] = []
    const params: SqlParam[] = []
    if (filter.scope && filter.scope !== 'all') {
      clauses.push('m.scope = ?')
      params.push(filter.scope)
    }
    if (filter.project && filter.project !== 'all') {
      clauses.push('m.project = ?')
      params.push(filter.project)
    }
    if (filter.kind && filter.kind !== 'all') {
      clauses.push('m.kind = ?')
      params.push(filter.kind)
    }
    if (filter.tier && filter.tier !== 'all') {
      clauses.push('m.tier = ?')
      params.push(filter.tier)
    }
    if (filter.status && filter.status !== 'all') {
      clauses.push('m.status = ?')
      params.push(filter.status)
    }
    if (filter.tag && filter.tag.length > 0) {
      clauses.push("m.tags LIKE ? ESCAPE '\\'")
      params.push(`%${escapeLike(filter.tag)}%`)
    }
    return { sql: clauses.join(' AND '), params }
  }

  private applyLimit(sql: string, params: SqlParam[], filter: MemoryFilter): string {
    const limit = normalizeLimit(filter.limit)
    if (limit !== undefined) {
      sql += ' LIMIT ?'
      params.push(limit)
      const offset = normalizeOffset(filter.offset)
      if (offset > 0) {
        sql += ' OFFSET ?'
        params.push(offset)
      }
      return sql
    }
    const offset = normalizeOffset(filter.offset)
    if (offset > 0) {
      sql += ' LIMIT -1 OFFSET ?'
      params.push(offset)
    }
    return sql
  }

  /** Persist an entry to markdown and refresh the index. */
  upsert(input: MemoryEntry): MemoryEntry {
    this.ensureReady()
    const next: MemoryEntry = {
      ...input,
      tags: [...input.tags],
      supersedes: [...input.supersedes],
      supersededBy: [...input.supersededBy],
      related: [...input.related],
      title: input.title.trim().length > 0 ? input.title.trim() : firstLine(input.text),
      importance: clampImportance(input.importance),
    }

    if (next.extKey) {
      const existingExt = this.getByExtKey(next.extKey)
      if (existingExt && existingExt.id !== next.id) {
        const incomingId = next.id
        next.id = existingExt.id
        next.createdAt = existingExt.createdAt || next.createdAt
        const strayPath = this.filePathFor({ ...next, id: incomingId })
        const targetPath = this.filePathFor(next)
        if (strayPath !== targetPath) removeFileIfExists(strayPath)
      }
    }

    const previous = this.getRow(next.id)
    if (previous && !next.extKey) {
      const previousExtKey = asString(previous['ext_key'])
      if (previousExtKey.length > 0) next.extKey = previousExtKey
    }

    next.updatedAt = next.updatedAt.length > 0 ? next.updatedAt : new Date().toISOString()
    const file = writeItemPage(this.root, next, this.projectRootOf(next))
    const previousPath = previous ? asString(previous['path']) : ''
    if (previousPath.length > 0 && previousPath !== file) removeFileIfExists(previousPath)

    this.writeRow(next, file)
    appendLog(this.root, 'upsert', next.title, next.id)
    return next
  }

  /** Remove an entry from markdown and the index. */
  delete(id: string): boolean {
    this.ensureReady()
    const row = this.getRow(id)
    if (!row) return false
    const file = asString(row['path'])
    if (file.length > 0) deleteItemPage(file)
    const db = this.requireDb()
    db.prepare('DELETE FROM memories WHERE id = ?').run(id)
    if (this.ftsAvailable) db.prepare('DELETE FROM memories_fts WHERE id = ?').run(id)
    appendLog(this.root, 'delete', asString(row['title']), id)
    return true
  }

  /** Fetch an entry by id. */
  get(id: string): MemoryEntry | null {
    this.ensureReady()
    const row = this.getRow(id)
    return row ? rowToEntry(row) : null
  }

  /** Fetch an entry by its external import key. */
  getByExtKey(extKey: string): MemoryEntry | null {
    this.ensureReady()
    const row = this.requireDb().prepare('SELECT * FROM memories WHERE ext_key = ?').get(extKey)
    return row ? rowToEntry(row) : null
  }

  /** All entry ids (any status). */
  allIds(): string[] {
    this.ensureReady()
    return (this.requireDb().prepare('SELECT id FROM memories ORDER BY id').all() as Array<Record<string, unknown>>).map((row) =>
      asString(row['id']),
    )
  }

  /** List entries matching a filter, with the total match count. */
  list(filter: MemoryFilter = {}): MemoryListResult {
    this.ensureReady()
    const db = this.requireDb()
    const where = this.buildWhere(filter)
    const countRow = db.prepare(`SELECT COUNT(*) AS count FROM memories m${where.sql ? ` WHERE ${where.sql}` : ''}`).get(...where.params)
    const total = asNumber(countRow?.['count']) ?? 0
    const order = orderByClause(filter.sort)
    let sql = `SELECT m.* FROM memories m${where.sql ? ` WHERE ${where.sql}` : ''} ORDER BY ${order}`
    const params: SqlParam[] = [...where.params]
    sql = this.applyLimit(sql, params, filter)
    const rows = db.prepare(sql).all(...params) as Array<Record<string, unknown>>
    return { items: rows.map(rowToEntry), total }
  }

  private searchFts(terms: string[], filter: MemoryFilter): MemoryEntry[] | null {
    if (!this.ftsAvailable) return null
    const where = this.buildWhere(filter)
    const match = terms.map((term) => `"${term.replace(/"/g, '""')}"*`).join(' OR ')
    const params: SqlParam[] = [match, ...where.params]
    let sql = 'SELECT m.* FROM memories_fts JOIN memories m ON m.id = memories_fts.id WHERE memories_fts MATCH ?'
    if (where.sql) sql += ` AND ${where.sql}`
    sql += ' ORDER BY bm25(memories_fts) ASC'
    sql = this.applyLimit(sql, params, filter)
    try {
      const rows = this.requireDb().prepare(sql).all(...params) as Array<Record<string, unknown>>
      if (rows.length === 0) return null
      return rows.map(rowToEntry)
    } catch (error) {
      debug(`FTS search failed: ${String(error)}`)
      return null
    }
  }

  private searchLike(terms: string[], filter: MemoryFilter): MemoryEntry[] {
    const where = this.buildWhere(filter)
    const clauses: string[] = []
    const params: SqlParam[] = []
    for (const term of terms) {
      clauses.push(
        "(lower(m.title) LIKE ? ESCAPE '\\' OR lower(m.text) LIKE ? ESCAPE '\\' OR " +
          "lower(m.keywords) LIKE ? ESCAPE '\\' OR lower(m.tags) LIKE ? ESCAPE '\\')",
      )
      const pattern = `%${escapeLike(term)}%`
      params.push(pattern, pattern, pattern, pattern)
    }
    let sql = `SELECT m.* FROM memories m WHERE (${clauses.join(' OR ')})`
    if (where.sql) sql += ` AND ${where.sql}`
    params.push(...where.params)
    sql += ` ORDER BY ${orderByClause(filter.sort)}`
    sql = this.applyLimit(sql, params, filter)
    return (this.requireDb().prepare(sql).all(...params) as Array<Record<string, unknown>>).map(rowToEntry)
  }

  /** Search by text with FTS5 and a LIKE fallback when FTS is unavailable or empty. */
  search(query: string, filter: MemoryFilter = {}): MemoryEntry[] {
    this.ensureReady()
    const terms = tokenize(query ?? '')
    if (terms.length === 0) return this.list(filter).items
    const fts = this.searchFts(terms, filter)
    if (fts !== null) return fts
    return this.searchLike(terms, filter)
  }

  /** Rebuild the whole index from markdown pages on disk. */
  reindexFromDisk(): number {
    this.open()
    this.loadProjects(true)
    const pages = readAllPages(this.root, this.projects)
    const db = this.requireDb()
    const seenExtKeys = new Set<string>()
    let indexed = 0
    this.transaction(() => {
      db.exec('DELETE FROM memories;')
      if (this.ftsAvailable) db.exec('DELETE FROM memories_fts;')
      for (const page of pages) {
        const entry = decodePage(page)
        if (!entry) continue
        if (entry.extKey) {
          if (seenExtKeys.has(entry.extKey)) entry.extKey = undefined
          else seenExtKeys.add(entry.extKey)
        }
        this.writeRow(entry, page.file)
        indexed++
      }
    })
    this.ready = true
    debug(`reindexed ${indexed} entries from ${this.root}`)
    return indexed
  }

  /** Close the database connection. */
  close(): void {
    try {
      this.db?.close()
    } catch {
      /* ignore close failure */
    }
    this.db = null
    this.ftsAvailable = false
    this.ready = false
  }
}
