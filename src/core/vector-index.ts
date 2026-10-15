/**
 * Vector index backends.
 *
 * One implementation for now: {@link JsVectorIndex} keeps chunk vectors in the
 * `memory_vectors` table (created by the store) and scans them in process. The
 * scan is cheap at this scale — measured 1.47 ms for 1050 vectors × 384
 * dimensions — and it needs no native extension. Phase 2 adds a `sqlite-vec`
 * backend behind the same {@link VectorIndex} interface; until then a request
 * for it falls back to this one with a debug note.
 *
 * Vectors are stored normalized, so a dot product is the cosine similarity.
 *
 * @module dsh-llm-memory/core/vector-index
 */
import type { DatabaseSync } from 'node:sqlite'

import type {
  MemoryFilter,
  VectorBackend,
  VectorIndex,
  VectorIndexStats,
  VectorMatch,
  VectorQuery,
  VectorRecord,
} from './types.js'

/** Values accepted by prepared statement parameters in this module. */
type SqlParam = string | number | null

/** Options shared by the vector index backends. */
export interface VectorIndexOptions {
  db: DatabaseSync
  /** Model whose vectors this index serves; rows of other models are ignored. */
  model: string
  dim: number
  debug: (message: string) => void
}

/**
 * Create the index for one backend.
 *
 * @returns the index, or `null` when vectors are disabled.
 */
export function createVectorIndex(backend: VectorBackend, options: VectorIndexOptions): VectorIndex | null {
  if (backend === 'off') return null
  if (backend === 'sqlite-vec') {
    options.debug('vectors: the sqlite-vec backend is not implemented yet; using the in-process index')
  }
  return new JsVectorIndex(options)
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asNumber(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : 0
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

/** Maximum ids bound into one `IN (...)` clause before the list is split. */
const ID_CHUNK = 500

class JsVectorIndex implements VectorIndex {
  readonly backend: VectorBackend = 'js'
  private readonly db: DatabaseSync
  private readonly model: string
  private readonly dim: number
  private readonly debug: (message: string) => void

  constructor(options: VectorIndexOptions) {
    this.db = options.db
    this.model = options.model
    this.dim = options.dim
    this.debug = options.debug
  }

  size(): number {
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

  search(query: VectorQuery): VectorMatch[] {
    const limit = Math.max(1, Math.floor(query.limit))
    const ids = query.entryIds
    if (ids && ids.length === 0) return []
    const groups: Array<readonly string[] | null> = []
    if (!ids) groups.push(null)
    else for (let start = 0; start < ids.length; start += ID_CHUNK) groups.push(ids.slice(start, start + ID_CHUNK))

    const where = vectorWhere(query.filter)
    const matches = new Map<string, VectorMatch>()
    for (const group of groups) {
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
        const entryId = asString(row['entry_id'])
        const chunkIndex = asNumber(row['chunk_ix'])
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
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS chunks, COUNT(DISTINCT entry_id) AS entries, COALESCE(SUM(LENGTH(vector)), 0) AS bytes
         FROM memory_vectors WHERE model = ?`,
      )
      .get(this.model)
    return {
      backend: this.backend,
      chunks: asNumber(row?.['chunks']),
      entries: asNumber(row?.['entries']),
      model: this.model,
      dim: this.dim,
      bytes: asNumber(row?.['bytes']),
    }
  }

  /** Chunk hashes stored for one entry, used to skip unchanged chunks. */
  storedHashes(entryId: string): Map<number, string> {
    const rows = this.db
      .prepare('SELECT chunk_ix, hash FROM memory_vectors WHERE entry_id = ? AND model = ?')
      .all(entryId, this.model) as Array<Record<string, unknown>>
    const hashes = new Map<number, string>()
    for (const row of rows) hashes.set(asNumber(row['chunk_ix']), asString(row['hash']))
    return hashes
  }
}

export { JsVectorIndex }
