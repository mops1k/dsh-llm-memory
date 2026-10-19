/**
 * Schema v2 for an existing `memories` table (Kilo parity, ADR-002/005).
 *
 * The migration is additive and idempotent: it only adds missing columns and
 * indexes, never rewrites rows, so a live store keeps its ids, timestamps and
 * Kilo fields. Sync columns are reserved here without any behaviour (ADR-006).
 */
import type { SqliteDatabase } from '../port/sqlite.js'

export const CORE_SCHEMA_VERSION = 2

export interface ColumnSpec {
  name: string
  /** SQL type + constraints, e.g. `TEXT NOT NULL DEFAULT ''`. */
  ddl: string
}

/** Columns the canonical model needs on top of the Kilo `memories` table. */
export const SCHEMA_V2_COLUMNS: readonly ColumnSpec[] = [
  { name: 'project', ddl: "TEXT NOT NULL DEFAULT ''" },
  { name: 'ext_key', ddl: 'TEXT' },
  { name: 'origin', ddl: "TEXT NOT NULL DEFAULT 'kilo'" },
  { name: 'path', ddl: "TEXT NOT NULL DEFAULT ''" },
  { name: 'content_hash', ddl: 'TEXT' },
  { name: 'file_size', ddl: 'INTEGER' },
  { name: 'file_mtime_ms', ddl: 'INTEGER' },
  // Reserved for future team sync; written only by that layer (ADR-006).
  { name: 'namespace', ddl: "TEXT NOT NULL DEFAULT 'local'" },
  { name: 'revision', ddl: 'INTEGER NOT NULL DEFAULT 0' },
  { name: 'device_id', ddl: "TEXT NOT NULL DEFAULT ''" },
  { name: 'updated_by', ddl: "TEXT NOT NULL DEFAULT ''" },
  { name: 'deleted_at', ddl: 'TEXT' },
  { name: 'sync_state', ddl: "TEXT NOT NULL DEFAULT 'local'" },
]

export const SCHEMA_V2_INDEXES: readonly string[] = [
  'CREATE INDEX IF NOT EXISTS idx_memories_scope_project_key ON memories(scope, project)',
  'CREATE INDEX IF NOT EXISTS idx_memories_path ON memories(path)',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_ext_key ON memories(ext_key) WHERE ext_key IS NOT NULL',
]

export interface MigrationReport {
  table: string
  addedColumns: string[]
  createdIndexes: string[]
  schemaVersion: number
}

function existingColumns(db: SqliteDatabase, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>()
  return new Set(rows.map(row => row.name))
}

function existingIndexes(db: SqliteDatabase, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA index_list(${table})`).all<{ name: string }>()
  return new Set(rows.map(row => row.name))
}

/**
 * Additive, idempotent upgrade of `memories` to schema v2. A second call is a
 * no-op; returns exactly what changed.
 */
export function ensureSchemaV2(db: SqliteDatabase, table = 'memories'): MigrationReport {
  const columns = existingColumns(db, table)
  const addedColumns: string[] = []
  db.exec('BEGIN IMMEDIATE')
  try {
    for (const column of SCHEMA_V2_COLUMNS) {
      if (columns.has(column.name)) continue
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column.name} ${column.ddl}`)
      addedColumns.push(column.name)
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }

  const indexes = existingIndexes(db, table)
  const createdIndexes: string[] = []
  for (const ddl of SCHEMA_V2_INDEXES) {
    const name = /INDEX IF NOT EXISTS (\w+)/.exec(ddl)?.[1]
    if (!name || indexes.has(name)) continue
    db.exec(ddl)
    createdIndexes.push(name)
  }

  return { table, addedColumns, createdIndexes, schemaVersion: CORE_SCHEMA_VERSION }
}
