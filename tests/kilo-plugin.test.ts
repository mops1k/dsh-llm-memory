import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { loadConfigFrom, resolveProjectRoot } from '@llm-memory/adapter/kilo/plugin'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('kilo plugin helpers', () => {
  it('falls back to defaults when the config file is missing or broken', () => {
    expect(loadConfigFrom('/nonexistent/kilo-memory.json').memory.promptMode).toBe('dynamic')
    const dir = mkdtempSync(join(tmpdir(), 'llm-kilo-cfg-'))
    dirs.push(dir)
    const broken = join(dir, 'broken.json')
    writeFileSync(broken, '{ not json')
    expect(loadConfigFrom(broken).web.port).toBe(8787)
  })

  it('reads and merges a stored config', () => {
    const dir = mkdtempSync(join(tmpdir(), 'llm-kilo-cfg-'))
    dirs.push(dir)
    const file = join(dir, 'kilo-memory.json')
    writeFileSync(file, JSON.stringify({ memory: { promptMode: 'frozen', recallLimit: 3 }, web: { port: 9001 } }))
    const config = loadConfigFrom(file)
    expect(config.memory.promptMode).toBe('frozen')
    expect(config.memory.recallLimit).toBe(3)
    expect(config.web.port).toBe(9001)
    expect(config.memory.recallScope).toBe('all')
  })

  it('takes the project root from directory when worktree is a WSL placeholder', () => {
    expect(resolveProjectRoot({ worktree: '/', directory: '\\\\wsl.localhost\\archlinux\\home\\u\\repo' })).toBe(
      '\\\\wsl.localhost\\archlinux\\home\\u\\repo',
    )
    expect(resolveProjectRoot({ worktree: '/repo/proj', directory: '/ignored' })).toBe('/repo/proj')
    expect(resolveProjectRoot({})).toBeUndefined()
  })
})
