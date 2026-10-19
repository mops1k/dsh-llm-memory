/**
 * Importer for the dsh-mnemon plugin store.
 *
 * dsh-mnemon keeps its SQLite database at `<root>/data/<profile>/mnemon.db`.
 * Memories themselves live in the `insights` table (`content`, `category`,
 * `importance`, `tags`, `entities`, timestamps); `edges` and `oplog` are the
 * graph and journal. The database is opened read-only and an empty (or missing)
 * store yields an empty report instead of an error.
 */
import { existsSync } from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'

import { projectKeyFromCwd } from '../paths.js'
import { genMemoryId } from '../store.js'
import type { MemoryEntry } from '../types.js'
import {
  addImportedProject,
  asNumber,
  asString,
  firstLine,
  mergeImportedProjects,
  openReadOnlyDatabase,
  pickColumn,
  tableColumns,
  toIsoString,
  toImportance,
  toMemoryKind,
  toStringList,
  type ImportedProject,
  type ReadOnlyDatabase,
} from './common.js'
import { listMnemonDbPaths } from './paths.js'

export interface MnemonImportResult {
  entries: MemoryEntry[]
  rootsFound: string[]
  errors: string[]
  /** Projects derived from an optional workspace path column. */
  projects: ImportedProject[]
}

const MEMORY_TABLES = ['insights', 'memories'] as const

/** Optional columns that may carry the owning workspace directory. */
const WORKSPACE_COLUMNS = ['workspace_path', 'workspace', 'project_root', 'project_path', 'cwd'] as const

function rowToEntry(
  row: Record<string, unknown>,
  columns: ReadonlySet<string>,
): { entry: MemoryEntry; projectRoot: string | null } | null {
  const id = asString(pickColumn(row, columns, ['id'])).trim()
  const rowid = asNumber(pickColumn(row, columns, ['_rowid', 'rowid']))
  const extId = id.length > 0 ? id : rowid !== undefined ? String(rowid) : ''
  if (extId.length === 0) return null

  const workspace = asString(pickColumn(row, columns, [...WORKSPACE_COLUMNS])).trim()
  const content = asString(pickColumn(row, columns, ['content', 'text', 'body']))
  const deletedAt = asString(pickColumn(row, columns, ['deleted_at'])).trim()
  const now = new Date().toISOString()
  const createdAt = toIsoString(
    pickColumn(row, columns, ['created_at', 'stored_at', 'createdAt']),
    now,
  )
  const updatedAt = toIsoString(
    pickColumn(row, columns, ['updated_at', 'created_at', 'stored_at', 'updatedAt']),
    createdAt,
  )
  const importance = asNumber(pickColumn(row, columns, ['importance']))
  const effectiveImportance = asNumber(pickColumn(row, columns, ['effective_importance']))

  return {
    projectRoot: workspace.length > 0 ? workspace : null,
    entry: {
      id: genMemoryId(),
      scope: 'user',
      project: '',
      kind: toMemoryKind(pickColumn(row, columns, ['category', 'kind'])),
      tier: 'normal',
      status: deletedAt.length > 0 ? 'archived' : 'active',
      title: firstLine(content),
      text: content,
      tags: toStringList(pickColumn(row, columns, ['tags'])),
      keywords: toStringList(pickColumn(row, columns, ['entities'])).join(' '),
      importance: toImportance(importance ?? effectiveImportance),
      supersedes: [],
      supersededBy: [],
      related: [],
      source: 'mnemon',
      extKey: `mnemon:${extId}`,
      createdAt,
      updatedAt,
    },
  }
}

function selectRows(db: DatabaseSync, table: string): Array<Record<string, unknown>> {
  try {
    return db.prepare(`SELECT rowid AS _rowid, * FROM ${table}`).all() as Array<Record<string, unknown>>
  } catch {
    return db.prepare(`SELECT * FROM ${table}`).all() as Array<Record<string, unknown>>
  }
}

/** Import a single mnemon database file. */
export function importMnemonDb(dbPath: string): MnemonImportResult {
  const result: MnemonImportResult = { entries: [], rootsFound: [], errors: [], projects: [] }
  const projects = new Map<string, ImportedProject>()
  let opened: ReadOnlyDatabase | null = null
  try {
    opened = openReadOnlyDatabase(dbPath)
    const db = opened.db
    const table = MEMORY_TABLES.find((candidate) => tableColumns(db, candidate).size > 0)
    if (!table) {
      result.errors.push(`mnemon: no insights table in ${dbPath}`)
      return result
    }
    result.rootsFound.push(dbPath)
    const columns = tableColumns(db, table)
    for (const row of selectRows(db, table)) {
      try {
        const mapped = rowToEntry(row, columns)
        if (!mapped) continue
        result.entries.push(mapped.entry)
        if (mapped.projectRoot !== null) {
          addImportedProject(projects, projectKeyFromCwd(mapped.projectRoot), mapped.projectRoot)
        }
      } catch (error) {
        result.errors.push(`mnemon: failed to map row in ${dbPath}: ${String(error)}`)
      }
    }
    result.projects = [...projects.values()]
  } catch (error) {
    result.errors.push(`mnemon: failed to read ${dbPath}: ${String(error)}`)
  } finally {
    try {
      opened?.db.close()
    } catch {
      /* ignore close failure */
    }
    opened?.cleanup()
  }
  return result
}

/**
 * Import every mnemon root. Missing databases and empty tables produce an
 * empty report; broken rows are reported individually without aborting.
 */
export function importMnemon(roots: readonly string[]): MnemonImportResult {
  const result: MnemonImportResult = { entries: [], rootsFound: [], errors: [], projects: [] }
  const projectParts: ImportedProject[][] = []
  for (const root of roots) {
    for (const dbPath of listMnemonDbPaths(root)) {
      if (!existsSync(dbPath)) continue
      const partial = importMnemonDb(dbPath)
      result.entries.push(...partial.entries)
      if (partial.rootsFound.length > 0) result.rootsFound.push(root)
      result.errors.push(...partial.errors)
      projectParts.push(partial.projects)
    }
  }
  result.projects = mergeImportedProjects(projectParts)
  return result
}
