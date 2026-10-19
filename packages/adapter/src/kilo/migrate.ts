/**
 * Kilo store migration to core schema v2. Dry-run by default; an apply pass
 * copies the database first and never rewrites rows (ADR-002/005).
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { ensureSchemaV2, CORE_SCHEMA_VERSION } from '@llm-memory/core/infrastructure/schema'
import { ensureRevisionsTable } from '@llm-memory/core/sync/index'
import { openDatabase } from '@llm-memory/core/infrastructure/sqlite/index'
import type { SqliteDatabase } from '@llm-memory/core/port/sqlite'

export interface MigrateOptions {
  dbPath: string
  /** false (default) only reports what an apply would change. */
  apply?: boolean
  /** Directory for the pre-migration copy; required for apply. */
  backupDir?: string
  now?: () => Date
}

export interface MigrateReport {
  dbPath: string
  apply: boolean
  schemaVersion: number
  addedColumns: string[]
  createdIndexes: string[]
  wouldAddColumns: string[]
  before: { entries: number; active: number }
  after: { entries: number; active: number }
  integrityCheck: string
  backupPath: string | null
}

function counts(db: SqliteDatabase): { entries: number; active: number } {
  const row = db.prepare("SELECT COUNT(*) AS entries, SUM(status = 'active') AS active FROM memories").get<{ entries: number; active: number }>()
  return { entries: row?.entries ?? 0, active: row?.active ?? 0 }
}

function columns(db: SqliteDatabase): string[] {
  return db.prepare('PRAGMA table_info(memories)').all<{ name: string }>().map(row => row.name)
}

/** Core base columns absent in a Kilo-created table (Kilo uses content/updatedAt/…). */
const BASE_COLUMNS: Array<{ name: string; ddl: string }> = [
  { name: 'text', ddl: "text TEXT NOT NULL DEFAULT ''" },
  { name: 'project', ddl: "project TEXT NOT NULL DEFAULT ''" },
  { name: 'created_at', ddl: "created_at TEXT NOT NULL DEFAULT ''" },
  { name: 'updated_at', ddl: "updated_at TEXT NOT NULL DEFAULT ''" },
  { name: 'superseded_by', ddl: "superseded_by TEXT NOT NULL DEFAULT '[]'" },
]

function translateBaseColumns(db: SqliteDatabase): string[] {
  const present = new Set(columns(db))
  const added: string[] = []
  for (const column of BASE_COLUMNS) {
    if (present.has(column.name)) continue
    db.exec(`ALTER TABLE memories ADD COLUMN ${column.ddl}`)
    added.push(column.name)
  }
  // Backfill from the Kilo names so the core store can read the same rows.
  db.exec("UPDATE memories SET text = content WHERE text = '' AND content <> ''")
  db.exec("UPDATE memories SET created_at = createdAt WHERE created_at = '' AND createdAt <> ''")
  db.exec("UPDATE memories SET updated_at = updatedAt WHERE updated_at = '' AND updatedAt <> ''")
  db.exec("UPDATE memories SET superseded_by = supersededBy WHERE superseded_by = '[]' AND supersededBy <> '[]'")
  db.exec("UPDATE memories SET project = project_root WHERE project = '' AND project_root <> ''")
  return added
}

/** Columns from SCHEMA_V2 that the given table still lacks. */
function missing(db: SqliteDatabase): string[] {
  const present = new Set(columns(db))
  return [...BASE_COLUMNS.map(column => column.name), 'ext_key', 'origin', 'path', 'content_hash', 'file_size', 'file_mtime_ms', 'namespace', 'revision', 'device_id', 'updated_by', 'deleted_at', 'sync_state'].filter(
    name => !present.has(name),
  )
}

function backup(dbPath: string, backupDir: string, stamp: string): string {
  mkdirSync(backupDir, { recursive: true })
  const target = join(backupDir, `memory-${stamp}.db`)
  copyFileSync(dbPath, target)
  for (const suffix of ['-wal', '-shm']) {
    const side = dbPath + suffix
    if (existsSync(side)) copyFileSync(side, target + suffix)
  }
  return target
}

export function migrateKiloStore(options: MigrateOptions): MigrateReport {
  if (!existsSync(options.dbPath)) throw new Error(`database not found: ${options.dbPath}`)
  const apply = options.apply === true
  const report: MigrateReport = {
    dbPath: options.dbPath,
    apply,
    schemaVersion: CORE_SCHEMA_VERSION,
    addedColumns: [],
    createdIndexes: [],
    wouldAddColumns: [],
    before: { entries: 0, active: 0 },
    after: { entries: 0, active: 0 },
    integrityCheck: 'not checked',
    backupPath: null,
  }

  const db = openDatabase(options.dbPath)
  try {
    report.before = counts(db)
    report.wouldAddColumns = missing(db)
    if (!apply) {
      return report
    }
    const stamp = (options.now?.() ?? new Date()).toISOString().replace(/[:.]/g, '-')
    report.backupPath = options.backupDir ? backup(options.dbPath, options.backupDir, stamp) : null
    // Kilo's FTS table stores content as its own column and is incompatible with
    // the core schema: drop it so core-store recreates and rebuilds the index.
    const ftsColumns = (() => {
      try {
        return db.prepare('PRAGMA table_info(memories_fts)').all<{ name: string }>().map(row => row.name)
      } catch {
        return []
      }
    })()
    if (ftsColumns.length > 0 && !ftsColumns.includes('text')) db.exec('DROP TABLE memories_fts;')
    const baseAdded = translateBaseColumns(db)
    const migration = ensureSchemaV2(db)
    ensureRevisionsTable(db)
    report.addedColumns = [...baseAdded, ...migration.addedColumns]
    report.createdIndexes = migration.createdIndexes
    report.after = counts(db)
    report.integrityCheck = db.prepare('PRAGMA integrity_check').get<{ integrity_check: string }>()?.integrity_check ?? 'unknown'
  } finally {
    db.close()
  }
  return report
}
