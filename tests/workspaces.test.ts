import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { ImportedProject } from '../src/core/import/common'
import {
  findWorkspacePathByKey,
  registerImportedWorkspaces,
  registerProjectRoots,
  toLocalPath,
  type WorkspaceLike,
  type WorkspaceRegistryLike,
} from '../src/dsh/workspaces'
import { cleanupRoot, makeTempRoot } from './helpers'

/** In-memory registry double: records creations and can be told to fail. */
class FakeRegistry implements WorkspaceRegistryLike {
  readonly created: Array<{ path: string; title?: string }> = []
  readonly failOn = new Set<string>()
  private readonly owned = new Map<string, WorkspaceLike>()

  async create(path: string, title?: string): Promise<WorkspaceLike> {
    if (this.failOn.has(path)) throw new Error('create failed')
    const workspace: WorkspaceLike = { path, title: title ?? path }
    this.owned.set(path, workspace)
    this.created.push(title === undefined ? { path } : { path, title })
    return workspace
  }

  list(): WorkspaceLike[] {
    return [...this.owned.values()]
  }

  async resolveByPath(path: string): Promise<WorkspaceLike | undefined> {
    return this.owned.get(path)
  }

  /** Pre-register a path as if it already had a workspace. */
  own(path: string, title = path): void {
    this.owned.set(path, { path, title })
  }
}

describe('toLocalPath', () => {
  it('converts WSL UNC roots to unix paths', () => {
    expect(toLocalPath('\\\\wsl.localhost\\archlinux\\home\\u\\proj', 'linux')).toBe('/home/u/proj')
    expect(toLocalPath('\\\\wsl$\\archlinux\\home\\u\\proj', 'linux')).toBe('/home/u/proj')
    expect(toLocalPath('//wsl.localhost/archlinux/home/u/proj', 'linux')).toBe('/home/u/proj')
  })

  it('converts Windows drive roots per host platform', () => {
    expect(toLocalPath('C:\\Users\\x\\proj', 'linux')).toBe('/mnt/c/Users/x/proj')
    expect(toLocalPath('c:/Users/x/proj', 'linux')).toBe('/mnt/c/Users/x/proj')
    expect(toLocalPath('C:\\Users\\x\\proj', 'win32')).toBe('C:\\Users\\x\\proj')
  })

  it('keeps unix paths and rejects unusable roots', () => {
    expect(toLocalPath('/home/u/proj', 'linux')).toBe('/home/u/proj')
    expect(toLocalPath('/home/u/proj', 'win32')).toBe('/home/u/proj')
    expect(toLocalPath('', 'linux')).toBeNull()
    expect(toLocalPath('   ', 'linux')).toBeNull()
    expect(toLocalPath(null, 'linux')).toBeNull()
    expect(toLocalPath(undefined, 'linux')).toBeNull()
    expect(toLocalPath('_user', 'linux')).toBeNull()
    expect(toLocalPath('_no-cwd', 'linux')).toBeNull()
    expect(toLocalPath('no-cwd', 'linux')).toBeNull()
    expect(toLocalPath('relative/path', 'linux')).toBeNull()
  })
})

describe('registerImportedWorkspaces', () => {
  let root: string

  beforeEach(() => {
    root = makeTempRoot('dsh-workspaces-')
  })

  afterEach(() => {
    cleanupRoot(root)
  })

  it('creates a workspace for an existing directory using the project key as title', async () => {
    const dir = join(root, 'proj')
    mkdirSync(dir)
    const registry = new FakeRegistry()

    const report = await registerImportedWorkspaces(registry, [{ key: 'proj', root: dir }])

    expect(report).toEqual({ created: [dir], existing: [], skipped: [], errors: [] })
    expect(registry.created).toEqual([{ path: dir, title: 'proj' }])
  })

  it('reports an already registered path without creating a duplicate', async () => {
    const dir = join(root, 'proj')
    mkdirSync(dir)
    const registry = new FakeRegistry()
    registry.own(dir, 'proj')

    const report = await registerImportedWorkspaces(registry, [{ key: 'proj', root: dir }])

    expect(report.existing).toEqual([dir])
    expect(registry.created).toHaveLength(0)
  })

  it('skips missing directories, unknown roots and duplicate paths', async () => {
    const dir = join(root, 'proj')
    mkdirSync(dir)
    const registry = new FakeRegistry()
    const projects: ImportedProject[] = [
      { key: 'missing', root: join(root, 'nope') },
      { key: 'unknown', root: null },
      { key: 'proj', root: dir },
      { key: 'proj-again', root: dir },
    ]

    const report = await registerImportedWorkspaces(registry, projects)

    expect(report.created).toEqual([dir])
    expect(report.skipped).toEqual([join(root, 'nope'), 'unknown', dir])
    expect(registry.created).toHaveLength(1)
  })

  it('collects registry failures without aborting the run', async () => {
    const failing = join(root, 'failing')
    const healthy = join(root, 'healthy')
    mkdirSync(failing)
    mkdirSync(healthy)
    const registry = new FakeRegistry()
    registry.failOn.add(failing)

    const report = await registerImportedWorkspaces(registry, [
      { key: 'failing', root: failing },
      { key: 'healthy', root: healthy },
    ])

    expect(report.errors).toHaveLength(1)
    expect(report.errors[0]).toContain(failing)
    expect(report.created).toEqual([healthy])
  })
})

describe('findWorkspacePathByKey', () => {
  it('matches a workspace by title or by sanitized path basename', () => {
    const registry = new FakeRegistry()
    registry.own('/home/u/my proj', 'My Project')
    registry.own('/home/u/other', 'other')

    expect(findWorkspacePathByKey(registry, 'other')).toBe('/home/u/other')
    expect(findWorkspacePathByKey(registry, 'My Project')).toBe('/home/u/my proj')
    expect(findWorkspacePathByKey(registry, 'missing')).toBeNull()
    expect(findWorkspacePathByKey(registry, '')).toBeNull()
  })
})

describe('registerProjectRoots', () => {
  let root: string

  beforeEach(() => {
    root = makeTempRoot('dsh-project-roots-')
  })

  afterEach(() => {
    cleanupRoot(root)
  })

  it('registers existing host-local roots and skips the rest', () => {
    const dir = join(root, 'proj')
    mkdirSync(dir)
    const registered: Array<{ key: string; root: string }> = []
    const registrar = { registerProject: (key: string, projectRoot: string) => registered.push({ key, root: projectRoot }) }

    const report = registerProjectRoots(
      registrar,
      [
        { key: 'proj', root: dir },
        { key: 'missing', root: join(root, 'nope') },
        { key: 'unknown', root: null },
        { key: 'dup', root: dir },
      ],
      { exists: (path) => existsSync(path) },
    )

    expect(report.registered).toEqual(['proj'])
    expect(registered).toEqual([{ key: 'proj', root: dir }])
    expect(report.skipped).toEqual([join(root, 'nope'), 'unknown', dir])
  })

  it('translates WSL UNC roots before probing them', () => {
    const registered: string[] = []
    const registrar = { registerProject: (key: string) => registered.push(key) }

    const report = registerProjectRoots(registrar, [{ key: 'unc', root: '\\\\wsl.localhost\\archlinux\\home\\u\\proj' }], {
      exists: (path) => path === '/home/u/proj',
    })

    expect(report.registered).toEqual(['unc'])
    expect(registered).toEqual(['unc'])
  })
})
