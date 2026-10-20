import { describe, expect, it } from 'vitest'

import {
  findWorkspacePathByKey,
  toLocalPath,
  type WorkspaceLike,
  type WorkspaceRegistryLike,
} from '../src/dsh/workspaces'

/** In-memory registry double. */
class FakeRegistry implements WorkspaceRegistryLike {
  private readonly owned = new Map<string, WorkspaceLike>()

  own(path: string, title: string): void {
    this.owned.set(path, { path, title })
  }

  async create(path: string, title?: string): Promise<WorkspaceLike> {
    const workspace: WorkspaceLike = { path, title: title ?? path }
    this.owned.set(path, workspace)
    return workspace
  }

  list(): WorkspaceLike[] {
    return [...this.owned.values()]
  }

  async resolveByPath(path: string): Promise<WorkspaceLike | undefined> {
    return this.owned.get(path)
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
