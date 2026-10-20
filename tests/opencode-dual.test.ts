/**
 * One bundle must satisfy both host generations: OpenCode 1.x reads the default
 * export's `server()` and OpenCode 2.x reads `id` + `setup()`.
 */
import { describe, expect, it } from 'vitest'

import dual from '@llm-memory/adapter/opencode/plugin-dual'
import v1Plugin from '@llm-memory/adapter/opencode/plugin'

describe('opencode dual plugin entry', () => {
  it('exposes the v1 server function and the v2 setup function under one id', () => {
    expect(dual.id).toBe('llm-memory')
    expect(typeof dual.server).toBe('function')
    expect(typeof dual.setup).toBe('function')
    expect(dual.server).toBe(v1Plugin.server)
    expect(Object.keys(dual).sort()).toEqual(['id', 'server', 'setup'])
  })

  it('keeps the v1 entry importable on its own', () => {
    expect(v1Plugin.id).toBe('llm-memory')
    expect(typeof v1Plugin.server).toBe('function')
  })
})
