/**
 * Importer for the Kilo plugin memory store (kilo-memory).
 *
 * The source is a single SQLite database (`<root>/memory/db/memory.db`) whose
 * `memories` table uses `content` for the body, `supersededBy` (camelCase) and
 * `project_root` for the owning project. The database is opened strictly
 * read-only with `query_only` so the Kilo files (including `-wal`/`-shm`) are
 * never created or modified.
 */
import { NO_CWD_KEY, projectKeyFromCwd } from '../paths.js'
import { genMemoryId } from '../store.js'
import type { MemoryEntry, MemoryScope } from '../types.js'
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
  toMemoryKind,
  toMemoryStatus,
  toMemoryTier,
  toImportance,
  toStringList,
  type ImportedProject,
  type ReadOnlyDatabase,
} from './common.js'
import { kiloMemoryDbPath } from './paths.js'

export interface KiloImportResult {
  entries: MemoryEntry[]
  rootsFound: string[]
  errors: string[]
  /** Unique projects seen in `project_root` (root = the raw path). */
  projects: ImportedProject[]
}

function resolveScope(raw: unknown, projectRoot: string): MemoryScope {
  const value = asString(raw).trim().toLowerCase()
  if (value === 'global' || value === 'user') return 'user'
  if (value === 'project') return 'project'
  return projectRoot.length > 0 ? 'project' : 'user'
}

function rowToEntry(
  row: Record<string, unknown>,
  columns: ReadonlySet<string>,
): { entry: MemoryEntry; projectRoot: string | null } | null {
  const id = asString(pickColumn(row, columns, ['id'])).trim()
  if (id.length === 0) return null

  const content = asString(pickColumn(row, columns, ['content', 'text']))
  const projectRoot = asString(pickColumn(row, columns, ['project_root', 'projectRoot'])).trim()
  const scope = resolveScope(pickColumn(row, columns, ['scope']), projectRoot)
  const project = scope === 'project' ? projectKeyFromCwd(projectRoot) || NO_CWD_KEY : ''
  const now = new Date().toISOString()
  const confidence = asNumber(pickColumn(row, columns, ['confidence']))

  return {
    projectRoot: projectRoot.length > 0 ? projectRoot : null,
    entry: {
      id: genMemoryId(),
      scope,
      project,
      kind: toMemoryKind(pickColumn(row, columns, ['kind'])),
      tier: toMemoryTier(pickColumn(row, columns, ['tier'])),
      status: toMemoryStatus(pickColumn(row, columns, ['status'])),
      title: asString(pickColumn(row, columns, ['title'])).trim() || firstLine(content),
      text: content,
      tags: toStringList(pickColumn(row, columns, ['tags'])),
      keywords: toStringList(pickColumn(row, columns, ['keywords'])).join(' '),
      importance: toImportance(pickColumn(row, columns, ['importance'])),
      supersedes: toStringList(pickColumn(row, columns, ['supersedes'])),
      supersededBy: toStringList(pickColumn(row, columns, ['supersededBy', 'superseded_by'])),
      related: toStringList(pickColumn(row, columns, ['related'])),
      source: 'kilo',
      extKey: `kilo:${id}`,
      createdAt: toIsoString(pickColumn(row, columns, ['createdAt', 'created_at']), now),
      updatedAt: toIsoString(pickColumn(row, columns, ['updatedAt', 'updated_at']), now),
      ...(confidence !== undefined ? { confidence } : {}),
    },
  }
}

/** Import a single Kilo database file. */
export function importKiloDb(dbPath: string): KiloImportResult {
  const result: KiloImportResult = { entries: [], rootsFound: [], errors: [], projects: [] }
  const projects = new Map<string, ImportedProject>()
  let opened: ReadOnlyDatabase | null = null
  try {
    opened = openReadOnlyDatabase(dbPath)
    const db = opened.db
    const columns = tableColumns(db, 'memories')
    if (columns.size === 0) {
      result.errors.push(`kilo: no memories table in ${dbPath}`)
      return result
    }
    result.rootsFound.push(dbPath)
    const rows = db.prepare('SELECT * FROM memories').all() as Array<Record<string, unknown>>
    for (const row of rows) {
      try {
        const mapped = rowToEntry(row, columns)
        if (!mapped) continue
        result.entries.push(mapped.entry)
        if (mapped.entry.scope === 'project' && mapped.entry.project.length > 0) {
          addImportedProject(projects, mapped.entry.project, mapped.projectRoot)
        }
      } catch (error) {
        result.errors.push(`kilo: failed to map row in ${dbPath}: ${String(error)}`)
      }
    }
    result.projects = [...projects.values()]
  } catch (error) {
    result.errors.push(`kilo: failed to read ${dbPath}: ${String(error)}`)
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
 * Import every Kilo root. Roots without `memory/db/memory.db` are ignored; the
 * caller receives an empty report when nothing is found.
 */
export function importKilo(roots: readonly string[]): KiloImportResult {
  const result: KiloImportResult = { entries: [], rootsFound: [], errors: [], projects: [] }
  const projectParts: ImportedProject[][] = []
  for (const root of roots) {
    const partial = importKiloDb(kiloMemoryDbPath(root))
    result.entries.push(...partial.entries)
    if (partial.rootsFound.length > 0) result.rootsFound.push(root)
    result.errors.push(...partial.errors)
    projectParts.push(partial.projects)
  }
  result.projects = mergeImportedProjects(projectParts)
  return result
}
