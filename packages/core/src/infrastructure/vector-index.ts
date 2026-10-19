/**
 * Vector index backends.
 *
 * `memory_vectors` is the canonical cache: one float32 row per chunk, written by
 * whichever backend is active and the source the derived tables rebuild from.
 * Two backends implement {@link VectorIndex} on top of it:
 *
 * - {@link JsVectorIndex} scans the cache in process (measured 1.47 ms for 1050
 *   vectors × 384 dimensions);
 * - {@link SqliteVecIndex} mirrors the cache into a `vec0` virtual table and runs
 *   KNN in SQL (0.15 ms on the same data), optionally at `int8` or `bit`
 *   precision.
 *
 * The sqlite-vec backend needs a connection opened with `allowExtension: true`
 * (node:sqlite cannot enable extension loading later) and the optional
 * `sqlite-vec` package. Any failure — no package, no permission, missing binary,
 * a `vec0` rejection — falls back to the in-process index with a debug note, so a
 * broken extension never breaks recall.
 *
 * Vectors are stored normalized, so the cache scan is a dot product and the
 * sqlite-vec L2 distance converts back to cosine as `1 - d²/2`, which is exact
 * for unit vectors.
 *
 * @module dsh-llm-memory/core/vector-index
 */
import { createRequire } from 'node:module'
import type { DatabaseSync } from 'node:sqlite'

import type {
  MemoryFilter,
  MemoryKind,
  MemoryScope,
  MemoryStatus,
  MemoryTier,
  VectorAudit,
  VectorAuditEntry,
  VectorBackend,
  VectorIndex,
  VectorIndexStats,
  VectorMatch,
  VectorQuantization,
  VectorQuery,
  VectorRecord,
} from '../domain/types.js'

/** Values accepted by prepared statement parameters in this module. */
type SqlParam = string | number | null

/**
 * Canonical vector cache: one float32 row per chunk.
 *
 * The store creates it as part of its schema and this module keeps the single
 * definition of the statement, so a backend (or a maintenance script) can be
 * used against a database the store has not opened yet.
 */
export const VECTOR_TABLE_DDL = `
    CREATE TABLE IF NOT EXISTS memory_vectors (
      entry_id TEXT NOT NULL,
      chunk_ix INTEGER NOT NULL,
      model TEXT NOT NULL DEFAULT '',
      dim INTEGER NOT NULL DEFAULT 0,
      hash TEXT NOT NULL DEFAULT '',
      scope TEXT NOT NULL DEFAULT 'project',
      project TEXT NOT NULL DEFAULT '',
      kind TEXT NOT NULL DEFAULT 'facts',
      tier TEXT NOT NULL DEFAULT 'normal',
      status TEXT NOT NULL DEFAULT 'active',
      vector BLOB NOT NULL,
      created_at TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (entry_id, chunk_ix)
    );
  `

/** Index over the cache model column, created together with the table. */
export const VECTOR_TABLE_INDEX_DDL = 'CREATE INDEX IF NOT EXISTS idx_memory_vectors_model ON memory_vectors(model);'

/** Options shared by the vector index backends. */
export interface VectorIndexOptions {
  db: DatabaseSync
  /** Model whose vectors this index serves; rows of other models are ignored. */
  model: string
  dim: number
  debug: (message: string) => void
  /** Storage precision of the derived `vec0` table (sqlite-vec only). */
  quantization?: VectorQuantization
  /** Overrides the resolved sqlite-vec binary path (tests). */
  extensionPath?: string
}

/** Division factor of `vec_quantize_int8(v, 'unit')` distances. */
const INT8_SCALE = 127

/** Maximum ids bound into one `IN (...)` clause before the list is split. */
const ID_CHUNK = 500

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : 0
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Resolve the sqlite-vec binary through its own package helper. */
function resolveExtensionPath(): string | null {
  try {
    const require = createRequire(import.meta.url)
    const module = require('sqlite-vec') as { getLoadablePath?: () => string }
    if (typeof module.getLoadablePath !== 'function') return null
    const path = module.getLoadablePath()
    return typeof path === 'string' && path.length > 0 ? path : null
  } catch {
    return null
  }
}

/** Decode a stored BLOB into a Float32Array without copying when alignment allows. */
function toFloat32(value: unknown): Float32Array {
  if (value instanceof Uint8Array) {
    if (value.byteOffset % 4 === 0) {
      return new Float32Array(value.buffer, value.byteOffset, Math.floor(value.byteLength / 4))
    }
    return new Float32Array(value.slice().buffer)
  }
  if (value instanceof ArrayBuffer) return new Float32Array(value)
  return new Float32Array(0)
}

/** View over a vector that can be bound as a BLOB parameter. */
function toBlob(vector: Float32Array): Uint8Array {
  return new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength)
}

/**
 * Whether a stored vector can still be searched with. An all-zero vector has no
 * direction (every cosine is 0) and a non-finite value poisons every comparison,
 * so both count as damage rather than as data.
 */
function isUsableVector(vector: Float32Array): boolean {
  let norm = 0
  for (const value of vector) {
    if (!Number.isFinite(value)) return false
    norm += value * value
  }
  return norm > 0
}

/** Translate a memory filter into predicates over the vector table's own columns. */
function vectorWhere(filter: MemoryFilter | undefined): { sql: string; params: SqlParam[] } {
  const clauses: string[] = []
  const params: SqlParam[] = []
  if (!filter) return { sql: '', params }
  if (filter.scope && filter.scope !== 'all') {
    clauses.push('scope = ?')
    params.push(filter.scope)
  }
  if (filter.project && filter.project !== 'all') {
    clauses.push('project = ?')
    params.push(filter.project)
  }
  if (filter.kind && filter.kind !== 'all') {
    clauses.push('kind = ?')
    params.push(filter.kind)
  }
  if (filter.tier && filter.tier !== 'all') {
    clauses.push('tier = ?')
    params.push(filter.tier)
  }
  if (filter.status && filter.status !== 'all') {
    clauses.push('status = ?')
    params.push(filter.status)
  }
  return { sql: clauses.join(' AND '), params }
}

/** Split an id list into `IN (...)` sized groups. */
function idGroups(ids: readonly string[] | undefined): Array<readonly string[] | null> {
  if (!ids) return [null]
  const groups: Array<readonly string[]> = []
  for (let start = 0; start < ids.length; start += ID_CHUNK) groups.push(ids.slice(start, start + ID_CHUNK))
  return groups
}

/**
 * Create the index for one backend.
 *
 * @returns the index, or `null` when vectors are disabled. A failing sqlite-vec
 * setup degrades to the in-process index instead of throwing.
 */
export function createVectorIndex(backend: VectorBackend, options: VectorIndexOptions): VectorIndex | null {
  if (backend === 'off') return null
  if (backend === 'sqlite-vec') {
    try {
      return new SqliteVecIndex(options)
    } catch (error) {
      options.debug(`vectors: sqlite-vec unavailable (${errorText(error)}); using the in-process index`)
    }
  }
  return new JsVectorIndex(options)
}

/**
 * Canonical float32 vector cache (`memory_vectors`), shared by the backends.
 *
 * It owns the chunk hashes the embedding queue compares against, so a backend
 * switch never re-embeds anything: the derived table is rebuilt from here.
 */
class VectorCache {
  private readonly db: DatabaseSync
  private readonly model: string
  private readonly dim: number

  constructor(options: VectorIndexOptions) {
    this.db = options.db
    this.model = options.model
    this.dim = options.dim
    this.db.exec(VECTOR_TABLE_DDL)
    this.db.exec(VECTOR_TABLE_INDEX_DDL)
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS count FROM memory_vectors WHERE model = ?').get(this.model)
    return asNumber(row?.['count'])
  }

  upsert(records: readonly VectorRecord[]): void {
    if (records.length === 0) return
    const statement = this.db.prepare(
      `INSERT INTO memory_vectors (
         entry_id, chunk_ix, model, dim, hash, scope, project, kind, tier, status, vector, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(entry_id, chunk_ix) DO UPDATE SET
         model = excluded.model,
         dim = excluded.dim,
         hash = excluded.hash,
         scope = excluded.scope,
         project = excluded.project,
         kind = excluded.kind,
         tier = excluded.tier,
         status = excluded.status,
         vector = excluded.vector,
         created_at = excluded.created_at`,
    )
    const now = new Date().toISOString()
    this.db.exec('BEGIN')
    try {
      for (const record of records) {
        if (record.vector.length !== this.dim) {
          throw new Error(`vectors: ${record.entryId} carries ${record.vector.length} dimensions, expected ${this.dim}`)
        }
        statement.run(
          record.entryId,
          record.chunkIndex,
          this.model,
          this.dim,
          record.hash,
          record.scope,
          record.project,
          record.kind,
          record.tier,
          record.status,
          toBlob(record.vector),
          now,
        )
      }
      this.db.exec('COMMIT')
    } catch (error) {
      try {
        this.db.exec('ROLLBACK')
      } catch {
        /* ignore rollback failure */
      }
      throw error
    }
  }

  remove(entryId: string): void {
    this.db.prepare('DELETE FROM memory_vectors WHERE entry_id = ?').run(entryId)
  }

  clear(model?: string): void {
    if (model === undefined) {
      this.db.prepare('DELETE FROM memory_vectors').run()
      return
    }
    this.db.prepare('DELETE FROM memory_vectors WHERE model <> ?').run(model)
  }

  storedHashes(entryId: string): Map<number, string> {
    const rows = this.db
      .prepare('SELECT chunk_ix, hash FROM memory_vectors WHERE entry_id = ? AND model = ?')
      .all(entryId, this.model) as Array<Record<string, unknown>>
    const hashes = new Map<number, string>()
    for (const row of rows) hashes.set(asNumber(row['chunk_ix']), asString(row['hash']))
    return hashes
  }

  /** Mean of the chunk vectors per entry, normalized. */
  entryVectors(filter?: MemoryFilter): Map<string, Float32Array> {
    const where = vectorWhere(filter)
    const params: SqlParam[] = [this.model, ...where.params]
    let sql = 'SELECT entry_id, vector FROM memory_vectors WHERE model = ?'
    if (where.sql.length > 0) sql += ` AND ${where.sql}`
    const rows = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>
    const sums = new Map<string, { sum: Float32Array; count: number }>()
    for (const row of rows) {
      const vector = toFloat32(row['vector'])
      if (vector.length !== this.dim) continue
      const entryId = asString(row['entry_id'])
      let slot = sums.get(entryId)
      if (!slot) {
        slot = { sum: new Float32Array(this.dim), count: 0 }
        sums.set(entryId, slot)
      }
      for (let index = 0; index < this.dim; index++) {
        slot.sum[index] = (slot.sum[index] ?? 0) + vector[index]!
      }
      slot.count++
    }
    const vectors = new Map<string, Float32Array>()
    for (const [entryId, slot] of sums) {
      let norm = 0
      for (const value of slot.sum) norm += value * value
      norm = Math.sqrt(norm) || 1
      vectors.set(entryId, Float32Array.from(slot.sum, (value) => value / norm))
    }
    return vectors
  }

  /** Number of stored chunks per entry, optionally restricted by metadata. */
  chunkCounts(filter?: MemoryFilter): Map<string, number> {
    const where = vectorWhere(filter)
    const params: SqlParam[] = [this.model, ...where.params]
    let sql = 'SELECT entry_id, COUNT(*) AS chunks FROM memory_vectors WHERE model = ?'
    if (where.sql.length > 0) sql += ` AND ${where.sql}`
    sql += ' GROUP BY entry_id'
    const rows = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>
    const counts = new Map<string, number>()
    for (const row of rows) counts.set(asString(row['entry_id']), asNumber(row['chunks']))
    return counts
  }

  stats(backend: VectorBackend): VectorIndexStats {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS chunks, COUNT(DISTINCT entry_id) AS entries, COALESCE(SUM(LENGTH(vector)), 0) AS bytes
         FROM memory_vectors WHERE model = ?`,
      )
      .get(this.model)
    return {
      backend,
      chunks: asNumber(row?.['chunks']),
      entries: asNumber(row?.['entries']),
      model: this.model,
      dim: this.dim,
      bytes: asNumber(row?.['bytes']),
    }
  }

  /** Every cached chunk, optionally restricted to some entries. */
  records(entryIds?: readonly string[]): VectorRecord[] {
    const records: VectorRecord[] = []
    for (const group of idGroups(entryIds)) {
      const params: SqlParam[] = [this.model]
      let sql =
        'SELECT entry_id, chunk_ix, hash, scope, project, kind, tier, status, vector FROM memory_vectors WHERE model = ?'
      if (group) {
        sql += ` AND entry_id IN (${group.map(() => '?').join(', ')})`
        params.push(...group)
      }
      const rows = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>
      for (const row of rows) {
        records.push({
          entryId: asString(row['entry_id']),
          chunkIndex: asNumber(row['chunk_ix']),
          scope: asString(row['scope']) as VectorRecord['scope'],
          project: asString(row['project']),
          kind: asString(row['kind']) as VectorRecord['kind'],
          tier: asString(row['tier']) as VectorRecord['tier'],
          status: asString(row['status']) as VectorRecord['status'],
          hash: asString(row['hash']),
          vector: toFloat32(row['vector']),
        })
      }
    }
    return records
  }

  /**
   * One pass over the whole table: per-entry chunk positions, the metadata copy
   * and the health counters. Rows of a foreign model are reported but not judged
   * against this index's dimension — they belong to another embedding space.
   */
  audit(): VectorAudit {
    const rows = this.db
      .prepare(
        'SELECT entry_id, chunk_ix, model, scope, project, kind, tier, status, vector FROM memory_vectors',
      )
      .all() as Array<Record<string, unknown>>
    const entries = new Map<string, VectorAuditEntry>()
    const models = new Set<string>()
    for (const row of rows) {
      const model = asString(row['model'])
      const entryId = asString(row['entry_id'])
      models.add(model)
      let slot = entries.get(entryId)
      if (!slot) {
        slot = {
          model,
          chunks: 0,
          chunkIndexes: [],
          scope: asString(row['scope']) as MemoryScope,
          project: asString(row['project']),
          kind: asString(row['kind']) as MemoryKind,
          tier: asString(row['tier']) as MemoryTier,
          status: asString(row['status']) as MemoryStatus,
          badDim: 0,
          broken: 0,
        }
        entries.set(entryId, slot)
      }
      slot.chunks++
      slot.chunkIndexes.push(asNumber(row['chunk_ix']))
      if (model !== this.model) continue
      const vector = toFloat32(row['vector'])
      if (vector.length !== this.dim) slot.badDim++
      else if (!isUsableVector(vector)) slot.broken++
    }
    return { entries, models: [...models], model: this.model, dim: this.dim }
  }

  /** In-process cosine scan over the cached rows. */
  scan(query: VectorQuery): VectorMatch[] {
    const matches: VectorMatch[] = []
    for (const group of idGroups(query.entryIds)) {
      const where = vectorWhere(query.filter)
      const params: SqlParam[] = [this.model, ...where.params]
      let sql = 'SELECT entry_id, chunk_ix, vector FROM memory_vectors WHERE model = ?'
      if (where.sql.length > 0) sql += ` AND ${where.sql}`
      if (group) {
        sql += ` AND entry_id IN (${group.map(() => '?').join(', ')})`
        params.push(...group)
      }
      const rows = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>
      for (const row of rows) {
        const vector = toFloat32(row['vector'])
        if (vector.length !== query.vector.length) continue
        let score = 0
        for (let i = 0; i < vector.length; i++) score += vector[i]! * query.vector[i]!
        if (query.minScore !== undefined && score < query.minScore) continue
        matches.push({ entryId: asString(row['entry_id']), chunkIndex: asNumber(row['chunk_ix']), score })
      }
    }
    matches.sort((a, b) => b.score - a.score)
    return matches.slice(0, Math.max(1, Math.floor(query.limit)))
  }
}

/** Backend that scans the canonical cache in process. */
export class JsVectorIndex implements VectorIndex {
  readonly backend: VectorBackend = 'js'
  private readonly cache: VectorCache

  constructor(options: VectorIndexOptions) {
    this.cache = new VectorCache(options)
  }

  size(): number {
    return this.cache.count()
  }

  upsert(records: readonly VectorRecord[]): void {
    this.cache.upsert(records)
  }

  remove(entryId: string): void {
    this.cache.remove(entryId)
  }

  clear(model?: string): void {
    this.cache.clear(model)
  }

  storedHashes(entryId: string): Map<number, string> {
    return this.cache.storedHashes(entryId)
  }

  entryVectors(filter?: MemoryFilter): Map<string, Float32Array> {
    return this.cache.entryVectors(filter)
  }

  chunkCounts(filter?: MemoryFilter): Map<string, number> {
    return this.cache.chunkCounts(filter)
  }

  records(entryIds?: readonly string[]): VectorRecord[] {
    return this.cache.records(entryIds)
  }

  audit(): VectorAudit {
    return this.cache.audit()
  }

  /** Nothing to rebuild: the in-process scan reads `memory_vectors` directly. */
  rebuildAnn(): void {
    // Intentionally empty — see the interface documentation.
  }

  search(query: VectorQuery): VectorMatch[] {
    if (query.entryIds && query.entryIds.length === 0) return []
    return this.cache.scan(query)
  }

  stats(): VectorIndexStats {
    return this.cache.stats(this.backend)
  }
}

/**
 * Backend that mirrors the cache into a `vec0` table and runs KNN in SQL.
 *
 * The derived table carries the storage precision: `float` keeps the vectors as
 * written, `int8` and `bit` quantize them on insert (and quantize the query the
 * same way). Scores are converted back to a 0..1 similarity so rank fusion and
 * `minScore` behave like the in-process backend; for `bit` the value is a
 * Hamming-derived proxy, not a cosine.
 */
export class SqliteVecIndex implements VectorIndex {
  readonly backend: VectorBackend = 'sqlite-vec'
  readonly quantization: VectorQuantization
  readonly version: string
  private readonly db: DatabaseSync
  private readonly cache: VectorCache
  private readonly model: string
  private readonly dim: number
  private readonly debug: (message: string) => void

  constructor(options: VectorIndexOptions) {
    const path = options.extensionPath ?? resolveExtensionPath()
    if (!path) throw new Error('the sqlite-vec package is not installed (optional dependency)')
    this.db = options.db
    this.model = options.model
    this.dim = options.dim
    this.debug = options.debug
    // Binary quantization needs a dimension divisible by 8; int8 always works.
    const requested = options.quantization ?? 'float'
    this.quantization = requested === 'bit' && this.dim % 8 !== 0 ? 'int8' : requested
    if (this.quantization !== requested) {
      this.debug(`vectors: bit quantization needs a dimension divisible by 8, using ${this.quantization}`)
    }
    try {
      this.db.loadExtension(path)
    } catch (error) {
      // node:sqlite refuses to load extensions on a connection created without
      // `allowExtension`, and that cannot be changed afterwards.
      throw new Error(`the extension cannot be loaded (${errorText(error)})`)
    }
    const row = this.db.prepare('SELECT vec_version() AS version').get()
    this.version = asString(row?.['version'])
    this.cache = new VectorCache(options)
    this.ensureTable()
  }

  /** Column type of the `vec0` table for the configured precision. */
  private columnType(): string {
    if (this.quantization === 'bit') return `bit[${this.dim}]`
    if (this.quantization === 'int8') return `int8[${this.dim}]`
    return `float[${this.dim}]`
  }

  /** Wrap a vector placeholder so it matches the table's precision. */
  private quantize(placeholder: string): string {
    if (this.quantization === 'bit') return `vec_quantize_binary(${placeholder})`
    if (this.quantization === 'int8') return `vec_quantize_int8(${placeholder}, 'unit')`
    return placeholder
  }

  /**
   * Make sure the derived table matches the model, the dimension and the
   * precision, rebuilding it from the cache when any of them changed.
   */
  private ensureTable(): void {
    this.db.exec(`CREATE TABLE IF NOT EXISTS memory_vec_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '');`)
    const marker = `${this.model}|${this.dim}|${this.quantization}`
    const row = this.db.prepare("SELECT value FROM memory_vec_meta WHERE key = 'schema'").get()
    if (asString(row?.['value']) === marker) return
    this.db.exec('DROP TABLE IF EXISTS memory_vec;')
    this.db.exec(`
      CREATE VIRTUAL TABLE memory_vec USING vec0(
        chunk_key text primary key,
        project text partition key,
        scope text, kind text, tier text, status text, model text, entry_id text,
        embedding ${this.columnType()}
      );
    `)
    this.db.prepare("INSERT OR REPLACE INTO memory_vec_meta (key, value) VALUES ('schema', ?)").run(marker)
    const cached = this.cache.records()
    if (cached.length > 0) this.write(cached)
    this.debug(
      `vectors: sqlite-vec ${this.version}, table memory_vec ${this.quantization}[${this.dim}] ` +
        `(${cached.length} cached chunks)`,
    )
  }

  /** Write records into the derived table (no cache write). */
  private write(records: readonly VectorRecord[]): void {
    if (records.length === 0) return
    const statement = this.db.prepare(
      `INSERT OR REPLACE INTO memory_vec (
         chunk_key, project, scope, kind, tier, status, model, entry_id, embedding
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${this.quantize('?')})`,
    )
    this.db.exec('BEGIN')
    try {
      for (const record of records) {
        statement.run(
          `${record.entryId}#${record.chunkIndex}`,
          record.project,
          record.scope,
          record.kind,
          record.tier,
          record.status,
          this.model,
          record.entryId,
          toBlob(record.vector),
        )
      }
      this.db.exec('COMMIT')
    } catch (error) {
      try {
        this.db.exec('ROLLBACK')
      } catch {
        /* ignore rollback failure */
      }
      throw error
    }
  }

  /** Convert a vec0 distance into a 0..1 similarity. */
  private scoreOf(distance: number): number {
    if (this.quantization === 'bit') return 1 - distance / this.dim
    const scaled = this.quantization === 'int8' ? distance / INT8_SCALE : distance
    return 1 - (scaled * scaled) / 2
  }

  /** Chunk index encoded in the `chunk_key` primary key. */
  private chunkIndexOf(chunkKey: string): number {
    const separator = chunkKey.lastIndexOf('#')
    return separator >= 0 ? asNumber(chunkKey.slice(separator + 1)) : 0
  }

  size(): number {
    return this.cache.count()
  }

  upsert(records: readonly VectorRecord[]): void {
    if (records.length === 0) return
    // The cache is canonical: it is written first, so a failure while mirroring
    // into vec0 still leaves the chunk hashes and the vectors recoverable.
    this.cache.upsert(records)
    this.write(records)
  }

  remove(entryId: string): void {
    this.cache.remove(entryId)
    this.db.prepare('DELETE FROM memory_vec WHERE entry_id = ?').run(entryId)
  }

  clear(model?: string): void {
    this.cache.clear(model)
    // Our own rows survive only when `model` names the current model; otherwise
    // the derived table has to be rebuilt from what is left in the cache.
    if (model !== undefined && model === this.model) return
    this.db.exec('DROP TABLE IF EXISTS memory_vec;')
    this.db.prepare("DELETE FROM memory_vec_meta WHERE key = 'schema'").run()
    this.ensureTable()
  }

  storedHashes(entryId: string): Map<number, string> {
    return this.cache.storedHashes(entryId)
  }

  entryVectors(filter?: MemoryFilter): Map<string, Float32Array> {
    return this.cache.entryVectors(filter)
  }

  chunkCounts(filter?: MemoryFilter): Map<string, number> {
    return this.cache.chunkCounts(filter)
  }

  records(entryIds?: readonly string[]): VectorRecord[] {
    return this.cache.records(entryIds)
  }

  audit(): VectorAudit {
    return this.cache.audit()
  }

  /** Drop the derived table and build it again from the stored vectors. */
  rebuildAnn(): void {
    try {
      this.db.exec('DROP TABLE IF EXISTS memory_vec;')
      this.db.exec('DELETE FROM memory_vec_meta;')
    } catch (error) {
      this.debug(`vectors: sqlite-vec rebuild could not clear the derived table: ${String(error)}`)
    }
    this.ensureTable()
  }

  search(query: VectorQuery): VectorMatch[] {
    const limit = Math.max(1, Math.floor(query.limit))
    if (query.entryIds && query.entryIds.length === 0) return []
    const where = vectorWhere(query.filter)
    const matches = new Map<string, VectorMatch>()
    for (const group of idGroups(query.entryIds)) {
      let sql =
        `SELECT entry_id, chunk_key, distance FROM memory_vec ` +
        `WHERE embedding MATCH ${this.quantize('?')} AND k = ?`
      const params: Array<SqlParam | Uint8Array> = [toBlob(query.vector), limit]
      if (where.sql.length > 0) sql += ` AND ${where.sql}`
      params.push(...where.params)
      if (group) {
        sql += ` AND entry_id IN (${group.map(() => '?').join(', ')})`
        params.push(...group)
      }
      const rows = this.db.prepare(sql).all(...params) as Array<Record<string, unknown>>
      for (const row of rows) {
        const score = this.scoreOf(asNumber(row['distance']))
        if (query.minScore !== undefined && score < query.minScore) continue
        const entryId = asString(row['entry_id'])
        const chunkIndex = this.chunkIndexOf(asString(row['chunk_key']))
        const key = `${entryId}#${chunkIndex}`
        const previous = matches.get(key)
        if (!previous || previous.score < score) matches.set(key, { entryId, chunkIndex, score })
      }
    }
    const scored = [...matches.values()]
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, limit)
  }

  stats(): VectorIndexStats {
    return this.cache.stats(this.backend)
  }
}
