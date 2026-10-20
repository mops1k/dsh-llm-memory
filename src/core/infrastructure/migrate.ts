/**
 * Generic store migration to schema v2: additive columns, revisions table,
 * integrity check. Callers own the pre-migration backup (ADR-005).
 */
import { existsSync } from 'node:fs'

import { openDatabase } from './sqlite/index.js'
import { ensureSchemaV2, CORE_SCHEMA_VERSION } from './schema.js'
import { ensureRevisionsTable } from '../sync/index.js'

export interface MigrateSchemaOptions {
  dbPath: string
  apply?: boolean
}

export interface MigrateSchemaReport {
  dbPath: string
  apply: boolean
  schemaVersion: number
  addedColumns: string[]
  createdIndexes: string[]
  before: { entries: number; active: number }
  after: { entries: number; active: number }
  integrityCheck: string
  missingRevisionsTable: boolean
}

function counts(dbPath: string): { entries: number; active: number } {
  const db = openDatabase(dbPath)
  try {
    const row = db.prepare("SELECT COUNT(*) AS entries, SUM(status = 'active') AS active FROM memories").get<{ entries: number; active: number }>()
    return { entries: row?.entries ?? 0, active: row?.active ?? 0 }
  } finally {
    db.close()
  }
}

export function migrateSchemaToV2(options: MigrateSchemaOptions): MigrateSchemaReport {
  if (!existsSync(options.dbPath)) throw new Error(`database not found: ${options.dbPath}`)
  const apply = options.apply === true
  const before = counts(options.dbPath)
  const probe = openDatabase(options.dbPath)
  let missingRevisionsTable = false
  try {
    missingRevisionsTable = !probe.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='memory_revisions'").get()
  } finally {
    probe.close()
  }
  if (!apply) {
    return {
      dbPath: options.dbPath,
      apply,
      schemaVersion: CORE_SCHEMA_VERSION,
      addedColumns: [],
      createdIndexes: [],
      before,
      after: before,
      integrityCheck: 'not checked',
      missingRevisionsTable,
    }
  }
  const db = openDatabase(options.dbPath)
  try {
    const migration = ensureSchemaV2(db)
    ensureRevisionsTable(db)
    return {
      dbPath: options.dbPath,
      apply,
      schemaVersion: CORE_SCHEMA_VERSION,
      addedColumns: migration.addedColumns,
      createdIndexes: migration.createdIndexes,
      before,
      after: counts(options.dbPath),
      integrityCheck: db.prepare('PRAGMA integrity_check').get<{ integrity_check: string }>()?.integrity_check ?? 'unknown',
      missingRevisionsTable,
    }
  } finally {
    db.close()
  }
}
