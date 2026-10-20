import { sep } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createLayout, StorePathError, assertLocalPath, sanitizeProjectKey } from '@llm-memory/core/layout/index'

const opts = { home: '/home/u', cwd: '/repo/proj-a' }
const posix = (path: string): string => path.split('/').join(sep)

describe('layouts', () => {
  it('kilo: user and project roots, db inside its own memory dir', () => {
    const l = createLayout('kilo', opts)
    expect(l.userRoot()).toBe('/home/u/.config/kilo/memory')
    expect(l.projectRoot('proj-a')).toBe('/repo/proj-a/.kilo/memory')
    expect(l.dbPath()).toBe('/home/u/.config/kilo/memory/db/memory.db')
    expect(l.pagesDir('global')).toBe('/home/u/.config/kilo/memory/pages')
    expect(l.pagesDir('project', 'proj-a')).toBe('/repo/proj-a/.kilo/memory/pages')
    expect(l.projectKey('/repo/proj-a')).toBe('proj-a')
  })

  it('dsh: _db layout and project mirror', () => {
    const l = createLayout('dsh', opts)
    expect(l.userRoot()).toBe('/home/u/.dsh/llm-memory')
    expect(l.dbPath()).toBe('/home/u/.dsh/llm-memory/_db/memory.db')
    expect(l.projectRoot('proj-a')).toBe('/repo/proj-a/.dsh/llm-memory')
  })

  it('opencode and mcp keep their own stores', () => {
    const oc = createLayout('opencode', opts)
    expect(oc.dbPath()).toBe('/home/u/.config/opencode/memory/db/memory.db')
    const mcp = createLayout('mcp', { ...opts, clientId: 'Cursor' })
    expect(mcp.userRoot()).toBe('/home/u/.llm-memory/mcp/cursor')
    expect(mcp.dbPath()).toBe('/home/u/.llm-memory/mcp/cursor/_db/memory.db')
  })

  it('mcp requires a client id', () => {
    expect(() => createLayout('mcp', opts)).toThrow(/clientId/)
  })

  it('rejects UNC store paths for every layout', () => {
    for (const kind of ['kilo', 'dsh', 'opencode'] as const) {
      const l = createLayout(kind, { ...opts, home: '\\\\wsl.localhost\\archlinux\\home\\u' })
      expect(() => l.assertLocalStore()).toThrow(StorePathError)
    }
    const mcp = createLayout('mcp', { ...opts, home: '\\\\wsl.localhost\\x\\u', clientId: 'c' })
    expect(() => mcp.assertLocalStore()).toThrow(/local disk/)
  })

  it('sanitizes project keys and falls back for empty input', () => {
    expect(sanitizeProjectKey('My Project (1)')).toBe('my-project-1')
    expect(sanitizeProjectKey('***')).toBe('no-cwd')
    expect(() => assertLocalPath('/home/u/.dsh')).not.toThrow()
  })
})
