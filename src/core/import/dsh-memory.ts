/**
 * Importer for the dsh-memory plugin store.
 *
 * Two on-disk layouts exist and both are supported:
 *
 * - SQLite (current plugin, `~/.dsh/memory/memory.db`): a single `memories`
 *   table `(id, text, tags, pinned, created_at, updated_at)` shared by every
 *   project on the machine. `tags` is a space-joined list, the timestamps are
 *   epoch milliseconds and `pinned` is SQLite's integer boolean.
 * - Markdown (legacy/JetBrains layout): `<root>/_user/*.md` (cross-project) and
 *   `<root>/<project>/*.md`, each page starting with a single line
 *   `<!-- dsh-memory: {"name":...,"description":...,"type":...} -->`.
 *
 * Missing or malformed pages and unreadable databases are reported per source
 * and never abort the whole import.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

import { USER_DIR, sanitizeProjectKey } from '../paths.js'
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
  type ImportedProject,
  type ReadOnlyDatabase,
} from './common.js'
import { dshMemoryDbPaths, isDshMemoryRoot } from './paths.js'

export interface DshMemoryImportResult {
  entries: MemoryEntry[]
  rootsFound: string[]
  errors: string[]
  /** Projects found as `<root>/<project>` directories (root is unknown). */
  projects: ImportedProject[]
}

const HEADER_RE = /^<!--\s*dsh-memory:\s*(\{.*\})\s*-->$/u

const SOURCE = 'dsh-memory'

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function citationsTag(citations: unknown): string | null {
  if (citations === null || citations === undefined) return null
  if (Array.isArray(citations)) {
    if (citations.length === 0) return null
    return `citations:${JSON.stringify(citations)}`
  }
  if (typeof citations === 'string') {
    return citations.trim().length > 0 ? `citations:${JSON.stringify([citations])}` : null
  }
  return `citations:${JSON.stringify(citations)}`
}

/** Split the space-joined `tags` column back into the tag list it stores. */
function splitTagList(value: unknown): string[] {
  return asString(value)
    .split(/\s+/u)
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0)
}

function parsePage(
  text: string,
  scope: MemoryScope,
  project: string,
  file: string,
): { entry: MemoryEntry | null; error: string | null } {
  const firstNewline = text.indexOf('\n')
  const headerLine = (firstNewline >= 0 ? text.slice(0, firstNewline) : text).trim()
  const match = HEADER_RE.exec(headerLine)
  if (!match) return { entry: null, error: `${SOURCE}: missing JSON header in ${file}` }

  let header: Record<string, unknown>
  try {
    header = asRecord(JSON.parse(match[1] ?? '{}'))
  } catch {
    return { entry: null, error: `${SOURCE}: invalid JSON header in ${file}` }
  }

  const body = (firstNewline >= 0 ? text.slice(firstNewline + 1) : '').trim()
  const name =
    typeof header['name'] === 'string' && header['name'].trim().length > 0
      ? header['name'].trim()
      : basename(file, '.md')
  const description = typeof header['description'] === 'string' ? header['description'].trim() : ''
  const type = typeof header['type'] === 'string' ? header['type'].trim().toLowerCase() : ''
  const now = new Date().toISOString()

  const tags = [SOURCE]
  if (type.length > 0) tags.push(`type:${type}`)
  const citations = citationsTag(header['citations'])
  if (citations) tags.push(citations)

  const keywordParts = [name]
  if (header['rev'] !== undefined && header['rev'] !== null) keywordParts.push(`rev:${String(header['rev'])}`)

  const keyProject = scope === 'user' ? USER_DIR : project
  return {
    error: null,
    entry: {
      id: genMemoryId(),
      scope,
      project,
      kind: 'facts',
      tier: 'normal',
      status: 'active',
      title: description || name || firstLine(body),
      text: body,
      tags,
      keywords: keywordParts.join(' '),
      importance: 3,
      supersedes: [],
      supersededBy: [],
      related: [],
      source: SOURCE,
      extKey: `${SOURCE}:${keyProject}:${name}`,
      createdAt: toIsoString(header['createdAt'], now),
      updatedAt: toIsoString(header['updatedAt'], now),
    },
  }
}

/**
 * Map one `memories` row to a core entry.
 *
 * The dsh-memory store has no projects (one database per machine) and no
 * relations, so every row lands in the cross-project `user` layer. `pinned`
 * ("always render in the prompt") is the closest thing the source has to a
 * tier, so it becomes `important` with importance 5.
 */
function rowToEntry(
  row: Record<string, unknown>,
  columns: ReadonlySet<string>,
): MemoryEntry | null {
  const id = asString(pickColumn(row, columns, ['id'])).trim()
  if (id.length === 0) return null

  const text = asString(pickColumn(row, columns, ['text', 'content']))
  const pinned = (asNumber(pickColumn(row, columns, ['pinned'])) ?? 0) !== 0
  const now = new Date().toISOString()
  // The store itself may already carry the `dsh-memory` tag; keep the list
  // unique so a re-import stays a no-op instead of a rewrite.
  const tags = [...new Set([SOURCE, ...splitTagList(pickColumn(row, columns, ['tags']))])]
  if (pinned) tags.push('pinned')

  return {
    id: genMemoryId(),
    scope: 'user',
    project: '',
    kind: 'facts',
    tier: pinned ? 'important' : 'normal',
    status: 'active',
    title: firstLine(text),
    text,
    tags,
    keywords: '',
    importance: pinned ? 5 : 3,
    supersedes: [],
    supersededBy: [],
    related: [],
    source: SOURCE,
    extKey: `${SOURCE}:db:${id}`,
    createdAt: toIsoString(pickColumn(row, columns, ['created_at', 'createdAt']), now),
    updatedAt: toIsoString(pickColumn(row, columns, ['updated_at', 'updatedAt']), now),
  }
}

/** Import one dsh-memory SQLite file read-only. */
export function importDshMemoryDb(dbPath: string): DshMemoryImportResult {
  const result: DshMemoryImportResult = { entries: [], rootsFound: [], errors: [], projects: [] }
  let opened: ReadOnlyDatabase | null = null
  try {
    opened = openReadOnlyDatabase(dbPath)
    const db = opened.db
    const columns = tableColumns(db, 'memories')
    if (columns.size === 0) {
      result.errors.push(`${SOURCE}: no memories table in ${dbPath}`)
      return result
    }
    const rows = db.prepare('SELECT * FROM memories').all() as Array<Record<string, unknown>>
    for (const row of rows) {
      try {
        const entry = rowToEntry(row, columns)
        if (entry) result.entries.push(entry)
      } catch (error) {
        result.errors.push(`${SOURCE}: failed to map row in ${dbPath}: ${String(error)}`)
      }
    }
  } catch (error) {
    result.errors.push(`${SOURCE}: failed to read ${dbPath}: ${String(error)}`)
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

function importDirectory(
  dir: string,
  scope: MemoryScope,
  project: string,
  result: DshMemoryImportResult,
  projects: Map<string, ImportedProject>,
): void {
  let files: string[]
  try {
    files = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
      .map((entry) => join(dir, entry.name))
  } catch {
    return
  }
  let added = 0
  for (const file of files) {
    let text: string
    try {
      text = readFileSync(file, 'utf8')
    } catch (error) {
      result.errors.push(`${SOURCE}: cannot read ${file}: ${String(error)}`)
      continue
    }
    const parsed = parsePage(text, scope, project, file)
    if (parsed.error) result.errors.push(parsed.error)
    if (parsed.entry) {
      result.entries.push(parsed.entry)
      added++
    }
  }
  // A directory is a project only when it actually yielded pages: the SQLite
  // store lives in a `memory/` subdirectory that must not show up as one.
  if (added > 0 && scope === 'project' && project.length > 0) addImportedProject(projects, project, null)
}

/**
 * Import a single dsh-memory root (SQLite store and/or legacy markdown pages).
 *
 * `seenDatabases` carries the absolute database paths already imported in this
 * run, so overlapping roots (`~/.dsh` and `~/.dsh/memory`) import one store
 * only once.
 */
export function importDshMemoryRoot(
  root: string,
  seenDatabases?: Set<string>,
): DshMemoryImportResult {
  const result: DshMemoryImportResult = { entries: [], rootsFound: [], errors: [], projects: [] }
  if (!isDshMemoryRoot(root)) return result
  const projects = new Map<string, ImportedProject>()

  importDirectory(join(root, USER_DIR), 'user', '', result, projects)

  let children: string[]
  try {
    children = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    children = []
  }
  for (const name of children) {
    if (name === USER_DIR || name === '_db' || name.startsWith('.')) continue
    const project = sanitizeProjectKey(name)
    importDirectory(join(root, name), 'project', project, result, projects)
  }

  const markdownFound = result.entries.length > 0
  let databasesFound = false
  for (const dbPath of dshMemoryDbPaths(root)) {
    const key = resolve(dbPath)
    if (seenDatabases?.has(key)) continue
    seenDatabases?.add(key)
    const partial = importDshMemoryDb(dbPath)
    result.entries.push(...partial.entries)
    result.errors.push(...partial.errors)
    databasesFound = true
  }

  if (markdownFound || databasesFound) result.rootsFound.push(root)
  result.projects = mergeImportedProjects([[...projects.values()]])
  return result
}

/**
 * Import every dsh-memory root. Roots without a `memories` table and without
 * markdown pages are ignored; broken sources still return the valid entries.
 */
export function importDshMemory(roots: readonly string[]): DshMemoryImportResult {
  const result: DshMemoryImportResult = { entries: [], rootsFound: [], errors: [], projects: [] }
  const projectParts: ImportedProject[][] = []
  const seenDatabases = new Set<string>()
  for (const root of roots) {
    const partial = importDshMemoryRoot(root, seenDatabases)
    result.entries.push(...partial.entries)
    result.rootsFound.push(...partial.rootsFound)
    result.errors.push(...partial.errors)
    projectParts.push(partial.projects)
  }
  result.projects = mergeImportedProjects(projectParts)
  return result
}
