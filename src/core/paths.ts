/**
 * Storage layout and safe filesystem helpers.
 *
 * Layout (root is `$DSH_HOME/llm-memory` or `~/.dsh/llm-memory`):
 *   <root>/_db/memory.db              SQLite/FTS5 index (derived, single central DB)
 *   <root>/_user/<kind>/<name>.md     cross-project user memories
 *   <root>/projects.json              map of project key -> absolute project root
 *   <root>/<project>/<kind>/<name>.md legacy/global fallback for projects with no root
 *
 * Project pages live inside the repository itself:
 *   <projectRoot>/.dsh/llm-memory/<kind>/<name>.md
 *
 * The `kind` (rules/preferences/decisions/facts/architecture/concepts) is a
 * subdirectory and the file name is `<title-slug>-<id>.md`.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'

import type { MemoryEntry, MemoryScope } from './types.js'

/** Environment variable holding the dsh home directory. */
export const DSH_HOME_ENV = 'DSH_HOME'

/** Directory name of the cross-project user layer. */
export const USER_DIR = '_user'

/** Project key used when the session has no usable cwd. */
export const NO_CWD_KEY = '_no-cwd'

/** Directory that holds the derived SQLite index. */
export const DB_DIR = '_db'

/** Directory that holds raw per-session digests (not memory entries). */
export const DIGEST_DIR = '_digest'

/** File inside the storage root mapping project keys to absolute roots. */
export const PROJECTS_FILE = 'projects.json'

/** Project-relative directory that holds a project's markdown pages. */
export const PROJECT_MEMORY_DIR = '.dsh/llm-memory'

/** Maximum length of a generated file name slug. */
export const MAX_SLUG_LENGTH = 48

/** Maximum length of a sanitized project key. */
export const MAX_PROJECT_KEY_LENGTH = 64

/** Resolve the storage root: explicit override, then `$DSH_HOME`, then `~/.dsh`. */
export function resolveStorageRoot(override?: string | null): string {
  const custom = typeof override === 'string' ? override.trim() : ''
  if (custom.length > 0) return resolve(custom)
  const dshHome = (process.env[DSH_HOME_ENV] ?? '').trim()
  if (dshHome.length > 0) return resolve(join(dshHome, 'llm-memory'))
  return resolve(join(homedir(), '.dsh', 'llm-memory'))
}

/**
 * Sanitize a raw directory name into a safe project key.
 *
 * The placeholder {@link NO_CWD_KEY} is idempotent: sanitizing it again must not
 * strip its leading underscore, otherwise the key written to disk
 * (`no-cwd`) would differ from the constant (`_no-cwd`).
 */
export function sanitizeProjectKey(value: string): string {
  const raw = value ?? ''
  if (raw === NO_CWD_KEY) return NO_CWD_KEY
  const cleaned = raw
    .replace(/[^a-zA-Z0-9._-]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '')
    .slice(0, MAX_PROJECT_KEY_LENGTH)
  if (cleaned.length === 0 || cleaned === '.' || cleaned === '..') return NO_CWD_KEY
  return cleaned
}

/** Derive a project key from a working directory (its basename). */
export function projectKeyFromCwd(cwd?: string | null): string {
  const raw = typeof cwd === 'string' ? cwd.trim() : ''
  if (raw.length === 0) return NO_CWD_KEY
  const normalized = raw.replace(/[\\/]+$/u, '')
  const base = normalized.split(/[\\/]/u).pop() ?? ''
  return sanitizeProjectKey(base)
}

/** Build a lowercase slug for a title, keeping unicode letters and digits. */
export function titleSlug(title: string, maxLength = MAX_SLUG_LENGTH): string {
  const slug = (title ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (slug.length === 0) return 'untitled'
  return slug.slice(0, maxLength).replace(/-+$/g, '') || 'untitled'
}

/**
 * File name for an entry: `<title-slug>-<id>.md`.
 *
 * The category (`kind`) is not part of the name anymore: it is the name of the
 * subdirectory that holds the page, matching the KiloCode layout
 * `<memory>/pages/<kind>/<slug>.md`.
 */
export function entryFileName(entry: Pick<MemoryEntry, 'id' | 'title'>): string {
  const safeId = (entry.id ?? '').replace(/[^a-zA-Z0-9._-]+/gu, '-') || 'unknown'
  return `${titleSlug(entry.title)}-${safeId}.md`
}

export interface StoragePaths {
  root: string
  dbDir: string
  dbPath: string
  userDir: string
}

/** Resolve the fixed storage paths under a root. */
export function resolveStoragePaths(root: string): StoragePaths {
  const base = resolve(root)
  return {
    root: base,
    dbDir: join(base, DB_DIR),
    dbPath: join(base, DB_DIR, 'memory.db'),
    userDir: join(base, USER_DIR),
  }
}

/** Directory that stores entries of a given scope/project (without the kind). */
export function scopeDir(root: string, scope: MemoryScope, project: string): string {
  if (scope === 'user') return join(resolve(root), USER_DIR)
  const key = sanitizeProjectKey(project)
  return join(resolve(root), key)
}

/** Subdirectory that stores the pages of one category: `<baseDir>/<kind>`. */
export function kindDir(baseDir: string, kind: string): string {
  return join(resolve(baseDir), kind)
}

/** Absolute markdown directory inside a project: `<projectRoot>/.dsh/llm-memory`. */
export function projectMemoryRoot(projectRoot: string, dirName: string = PROJECT_MEMORY_DIR): string {
  return join(resolve(projectRoot), dirName)
}

/**
 * Directory that stores entries of a scope/project, preferring the project tree.
 *
 * A known `projectRoot` routes project entries into
 * `<projectRoot>/.dsh/llm-memory`; otherwise the legacy/global fallback
 * `<root>/<key>/` is used, which also covers projects whose root is unknown.
 */
export function scopeDirFor(
  root: string,
  scope: MemoryScope,
  project: string,
  projectRoot?: string | null,
): string {
  if (scope === 'user') return join(resolve(root), USER_DIR)
  const trimmed = typeof projectRoot === 'string' ? projectRoot.trim() : ''
  if (trimmed.length > 0) return projectMemoryRoot(trimmed)
  return join(resolve(root), sanitizeProjectKey(project))
}

/** Absolute path of the markdown file backing an entry. */
export function entryFilePath(root: string, entry: Pick<MemoryEntry, 'id' | 'kind' | 'title' | 'scope' | 'project'>): string {
  return join(kindDir(scopeDir(root, entry.scope, entry.project), entry.kind), entryFileName(entry))
}

/** Absolute path of the markdown file backing an entry, honoring a project root. */
export function entryPathFor(
  root: string,
  entry: Pick<MemoryEntry, 'id' | 'kind' | 'title' | 'scope' | 'project'>,
  projectRoot?: string | null,
): string {
  return join(kindDir(scopeDirFor(root, entry.scope, entry.project, projectRoot), entry.kind), entryFileName(entry))
}

/** Absolute path of the `projects.json` registry inside a storage root. */
export function projectsRegistryPath(root: string): string {
  return join(resolve(root), PROJECTS_FILE)
}

/**
 * Read the project registry (`key -> absolute project root`) from a storage
 * root. Missing, unreadable or malformed files yield an empty map.
 */
export function readProjectsRegistry(root: string): Record<string, string> {
  const text = readFileIfExists(projectsRegistryPath(root))
  if (text === null) return {}
  try {
    const parsed: unknown = JSON.parse(text)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const projectKey = sanitizeProjectKey(key)
      if (projectKey.length === 0) continue
      if (typeof value !== 'string') continue
      const projectRoot = value.trim()
      if (projectRoot.length === 0) continue
      out[projectKey] = projectRoot
    }
    return out
  } catch {
    return {}
  }
}

/** Persist the project registry, sorted for stable on-disk output. */
export function writeProjectsRegistry(root: string, projects: Record<string, string>): void {
  const sorted: Record<string, string> = {}
  for (const key of Object.keys(projects).sort()) {
    const projectKey = sanitizeProjectKey(key)
    const value = typeof projects[key] === 'string' ? projects[key].trim() : ''
    if (projectKey.length === 0 || value.length === 0) continue
    sorted[projectKey] = value
  }
  writeFileAtomic(projectsRegistryPath(root), `${JSON.stringify(sorted, null, 2)}\n`)
}

/** Register or update one `key -> absolute project root` entry on disk. */
export function upsertProjectRoot(root: string, key: string, projectRoot: string): void {
  const projectKey = sanitizeProjectKey(key)
  const value = (projectRoot ?? '').trim()
  if (projectKey.length === 0 || value.length === 0) return
  const projects = readProjectsRegistry(root)
  if (projects[projectKey] === value) return
  projects[projectKey] = value
  writeProjectsRegistry(root, projects)
}

/** Create a directory (recursively) if it does not exist. */
export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true })
}

/** True when `child` resolves inside `parent`. */
export function isPathInside(parent: string, child: string): boolean {
  const base = resolve(parent)
  const target = resolve(child)
  return target === base || target.startsWith(base + sep)
}

/** Join a base directory with a relative name, refusing to escape the base. */
export function safeJoin(baseDir: string, name: string): string {
  const base = resolve(baseDir)
  const target = resolve(base, name)
  if (!isPathInside(base, target)) {
    throw new Error(`Refusing to access a path outside the storage root: ${name}`)
  }
  return target
}

/** Atomically write a UTF-8 text file (temp file + rename). */
export function writeFileAtomic(file: string, content: string): void {
  ensureDir(dirname(file))
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(tmp, content, 'utf8')
  try {
    renameSync(tmp, file)
  } catch (error) {
    try {
      unlinkSync(tmp)
    } catch {
      /* ignore cleanup failure */
    }
    throw error
  }
}

/** Read a UTF-8 text file, returning null when it does not exist or is unreadable. */
export function readFileIfExists(file: string): string | null {
  try {
    if (!existsSync(file)) return null
    return readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

/** Remove a file if present; returns true when a file was removed. */
export function removeFileIfExists(file: string): boolean {
  try {
    if (!existsSync(file)) return false
    unlinkSync(file)
    return true
  } catch {
    return false
  }
}

/** List immediate child directories of a directory. */
export function listChildDirectories(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

/** List immediate `*.md` files of a directory. */
export function listMarkdownFiles(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
      .map((entry) => join(dir, entry.name))
  } catch {
    return []
  }
}

/** File mtime in milliseconds, or 0 when unavailable. */
export function fileMtimeMs(file: string): number {
  try {
    return statSync(file).mtimeMs
  } catch {
    return 0
  }
}
