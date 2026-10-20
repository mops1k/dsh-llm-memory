/**
 * Workspace helpers: path translation and project lookup.
 *
 * Paths coming from another host (a Windows drive path, a WSL UNC path or a
 * native Unix path) are translated before they are handed to the dsh workspace
 * registry, because the registry canonicalizes them with `fs.realpath`.
 *
 * @module dsh-llm-memory/dsh/workspaces
 */
import { existsSync } from 'node:fs'
import { basename } from 'node:path'

import { NO_CWD_KEY, sanitizeProjectKey } from '@llm-memory/core/layout/paths.js'

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

const WSL_UNC_RE = /^[\\/]{2}(?:wsl\.localhost|wsl\$)[\\/]([^\\/]+)[\\/](.*)$/iu
const WINDOWS_DRIVE_RE = /^([A-Za-z]):[\\/](.*)$/u

/**
 * Translate a raw project root into a path of the current host.
 *
 * - `\\wsl.localhost\<distro>\<rest>` / `\\wsl$\<distro>\<rest>` -> `/<rest>`
 * - `X:\...` on Linux -> `/mnt/x/...`; on Windows kept as `X:\...`
 * - native Unix paths are returned as-is
 * - empty values, `_user` and the no-cwd placeholder (`_no-cwd`, legacy
 *   `no-cwd`) yield `null`
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
  if (raw === '_user' || raw === NO_CWD_KEY || raw === 'no-cwd') return null

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


