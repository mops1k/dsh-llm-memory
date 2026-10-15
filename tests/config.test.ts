import { describe, expect, it } from 'vitest'

import { DEFAULT_CONFIG, DEFAULT_SYSTEM_PROMPT, mergeConfig } from '../src/core/config'

describe('mergeConfig', () => {
  it('returns the defaults for empty input', () => {
    const config = mergeConfig()
    expect(config).toEqual(DEFAULT_CONFIG)
    expect(config.recallLimit).toBe(10)
    expect(config.recallScope).toBe('project')
    expect(config.lintOverlapMinCommonWords).toBe(8)
    expect(config.lintMaxPairs).toBe(200)
    expect(config.autonomous).toBe(true)
    expect(config.requireConfirmation).toBe(false)
    expect(config.importAutoDetect).toBe(true)
    expect(config.webPath).toBe('/llm-memory')
    expect(config.importRoots).toEqual([])
    expect(config.systemPrompt).toBe(DEFAULT_SYSTEM_PROMPT)
    expect(config.sessionStartGuide).toBe(true)
    expect(config.projectScanBudgetMs).toBe(0)
    expect(config.promptRulesLimit).toBe(6)
    expect(config.rulesPromptScope).toBe('project')
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
      sessionStartGuide: false,
      projectScanBudgetMs: 250,
      promptRulesLimit: 0,
      rulesPromptScope: 'all',
    })
    expect(config.storageRoot).toBe('/tmp/memory')
    expect(config.recallLimit).toBe(1)
    expect(config.recallScope).toBe('user')
    expect(config.lintMaxPairs).toBe(0)
    expect(config.webPath).toBe('/memory')
    expect(config.importRoots).toEqual(['/a', '/b'])
    expect(config.systemPrompt).toBe(DEFAULT_SYSTEM_PROMPT)
    expect(config.sessionStartGuide).toBe(false)
    expect(config.projectScanBudgetMs).toBe(250)
    expect(config.promptRulesLimit).toBe(1)
    expect(config.rulesPromptScope).toBe('all')
  })

  it('keeps a custom system prompt and drops invalid scopes', () => {
    expect(mergeConfig({ systemPrompt: 'Custom guidance' }).systemPrompt).toBe('Custom guidance')
    expect(mergeConfig({ recallScope: 'nope' as never }).recallScope).toBe('project')
    expect(mergeConfig({ storageRoot: '   ' }).storageRoot).toBeUndefined()
  })

  it('keeps the scan budget non-negative and bounded', () => {
    expect(mergeConfig({ projectScanBudgetMs: -10 }).projectScanBudgetMs).toBe(0)
    expect(mergeConfig({ projectScanBudgetMs: 10_000_000 }).projectScanBudgetMs).toBe(600000)
    expect(mergeConfig({ projectScanBudgetMs: Number.NaN }).projectScanBudgetMs).toBe(0)
  })

  it('defaults and clamps the recall output budgets', () => {
    expect(mergeConfig({}).recallTextChars).toBe(400)
    expect(mergeConfig({}).recallTotalChars).toBe(12000)
    expect(mergeConfig({ recallTextChars: 0 }).recallTextChars).toBe(0)
    expect(mergeConfig({ recallTextChars: -5 }).recallTextChars).toBe(0)
    expect(mergeConfig({ recallTextChars: 50 }).recallTextChars).toBe(50)
    expect(mergeConfig({ recallTotalChars: 10 }).recallTotalChars).toBe(500)
    expect(mergeConfig({ recallTotalChars: Number.NaN }).recallTotalChars).toBe(12000)
  })
})
