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
import { openDatabase, type SqliteDatabase } from './sqlite/index.js'

import { appendLog, debug } from './log.js'
import {
  ensureDir,
  entryPathFor,
  fileStatInfo,
  readFileIfExists,
  readProjectsRegistry,
  removeFileIfExists,
  resolveStoragePaths,
  resolveStorageRoot,
  sanitizeProjectKey,
  writeProjectsRegistry,
} from '../layout/paths.js'
import { tokenize } from '../application/ranking.js'
import { clampImportance, isMemoryKind, isMemoryScope, isMemoryStatus, isMemoryTier } from '../domain/types.js'
import type {
  MemoryEntry,
  MemoryEntryInit,
  MemoryFilter,
  MemoryListResult,
  MemoryStoreOptions,
  VectorBackend,
  VectorIndex,
  VectorQuantization,
} from '../domain/types.js'
import { VECTOR_TABLE_DDL, VECTOR_TABLE_INDEX_DDL, createVectorIndex } from './vector-index.js'
import {
  decodePage,
  deleteItemPage,
  enumeratePages,
  migrateFlatPages,
  readAllPages,
  writeItemPage,
} from '../application/wiki.js'

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
    ...(init.origin !== undefined ? { origin: init.origin } : {}),
    ...(init.lastAccess !== undefined ? { lastAccess: init.lastAccess } : {}),
    ...(init.accessCount !== undefined ? { accessCount: init.accessCount } : {}),
    ...(init.consolidation !== undefined ? { consolidation: init.consolidation } : {}),
    ...(init.contentHash !== undefined ? { contentHash: init.contentHash } : {}),
    ...(init.extra !== undefined ? { extra: { ...init.extra } } : {}),
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
    ...(asNumber(row['access_count']) !== undefined ? { accessCount: asNumber(row['access_count']) } : {}),
    ...(asString(row['last_access']).length > 0 ? { lastAccess: asString(row['last_access']) } : {}),
    ...(consolidationValue(row['consolidation']) !== undefined
      ? { consolidation: consolidationValue(row['consolidation']) }
      : {}),
    ...(asString(row['origin']).length > 0 ? { origin: asString(row['origin']) } : {}),
  }
}

function consolidationValue(value: unknown): MemoryEntry['consolidation'] {
  return value === 'raw' || value === 'episodic' || value === 'semantic' || value === 'procedural'
    ? (value as MemoryEntry['consolidation'])
    : undefined
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

/** Whether a decoded page carries exactly the data of an existing index row. */
function entryMatchesRow(entry: MemoryEntry, row: Record<string, unknown>): boolean {
  const sameStrings = (value: unknown, expected: string[]): boolean => {
    const actual = asArray(value)
    return actual.length === expected.length && actual.every((item, index) => item === expected[index])
  }
  return (
    asString(row['scope']) === entry.scope &&
    asString(row['project']) === entry.project &&
    asString(row['kind']) === entry.kind &&
    asString(row['tier']) === entry.tier &&
    asString(row['status']) === entry.status &&
    asString(row['title']) === entry.title &&
    asString(row['text']) === entry.text &&
    asString(row['keywords']) === entry.keywords &&
    clampImportance(row['importance']) === entry.importance &&
    asString(row['source']) === (entry.source ?? '') &&
    asString(row['ext_key']) === (entry.extKey ?? '') &&
    asString(row['created_at']) === entry.createdAt &&
    asString(row['updated_at']) === entry.updatedAt &&
    (asNumber(row['confidence']) ?? null) === (entry.confidence ?? null) &&
    (asNumber(row['access_count']) ?? null) === (entry.accessCount ?? null) &&
    asString(row['last_access']) === (entry.lastAccess ?? '') &&
    (consolidationValue(row['consolidation']) ?? null) === (entry.consolidation ?? null) &&
    asString(row['origin']) === (entry.origin ?? '') &&
    sameStrings(row['tags'], entry.tags) &&
    sameStrings(row['supersedes'], entry.supersedes) &&
    sameStrings(row['superseded_by'], entry.supersededBy) &&
    sameStrings(row['related'], entry.related)
  )
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

/** Tuning of an incremental index pass ({@link MemoryStore.reconcileFromDisk}). */
export interface ReconcileOptions {
  /**
   * Stop `stat`-ing a base directory after this many milliseconds (0 = no
   * budget).
   *
   * A directory that runs out of budget keeps its previous rows: its files were
   * listed (so they are known to exist) but their fingerprints stay stale until
   * the next pass. This bounds the worst case on slow mounts — on a WSL host a
   * single `/mnt/c` project root can cost seconds per pass.
   */
  budgetPerBaseDirMs?: number
  /**
   * Clock used to measure the budget (defaults to `Date.now`). Injectable so a
   * caller — primarily a test — can make deferral deterministic instead of
   * depending on how fast the filesystem answers `stat`.
   */
  now?: () => number
}

/** Outcome of {@link MemoryStore.reconcileFromDisk}. */
export interface ReconcileReport {
  /**
   * `incremental` when pages were compared by fingerprint; `full` when the
   * database had no fingerprints at all and had to be rebuilt from scratch.
   */
  mode: 'incremental' | 'full'
  /** Page files seen on disk (readdir only). */
  scanned: number
  /** Pages actually read and parsed (new, changed or without a fingerprint). */
  read: number
  /** Index rows created for pages that were not indexed before. */
  added: number
  /** Index rows refreshed from a changed page. */
  updated: number
  /** Rows left untouched because size and mtime matched. */
  unchanged: number
  /**
   * Pages that were re-read (their fingerprint changed) but whose data is
   * identical to the row already in the index: only the fingerprint is
   * refreshed, so no row and no full-text index entry is rewritten.
   */
  refreshed: number
  /** Rows removed because their page is gone from disk. */
  removed: number
  /** Pages that exist but carry no decodable frontmatter. */
  skipped: number
  /** Base directories cut short by the time budget. */
  deferred: string[]
  /** Wall-clock duration of the pass in milliseconds. */
  ms: number
}

/**
 * Derived memory index. Construct with a storage root (or `dbPath` override)
 * and use the methods below; the database is opened on first use.
 */

/**
 * Explain a database open failure in terms of the store's own constraint.
 *
 * The store lives on a local disk: SQLite WAL needs real file locks, which a
 * UNC/SMB share or a 9p mount does not provide (spikes A1/A10). Windows also
 * reports a read-only or locked file as "unable to open database file", so the
 * hint names both suspects instead of relaying the driver message alone.
 */
function describeStorageError(error: unknown, dbPath: string): string {
  const reason = error instanceof Error ? error.message : String(error)
  const lower = reason.toLowerCase()
  const network = /disk i\/o|unable to open|database is locked|busy|unc|network|9p/.test(lower)
  const hint = network
    ? 'The store must live on a local disk: WAL does not work over a network share (UNC/9p), and the path must be writable by this process.'
    : 'Check that the path exists, is writable and is not locked by another process.'
  return `Cannot open the memory database at ${dbPath}: ${reason}. ${hint}`
}

export class MemoryStore {
  readonly root: string
  readonly dbPath: string
  private db: SqliteDatabase | null = null
  private ftsAvailable = false
  private ready = false
  /** Cached `key -> absolute project root` registry (`projects.json`). */
  private projects: Record<string, string> = {}
  private projectsLoaded = false
  /** Default per-directory budget of an index pass (0 = no budget). */
  private readonly scanBudgetMs: number
  /** Whether the connection allows loading SQLite extensions (sqlite-vec). */
  private readonly allowExtension: boolean
  /** Vector index over chunk embeddings; null while the vector leg is off. */
  private vectors: VectorIndex | null = null
  /**
   * Called with the id of every entry written to the index. The embedding queue
   * subscribes to it, which is why a write never has to know about embeddings.
   */
  onEntryChanged: ((id: string) => void) | null = null
  /** Kilo-created tables keep `content NOT NULL`; mirror `text` into it. */
  /** Kilo keeps camelCase columns with NOT NULL; mirror core fields into them. */
  private kiloMirror: string[] = []
  /** Columns that reject NULL and have no default (Kilo keeps `source NOT NULL`). */
  private notNullNoDefault = new Set<string>()

  constructor(options: MemoryStoreOptions = {}) {
    const paths = resolveStoragePaths(resolveStorageRoot(options.storageRoot))
    this.root = paths.root
    this.dbPath = options.dbPath ?? paths.dbPath
    this.scanBudgetMs = Math.max(0, options.scanBudgetMs ?? 0)
    this.allowExtension = options.allowExtension === true
  }

  /** Whether the underlying database connection is open. */
  get isOpen(): boolean {
    return this.db !== null
  }

  /** Whether the FTS5 index is available in this SQLite build. */
  get hasFts(): boolean {
    return this.ftsAvailable
  }

  /**
   * Create (or replace) the vector index for one embedding model.
   *
   * `memory_vectors` belongs to the schema, so a backend only reads and writes
   * rows and the database handle stays owned by the store.
   */
  initVectorIndex(options: {
    model: string
    dim: number
    backend: VectorBackend
    quantization?: VectorQuantization
  }): VectorIndex | null {
    this.ensureReady()
    this.vectors = createVectorIndex(options.backend, {
      db: this.requireDb(),
      model: options.model,
      dim: options.dim,
      debug,
      ...(options.quantization ? { quantization: options.quantization } : {}),
    })
    return this.vectors
  }

  /** Vector index of this store, or null while the vector leg is off. */
  vectorIndex(): VectorIndex | null {
    return this.vectors
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
    let db: SqliteDatabase
    try {
      db = this.allowExtension
        ? openDatabase(this.dbPath, { allowExtension: true })
        : openDatabase(this.dbPath)
    } catch (error) {
      throw new Error(describeStorageError(error, this.dbPath))
    }
    try {
      db.exec('PRAGMA journal_mode = WAL;')
      db.exec('PRAGMA busy_timeout = 5000;')
    } catch (error) {
      // A read-only or network-mounted file still works in rollback mode; the
      // warning points at the actual constraint instead of failing the open.
      debug(`pragma setup failed (${describeStorageError(error, this.dbPath)})`)
    }
    this.db = db
    this.ensureSchema()
  }

  private requireDb(): SqliteDatabase {
    if (!this.db) throw new Error('MemoryStore is not open')
    return this.db
  }

  private ensureReady(): void {
    this.open()
    if (this.ready) return
    this.ready = true
    this.loadProjects()
    // Move legacy flat pages into their `<kind>/` subdirectory before reading.
    const migration = migrateFlatPages(this.root, this.projects)
    const row = this.requireDb().prepare('SELECT COUNT(*) AS count FROM memories').get()
    const count = asNumber(row?.['count']) ?? 0
    // A full pass is only needed when there is nothing to compare against.
    // Pages moved out of the flat layout are picked up by the incremental pass,
    // which re-reads them (their path changed) and drops the rows that pointed
    // at the old paths.
    if (count === 0) this.reindexFromDisk()
    else if (migration.moved > 0) this.reconcileFromDisk()
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
        confidence REAL,
        access_count INTEGER,
        last_access TEXT,
        consolidation TEXT,
        origin TEXT
      );
    `)
    db.exec('CREATE INDEX IF NOT EXISTS idx_memories_scope_project ON memories(scope, project);')
    db.exec('CREATE INDEX IF NOT EXISTS idx_memories_status ON memories(status);')
    db.exec('CREATE INDEX IF NOT EXISTS idx_memories_kind ON memories(kind);')
    // `path` identifies the markdown page a row was built from: the incremental
    // reconcile replaces a row whose page changed its id by path, so a scan
    // here would turn every such page into a full table scan.
    db.exec('CREATE INDEX IF NOT EXISTS idx_memories_path ON memories(path);')
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_ext_key ON memories(ext_key) WHERE ext_key IS NOT NULL;')
    // Chunk vectors live next to the entries they describe. `model`, `dim` and
    // `hash` make the cache self-describing: switching the embedding model
    // invalidates vectors through the hash instead of a separate migration.
    db.exec(VECTOR_TABLE_DDL)
    db.exec(VECTOR_TABLE_INDEX_DDL)
    this.ensureColumns()
    this.ftsAvailable = this.ensureFts()
  }

  /** Rebuild the FTS index from the rows (used after schema translation). */
  rebuildFts(): number {
    this.ensureReady()
    const db = this.requireDb()
    db.exec('DELETE FROM memories_fts;')
    const rows = db.prepare('SELECT * FROM memories').all() as Array<Record<string, unknown>>
    for (const row of rows) this.syncFts(rowToEntry(row))
    return rows.length
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
    // Incremental-index fingerprints. Rows created before these columns exist
    // keep NULL and are read once by the first reconcile pass.
    add('file_mtime_ms', 'file_mtime_ms INTEGER')
    add('file_size', 'file_size INTEGER')
    // Kilo parity fields (ADR-002): persisted when the column exists; existing
    // stores gain them additively and never lose rows.
    add('access_count', 'access_count INTEGER')
    add('last_access', 'last_access TEXT')
    add('consolidation', 'consolidation TEXT')
    add('origin', 'origin TEXT')
    this.kiloMirror = ['content', 'createdAt', 'updatedAt', 'lastAccess', 'accessCount'].filter(name => columns.has(name))
    this.notNullNoDefault = new Set(
      (db.prepare('PRAGMA table_info(memories)').all() as Array<Record<string, unknown>>)
        .filter(row => Number(row['notnull']) === 1 && row['dflt_value'] === null)
        .map(row => asString(row['name'])),
    )
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

  /**
   * Insert or update one index row. `stat` carries the on-disk fingerprint
   * (`size` + `mtimeMs`) that lets the next reconcile skip unchanged pages;
   * without it the row is written with NULL fingerprints and is re-read then.
   */
  private writeRow(entry: MemoryEntry, file: string, stat?: { size: number; mtimeMs: number } | null): void {
    const db = this.requireDb()
    db.prepare(
      `INSERT INTO memories (
         id, scope, project, kind, tier, status, title, text, tags, keywords, importance,
         supersedes, superseded_by, related, source, ext_key, path, created_at, updated_at, confidence,
         file_mtime_ms, file_size, access_count, last_access, consolidation, origin${this.kiloMirror.length > 0 ? `, ${this.kiloMirror.join(', ')}` : ''}
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?${this.kiloMirror.map(() => ', ?').join('')})
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
         confidence = excluded.confidence,
         file_mtime_ms = excluded.file_mtime_ms,
         file_size = excluded.file_size,
         access_count = excluded.access_count,
         last_access = excluded.last_access,
         consolidation = excluded.consolidation,
         origin = excluded.origin${this.kiloMirror.map(name => `, ${name} = excluded.${name}`).join('')}`,
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
      entry.source ?? (this.notNullNoDefault.has('source') ? '' : null),
      entry.extKey ?? (this.notNullNoDefault.has('ext_key') ? '' : null),
      file,
      entry.createdAt,
      entry.updatedAt,
      entry.confidence ?? (this.kiloMirror.includes('content') ? 0.5 : null),
      stat?.mtimeMs ?? null,
      stat?.size ?? null,
      entry.accessCount ?? null,
      entry.lastAccess ?? null,
      entry.consolidation ?? (this.kiloMirror.includes('content') ? 'episodic' : null),
      entry.origin ?? '',
      ...this.kiloMirror.map(name => this.kiloMirrorValue(name, entry)),
    )
    this.syncFts(entry)
    this.onEntryChanged?.(entry.id)
  }

  /** Value written into a Kilo camelCase mirror column. */
  private kiloMirrorValue(name: string, entry: MemoryEntry): SqlParam {
    if (name === 'content') return entry.text
    if (name === 'createdAt') return entry.createdAt
    if (name === 'updatedAt') return entry.updatedAt
    if (name === 'lastAccess') return entry.lastAccess ?? entry.updatedAt
    if (name === 'accessCount') return entry.accessCount ?? 0
    return null
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

    this.writeRow(next, file, fileStatInfo(file))
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
    this.vectors?.remove(id)
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

  /**
   * FTS5 search together with the BM25 score of every hit (higher is better, so
   * the SQLite rank is negated for the rank fusion).
   *
   * Returns null when FTS is unavailable, matched nothing or failed — the signal
   * the callers use to fall back to LIKE.
   */
  private searchFtsRanked(
    terms: string[],
    filter: MemoryFilter,
  ): { items: MemoryEntry[]; ranks: Map<string, number> } | null {
    if (!this.ftsAvailable) return null
    const where = this.buildWhere(filter)
    const match = terms.map((term) => `"${term.replace(/"/g, '""')}"*`).join(' OR ')
    const params: SqlParam[] = [match, ...where.params]
    let sql =
      'SELECT m.*, bm25(memories_fts) AS rank FROM memories_fts JOIN memories m ON m.id = memories_fts.id WHERE memories_fts MATCH ?'
    if (where.sql) sql += ` AND ${where.sql}`
    sql += ' ORDER BY bm25(memories_fts) ASC'
    sql = this.applyLimit(sql, params, filter)
    try {
      const rows = this.requireDb().prepare(sql).all(...params) as Array<Record<string, unknown>>
      if (rows.length === 0) return null
      const ranks = new Map<string, number>()
      const items = rows.map((row) => {
        const entry = rowToEntry(row)
        ranks.set(entry.id, -(asNumber(row['rank']) ?? 0))
        return entry
      })
      return { items, ranks }
    } catch (error) {
      debug(`FTS search failed: ${String(error)}`)
      return null
    }
  }

  private searchFts(terms: string[], filter: MemoryFilter): MemoryEntry[] | null {
    return this.searchFtsRanked(terms, filter)?.items ?? null
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

  /**
   * Search by text together with the lexical score of every hit, feeding the
   * hybrid ranking that fuses BM25, metadata and the vector leg.
   */
  searchRanked(query: string, filter: MemoryFilter = {}): { items: MemoryEntry[]; ranks: Map<string, number> } {
    this.ensureReady()
    const terms = tokenize(query ?? '')
    if (terms.length === 0) return { items: this.list(filter).items, ranks: new Map() }
    const ranked = this.searchFtsRanked(terms, filter)
    if (ranked) return ranked
    return { items: this.searchLike(terms, filter), ranks: new Map() }
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
        this.writeRow(entry, page.file, { size: page.size, mtimeMs: page.mtimeMs })
        indexed++
      }
    })
    this.ready = true
    debug(`reindexed ${indexed} entries from ${this.root}`)
    return indexed
  }

  /**
   * Bring the index in line with the markdown pages without re-reading pages
   * that did not change.
   *
   * The pass lists every page (readdir only), `stat`s it and compares `size` +
   * `mtimeMs` against the stored fingerprint: matching pages are skipped
   * untouched, changed and new pages are read, decoded and (re)indexed, and
   * rows whose page is gone from disk are removed. Because listing already
   * proves existence, a page that was listed is never dropped — not even when a
   * time budget stops the pass before its `stat` (see `budgetPerBaseDirMs`).
   *
   * This is what `heal()` and any "refresh the index" path should use: on a
   * store with no external changes it costs one `stat` per page and reads
   * nothing at all.
   */
  reconcileFromDisk(options: ReconcileOptions = {}): ReconcileReport {
    const started = Date.now()
    this.open()
    this.loadProjects(true)
    const db = this.requireDb()

    const rows = db
      .prepare('SELECT id, path, ext_key, file_size, file_mtime_ms FROM memories')
      .all() as Array<Record<string, unknown>>

    // A database written before the fingerprint columns existed has no basis
    // for skipping anything, and rewriting every row in place (update + FTS
    // rewrite + ext_key bookkeeping) is slower than the rebuild path that
    // inserts into emptied tables. Rebuild such a database once instead.
    const fingerprinted = rows.some((row) => asNumber(row['file_size']) !== undefined)
    if (rows.length > 0 && !fingerprinted) {
      const indexed = this.reindexFromDisk()
      const report: ReconcileReport = {
        mode: 'full',
        scanned: indexed,
        read: indexed,
        added: 0,
        updated: indexed,
        unchanged: 0,
        refreshed: 0,
        removed: 0,
        skipped: 0,
        deferred: [],
        ms: Date.now() - started,
      }
      debug(`reconcile: database had no page fingerprints, rebuilt ${indexed} entries in ${report.ms} ms`)
      return report
    }

    const refs = enumeratePages(this.root, this.projects)

    const stored = new Map<string, { id: string; size: number | undefined; mtimeMs: number | undefined }>()
    const storedExtKeys = new Map<string, string[]>()
    for (const row of rows) {
      const path = asString(row['path'])
      if (path.length === 0) continue
      stored.set(path, {
        id: asString(row['id']),
        size: asNumber(row['file_size']),
        mtimeMs: asNumber(row['file_mtime_ms']),
      })
      const extKey = asString(row['ext_key'])
      if (extKey.length === 0) continue
      const owners = storedExtKeys.get(extKey)
      if (owners) owners.push(path)
      else storedExtKeys.set(extKey, [path])
    }

    const budget = Math.max(0, options.budgetPerBaseDirMs ?? this.scanBudgetMs)
    const budgetClock = options.now ?? Date.now
    const deferred: string[] = []
    const knownPaths = new Set<string>()
    const pending: Array<{ entry: MemoryEntry; file: string; size: number; mtimeMs: number }> = []
    const fingerprints: Array<{ id: string; size: number; mtimeMs: number }> = []
    let scanned = 0
    let read = 0
    let unchanged = 0
    let refreshed = 0
    let skipped = 0

    let currentBase = ''
    let baseStart = started
    let baseDeferred = false
    for (const ref of refs) {
      if (ref.baseDir !== currentBase) {
        currentBase = ref.baseDir
        baseStart = budgetClock()
        baseDeferred = false
      }
      scanned++
      knownPaths.add(ref.file)
      if (baseDeferred) continue
      if (budget > 0 && budgetClock() - baseStart > budget) {
        baseDeferred = true
        deferred.push(ref.baseDir)
        debug(`reconcile: budget ${budget} ms exceeded in ${ref.baseDir}; leaving the rest of it untouched`)
        continue
      }
      const info = fileStatInfo(ref.file)
      if (info === null) {
        knownPaths.delete(ref.file)
        continue
      }
      const previous = stored.get(ref.file)
      if (previous && previous.size === info.size && previous.mtimeMs === info.mtimeMs) {
        unchanged++
        continue
      }
      const text = readFileIfExists(ref.file)
      if (text === null) {
        knownPaths.delete(ref.file)
        continue
      }
      read++
      const entry = decodePage({
        file: ref.file,
        size: info.size,
        mtimeMs: info.mtimeMs,
        text,
        scope: ref.scope,
        project: ref.project,
      })
      if (!entry) {
        skipped++
        continue
      }
      // The file was touched but its data is already in the index (a backup
      // restore, `touch`, a checkout): refresh the fingerprint only. Rewriting
      // the row would also rewrite the full-text entry, which is what makes a
      // mass re-read slow.
      if (previous && previous.id === entry.id) {
        const row = this.getRow(entry.id)
        if (row && entryMatchesRow(entry, row)) {
          fingerprints.push({ id: entry.id, size: info.size, mtimeMs: info.mtimeMs })
          refreshed++
          continue
        }
      }
      pending.push({ entry, file: ref.file, size: info.size, mtimeMs: info.mtimeMs })
    }

    const removals: string[] = []
    for (const [path, row] of stored) {
      if (!knownPaths.has(path)) removals.push(row.id)
    }

    // The unique `ext_key` index allows one owner per key. Rows that are still
    // present keep their key; a changed page claiming a taken key is written
    // without it, exactly like a full rebuild decides by page order.
    const seenExtKeys = new Set<string>()
    for (const [extKey, paths] of storedExtKeys) {
      if (paths.some((path) => knownPaths.has(path))) seenExtKeys.add(extKey)
    }

    let added = 0
    let updated = 0
    this.transaction(() => {
      for (const item of fingerprints) {
        db.prepare('UPDATE memories SET file_mtime_ms = ?, file_size = ? WHERE id = ?').run(
          item.mtimeMs,
          item.size,
          item.id,
        )
      }
      for (const item of pending) {
        // A page keeps its path: an id that changed under the same file
        // replaces the row instead of leaving a stale twin behind. The lookup
        // is served by `idx_memories_path`, so an unchanged id costs nothing.
        const previousRow = stored.get(item.file)
        db.prepare('DELETE FROM memories WHERE path = ? AND id != ?').run(item.file, item.entry.id)
        if (item.entry.extKey) {
          if (seenExtKeys.has(item.entry.extKey)) item.entry.extKey = undefined
          else {
            seenExtKeys.add(item.entry.extKey)
            db.prepare('UPDATE memories SET ext_key = NULL WHERE ext_key = ? AND id != ?').run(
              item.entry.extKey,
              item.entry.id,
            )
          }
        }
        const known = previousRow !== undefined
        this.writeRow(item.entry, item.file, { size: item.size, mtimeMs: item.mtimeMs })
        if (known) updated++
        else added++
      }
      for (const id of removals) {
        db.prepare('DELETE FROM memories WHERE id = ?').run(id)
        if (this.ftsAvailable) db.prepare('DELETE FROM memories_fts WHERE id = ?').run(id)
      }
    })

    this.ready = true
    const report: ReconcileReport = {
      mode: 'incremental',
      scanned,
      read,
      added,
      updated,
      unchanged,
      refreshed,
      removed: removals.length,
      skipped,
      deferred,
      ms: Date.now() - started,
    }
    debug(
      `reconciled ${scanned} pages: read ${read}, added ${added}, updated ${updated}, ` +
        `unchanged ${unchanged}, refreshed ${refreshed}, removed ${report.removed}, skipped ${skipped}, ` +
        `deferred ${deferred.length}, ${report.ms} ms`,
    )
    return report
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
