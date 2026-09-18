/**
 * Workspace registration for imported projects.
 *
 * The importers keep the raw project root as spelled by the foreign store
 * (a Windows drive path, a WSL UNC path or a native Unix path). Before such a
 * root can be handed to `ctx.workspaceRegistry` it must be translated into a
 * path of the current host, because the registry canonicalizes it with
 * `fs.realpath` and rejects anything that does not exist.
 *
 * @module dsh-llm-memory/dsh/workspaces
 */
import { existsSync } from 'node:fs'
import { basename } from 'node:path'

import type { ImportedProject } from '../core/import/common.js'
import { sanitizeProjectKey } from '../core/paths.js'

/** Minimal structural view of a `@deepseek-ai/dsh-workspace` record. */
export interface WorkspaceLike {
  path: string
  title: string
}

/** Minimal structural view of `ctx.workspaceRegistry`. */
export interface WorkspaceRegistryLike {
  create(path: string, title?: string): Promise<WorkspaceLike>
  list(): WorkspaceLike[]
  resolveByPath(path: string): Promise<WorkspaceLike | undefined>
}

/** Outcome of one workspace sync. */
export interface WorkspaceSyncReport {
  /** Paths that were newly registered. */
  created: string[]
  /** Paths already owned by a workspace. */
  existing: string[]
  /** Paths skipped because the root is unknown, missing or duplicated. */
  skipped: string[]
  /** Human-readable failures that did not abort the run. */
  errors: string[]
}

/** Options for {@link registerImportedWorkspaces}. */
export interface RegisterWorkspacesOptions {
  /** Existence probe override (tests inject a deterministic check). */
  exists?: (path: string) => boolean
}

const WSL_UNC_RE = /^[\\/]{2}(?:wsl\.localhost|wsl\$)[\\/]([^\\/]+)[\\/](.*)$/iu
const WINDOWS_DRIVE_RE = /^([A-Za-z]):[\\/](.*)$/u

/**
 * Translate a raw project root into a path of the current host.
 *
 * - `\\wsl.localhost\<distro>\<rest>` / `\\wsl$\<distro>\<rest>` -> `/<rest>`
 * - `X:\...` on Linux -> `/mnt/x/...`; on Windows kept as `X:\...`
 * - native Unix paths are returned as-is
 * - empty values, `_user` and `_no-cwd` yield `null`
 *
 * @param root - Raw project root from an importer.
 * @param platform - Host platform (overridable for tests).
 * @returns a host-local absolute path, or `null` when there is none.
 */
export function toLocalPath(
  root: string | null | undefined,
  platform: NodeJS.Platform = process.platform,
): string | null {
  const raw = typeof root === 'string' ? root.trim() : ''
  if (raw.length === 0) return null
  if (raw === '_user' || raw === '_no-cwd') return null

  const wsl = WSL_UNC_RE.exec(raw)
  if (wsl) {
    const rest = (wsl[2] ?? '').replace(/\\/gu, '/').replace(/^\/+/u, '')
    return rest.length > 0 ? `/${rest}` : null
  }

  const drive = WINDOWS_DRIVE_RE.exec(raw)
  if (drive) {
    const letter = (drive[1] ?? '').toLowerCase()
    const rest = (drive[2] ?? '').replace(/\\/gu, '/')
    if (platform === 'win32') {
      return `${letter.toUpperCase()}:\\${rest.replace(/\//gu, '\\')}`
    }
    return rest.length > 0 ? `/mnt/${letter}/${rest}` : `/mnt/${letter}`
  }

  if (raw.startsWith('/')) return raw
  return null
}

/**
 * Find a registered workspace path for a project key.
 *
 * A workspace matches when its title equals the key or when the basename of its
 * path sanitizes to the key (both are the conventions used elsewhere).
 */
export function findWorkspacePathByKey(registry: WorkspaceRegistryLike, key: string): string | null {
  const wanted = (key ?? '').trim()
  if (wanted.length === 0) return null
  try {
    for (const workspace of registry.list()) {
      if (workspace.title === wanted) return workspace.path
      if (sanitizeProjectKey(basename(workspace.path)) === wanted) return workspace.path
    }
  } catch {
    return null
  }
  return null
}

/** Minimal registrar shape accepted by {@link registerProjectRoots}. */
export interface ProjectRegistrar {
  registerProject(key: string, root: string): void
}

/** Outcome of registering imported project roots in `projects.json`. */
export interface ProjectRootRegistrationReport {
  /** `key` values registered with their host-local root. */
  registered: string[]
  /** Roots skipped: unknown, missing or duplicated. */
  skipped: string[]
}

/**
 * Persist imported project roots (`key -> local path`) into the memory store's
 * `projects.json`, so project pages are written inside each repository.
 *
 * A project is skipped when its root cannot be translated to a host path, does
 * not exist on this host, or was already handled in this run.
 */
export function registerProjectRoots(
  registrar: ProjectRegistrar,
  projects: readonly ImportedProject[],
  options: RegisterWorkspacesOptions = {},
): ProjectRootRegistrationReport {
  const report: ProjectRootRegistrationReport = { registered: [], skipped: [] }
  const exists = options.exists ?? existsSync
  const seen = new Set<string>()

  for (const project of projects) {
    const key = (project?.key ?? '').trim()
    const local = toLocalPath(project?.root)
    if (key.length === 0 || local === null) {
      report.skipped.push(key.length > 0 ? key : '(unknown root)')
      continue
    }
    if (seen.has(local)) {
      report.skipped.push(local)
      continue
    }
    seen.add(local)
    if (!exists(local)) {
      report.skipped.push(local)
      continue
    }
    try {
      registrar.registerProject(key, local)
      report.registered.push(key)
    } catch {
      report.skipped.push(local)
    }
  }

  return report
}

/**
 * Register every imported project as a dsh workspace.
 *
 * A project is skipped when its root cannot be translated, does not exist on
 * this host, or was already handled in this run. Failures from the registry are
 * collected into `errors` instead of aborting the whole sync.
 */
export async function registerImportedWorkspaces(
  registry: WorkspaceRegistryLike,
  projects: readonly ImportedProject[],
  options: RegisterWorkspacesOptions = {},
): Promise<WorkspaceSyncReport> {
  const report: WorkspaceSyncReport = { created: [], existing: [], skipped: [], errors: [] }
  const exists = options.exists ?? existsSync
  const seen = new Set<string>()

  for (const project of projects) {
    const key = (project?.key ?? '').trim()
    const local = toLocalPath(project?.root)
    if (local === null) {
      report.skipped.push(key.length > 0 ? key : '(unknown root)')
      continue
    }
    if (seen.has(local)) {
      report.skipped.push(local)
      continue
    }
    seen.add(local)
    if (!exists(local)) {
      report.skipped.push(local)
      continue
    }
    try {
      const existing = await registry.resolveByPath(local)
      if (existing) {
        report.existing.push(local)
        continue
      }
      await registry.create(local, key.length > 0 ? key : undefined)
      report.created.push(local)
    } catch (error) {
      report.errors.push(`${local}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  return report
}
