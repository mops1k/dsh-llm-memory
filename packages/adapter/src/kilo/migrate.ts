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

/** Columns from SCHEMA_V2 that the given table still lacks. */
function missing(db: SqliteDatabase): string[] {
  const present = new Set(columns(db))
  return ['project', 'ext_key', 'origin', 'path', 'content_hash', 'file_size', 'file_mtime_ms', 'namespace', 'revision', 'device_id', 'updated_by', 'deleted_at', 'sync_state'].filter(
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
    const migration = ensureSchemaV2(db)
    ensureRevisionsTable(db)
    report.addedColumns = migration.addedColumns
    report.createdIndexes = migration.createdIndexes
    report.after = counts(db)
    report.integrityCheck = db.prepare('PRAGMA integrity_check').get<{ integrity_check: string }>()?.integrity_check ?? 'unknown'
  } finally {
    db.close()
  }
  return report
}
