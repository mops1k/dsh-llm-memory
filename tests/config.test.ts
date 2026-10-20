import { describe, expect, it } from 'vitest'

import { DEFAULT_CONFIG, DEFAULT_EMBEDDINGS, DEFAULT_SYSTEM_PROMPT, mergeConfig } from '@llm-memory/core/domain/config'

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
    expect(config.webPath).toBe('/llm-memory')
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

  it('defaults the embedding section', () => {
    const embeddings = mergeConfig({}).embeddings
    expect(embeddings).toEqual(DEFAULT_EMBEDDINGS)
    // The core stays inert: a bare engine must not download a model. The dsh
    // settings schema turns the local provider on for the plugin.
    expect(embeddings.provider).toBe('off')
    expect(embeddings.model).toBe('Xenova/multilingual-e5-small')
    expect(embeddings.dim).toBe(384)
    expect(embeddings.backend).toBe('js')
    expect(embeddings.topK).toBe(50)
    expect(embeddings.batchSize).toBe(16)
    expect(embeddings.minScore).toBe(0)
    expect(embeddings.prewarm).toBe(true)
  })

  it('validates a partial embedding section field by field', () => {
    const embeddings = mergeConfig({
      embeddings: {
        provider: 'nope',
        model: '   ',
        dim: 0,
        backend: 'sqlite-vec',
        topK: 100000,
        minScore: 5,
        batchSize: 0,
        chunkChars: 400,
        chunkOverlap: 900,
      } as never,
    }).embeddings
    // An unknown provider falls back to the core default…
    expect(embeddings.provider).toBe('off')
    // …while an explicit valid one survives.
    expect(mergeConfig({ embeddings: { provider: 'local' } }).embeddings.provider).toBe('local')
    expect(embeddings.model).toBe(DEFAULT_EMBEDDINGS.model)
    expect(embeddings.dim).toBe(64)
    expect(embeddings.backend).toBe('sqlite-vec')
    expect(embeddings.topK).toBe(1000)
    expect(embeddings.minScore).toBe(1)
    expect(embeddings.batchSize).toBe(1)
    // An overlap at or above the chunk size would never advance the chunker.
    expect(embeddings.chunkOverlap).toBe(200)
  })

  it('drops a malformed embedding section', () => {
    expect(mergeConfig({ embeddings: 'local' as never }).embeddings).toEqual(DEFAULT_EMBEDDINGS)
    expect(mergeConfig({ embeddings: null as never }).embeddings).toEqual(DEFAULT_EMBEDDINGS)
  })
})
