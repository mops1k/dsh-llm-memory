import { describe, expect, it } from 'vitest'

import { DEFAULT_CONFIG, DEFAULT_SYSTEM_PROMPT, mergeConfig } from '../src/core/config'

describe('mergeConfig', () => {
  it('returns the defaults for empty input', () => {
    const config = mergeConfig()
    expect(config).toEqual(DEFAULT_CONFIG)
    expect(config.recallLimit).toBe(10)
    expect(config.recallScope).toBe('all')
    expect(config.lintOverlapMinCommonWords).toBe(8)
    expect(config.lintMaxPairs).toBe(200)
    expect(config.autonomous).toBe(true)
    expect(config.requireConfirmation).toBe(false)
    expect(config.importAutoDetect).toBe(true)
    expect(config.webPath).toBe('/llm-memory')
    expect(config.importRoots).toEqual([])
    expect(config.systemPrompt).toBe(DEFAULT_SYSTEM_PROMPT)
  })

  it('overrides, clamps and normalizes values', () => {
    const config = mergeConfig({
      storageRoot: '  /tmp/memory  ',
      recallLimit: 0,
      recallScope: 'user',
      lintMaxPairs: -5,
      webPath: 'memory',
      importRoots: [' /a ', '/a', '', '/b'],
      systemPrompt: '   ',
    })
    expect(config.storageRoot).toBe('/tmp/memory')
    expect(config.recallLimit).toBe(1)
    expect(config.recallScope).toBe('user')
    expect(config.lintMaxPairs).toBe(0)
    expect(config.webPath).toBe('/memory')
    expect(config.importRoots).toEqual(['/a', '/b'])
    expect(config.systemPrompt).toBe(DEFAULT_SYSTEM_PROMPT)
  })

  it('keeps a custom system prompt and drops invalid scopes', () => {
    expect(mergeConfig({ systemPrompt: 'Custom guidance' }).systemPrompt).toBe('Custom guidance')
    expect(mergeConfig({ recallScope: 'nope' as never }).recallScope).toBe('all')
    expect(mergeConfig({ storageRoot: '   ' }).storageRoot).toBeUndefined()
  })
})
