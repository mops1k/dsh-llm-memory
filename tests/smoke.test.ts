import { describe, expect, it } from 'vitest'

import { Config, inject, name } from '../src/index'
import { DEFAULT_SYSTEM_PROMPT } from '../src/core/config'
import { MemorySettingsSchema } from '../src/dsh/settings'

describe('dsh-llm-memory plugin', () => {
  it('exposes stable plugin metadata', () => {
    expect(name).toBe('dsh-llm-memory')
    expect(inject).toEqual(['tools'])
  })

  it('applies schema defaults to the configuration', () => {
    const config = Config({})
    expect(config.recallLimit).toBe(10)
    expect(config.autonomous).toBe(true)
    expect(config.requireConfirmation).toBe(false)
    expect(config.importAutoDetect).toBe(true)
    expect(config.webPath).toBe('/llm-memory')
    expect(config.importRoots).toEqual([])
    expect(config.systemPrompt).toBe(DEFAULT_SYSTEM_PROMPT)
    expect(config.sessionStartGuide).toBe(true)
  })

  it('accepts a disabled session-start guide', () => {
    expect(Config({ sessionStartGuide: false }).sessionStartGuide).toBe(false)
  })

  it('keeps the startup-only field out of the native settings schema', () => {
    expect(MemorySettingsSchema.dict).not.toHaveProperty('sessionStartGuide')
  })

  it('keeps a custom system prompt and import roots', () => {
    const config = Config({ systemPrompt: 'custom guidance', importRoots: ['/srv/kilo'] })
    expect(config.systemPrompt).toBe('custom guidance')
    expect(config.importRoots).toEqual(['/srv/kilo'])
  })
})
