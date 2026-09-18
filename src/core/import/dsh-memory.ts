/**
 * Importer for the dsh-memory plugin store (markdown pages with a JSON header).
 *
 * Layout: `<root>/_user/*.md` (cross-project) and `<root>/<project>/*.md`
 * (project/feedback). Each page starts with a single line of the form
 * `<!-- dsh-memory: {"name":...,"description":...,"type":...} -->` followed by
 * the body. Missing or malformed headers are reported per file and never abort
 * the whole import.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'

import { USER_DIR, sanitizeProjectKey } from '../paths.js'
import { genMemoryId } from '../store.js'
import type { MemoryEntry, MemoryScope } from '../types.js'
import {
  addImportedProject,
  firstLine,
  mergeImportedProjects,
  toIsoString,
  type ImportedProject,
} from './common.js'
import { isDshMemoryRoot } from './paths.js'

export interface DshMemoryImportResult {
  entries: MemoryEntry[]
  rootsFound: string[]
  errors: string[]
  /** Projects found as `<root>/<project>` directories (root is unknown). */
  projects: ImportedProject[]
}

const HEADER_RE = /^<!--\s*dsh-memory:\s*(\{.*\})\s*-->$/u

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

function parsePage(
  text: string,
  scope: MemoryScope,
  project: string,
  file: string,
): { entry: MemoryEntry | null; error: string | null } {
  const firstNewline = text.indexOf('\n')
  const headerLine = (firstNewline >= 0 ? text.slice(0, firstNewline) : text).trim()
  const match = HEADER_RE.exec(headerLine)
  if (!match) return { entry: null, error: `dsh-memory: missing JSON header in ${file}` }

  let header: Record<string, unknown>
  try {
    header = asRecord(JSON.parse(match[1] ?? '{}'))
  } catch {
    return { entry: null, error: `dsh-memory: invalid JSON header in ${file}` }
  }

  const body = (firstNewline >= 0 ? text.slice(firstNewline + 1) : '').trim()
  const name =
    typeof header['name'] === 'string' && header['name'].trim().length > 0
      ? header['name'].trim()
      : basename(file, '.md')
  const description = typeof header['description'] === 'string' ? header['description'].trim() : ''
  const type = typeof header['type'] === 'string' ? header['type'].trim().toLowerCase() : ''
  const now = new Date().toISOString()

  const tags = ['dsh-memory']
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
      source: 'dsh-memory',
      extKey: `dsh-memory:${keyProject}:${name}`,
      createdAt: toIsoString(header['createdAt'], now),
      updatedAt: toIsoString(header['updatedAt'], now),
    },
  }
}

function importDirectory(
  dir: string,
  scope: MemoryScope,
  project: string,
  result: DshMemoryImportResult,
  projects: Map<string, ImportedProject>,
): void {
  if (scope === 'project' && project.length > 0) addImportedProject(projects, project, null)
  let files: string[]
  try {
    files = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
      .map((entry) => join(dir, entry.name))
  } catch {
    return
  }
  for (const file of files) {
    let text: string
    try {
      text = readFileSync(file, 'utf8')
    } catch (error) {
      result.errors.push(`dsh-memory: cannot read ${file}: ${String(error)}`)
      continue
    }
    const parsed = parsePage(text, scope, project, file)
    if (parsed.error) result.errors.push(parsed.error)
    if (parsed.entry) result.entries.push(parsed.entry)
  }
}

/** Import a single dsh-memory root. */
export function importDshMemoryRoot(root: string): DshMemoryImportResult {
  const result: DshMemoryImportResult = { entries: [], rootsFound: [], errors: [], projects: [] }
  if (!isDshMemoryRoot(root)) return result
  result.rootsFound.push(root)
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
  result.projects = [...projects.values()]
  return result
}

/**
 * Import every dsh-memory root. Roots without any `dsh-memory` header are
 * ignored; a root with broken pages still returns the valid entries.
 */
export function importDshMemory(roots: readonly string[]): DshMemoryImportResult {
  const result: DshMemoryImportResult = { entries: [], rootsFound: [], errors: [], projects: [] }
  const projectParts: ImportedProject[][] = []
  for (const root of roots) {
    const partial = importDshMemoryRoot(root)
    result.entries.push(...partial.entries)
    result.rootsFound.push(...partial.rootsFound)
    result.errors.push(...partial.errors)
    projectParts.push(partial.projects)
  }
  result.projects = mergeImportedProjects(projectParts)
  return result
}
