import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createLayout, type LayoutPort } from '@llm-memory/core/layout/index'
import { assertLayoutContract, layoutContract, storesAreSeparate } from '../src/testkit/index'

const homes: string[] = []
afterEach(() => {
  for (const dir of homes.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function home(): string {
  const dir = mkdtempSync(join(tmpdir(), 'llm-contract-'))
  homes.push(dir)
  return dir
}

function layouts(): LayoutPort[] {
  const h = home()
  return [
    createLayout('kilo', { home: h, cwd: '/repo/proj-a' }),
    createLayout('dsh', { home: h, cwd: '/repo/proj-a' }),
    createLayout('opencode', { home: h, cwd: '/repo/proj-a' }),
    createLayout('mcp', { home: h, cwd: '/repo/proj-a', clientId: 'cursor' }),
  ]
}

describe('adapter contract', () => {
  it('every layout satisfies the shared contract', () => {
    for (const layout of layouts()) assertLayoutContract(layout)
  })

  it('reports failures instead of throwing from layoutContract', () => {
    const base = layouts()[0]!
    const broken = {
      kind: base.kind,
      userRoot: () => base.userRoot(),
      projectRoot: (key: string) => base.projectRoot(key),
      dbPath: () => '/elsewhere/memory.db',
      pagesDir: (scope: 'global' | 'project' | 'user', key?: string) => base.pagesDir(scope, key),
      projectKey: (cwd: string) => base.projectKey(cwd),
      assertLocalStore: () => base.assertLocalStore(),
    }
    const failed = layoutContract(broken).filter(check => !check.ok)
    expect(failed.map(item => item.name)).toContain('dbPath lives inside userRoot')
    expect(() => assertLayoutContract(broken)).toThrow(/dbPath lives inside userRoot/)
  })

  it('keeps the four harness stores separate', () => {
    const all = layouts()
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        expect(storesAreSeparate(all[i]!, all[j]!)).toBe(true)
      }
    }
  })
})
