/**
 * The settings schema is the plugin's Loader config, so a nested group that the
 * schema library cannot resolve would leave every embedding field undefined at
 * runtime. These tests resolve the schema the way dsh does and check that the
 * nested `embeddings` group keeps its defaults and accepts partial edits.
 */
import { describe, expect, it } from 'vitest'

import { DEFAULT_EMBEDDINGS } from '../src/core/config'
import { MemoryPluginConfigSchema, MemorySettingsSchema } from '../src/dsh/settings'

describe('memory settings schema', () => {
  it('resolves the nested embeddings group from an empty patch', () => {
    const resolved = MemoryPluginConfigSchema({})
    // The plugin enables the local provider even though the core default is off.
    expect(resolved.embeddings.provider).toBe('local')
    expect(resolved.embeddings.model).toBe(DEFAULT_EMBEDDINGS.model)
    expect(resolved.embeddings.dim).toBe(DEFAULT_EMBEDDINGS.dim)
    expect(resolved.embeddings.backend).toBe(DEFAULT_EMBEDDINGS.backend)
    expect(resolved.embeddings.prewarm).toBe(DEFAULT_EMBEDDINGS.prewarm)
  })

  it('keeps edits inside the nested group and fills the rest with defaults', () => {
    const resolved = MemorySettingsSchema({ embeddings: { backend: 'sqlite-vec', topK: 80 } })
    expect(resolved.embeddings.backend).toBe('sqlite-vec')
    expect(resolved.embeddings.topK).toBe(80)
    expect(resolved.embeddings.model).toBe(DEFAULT_EMBEDDINGS.model)
    expect(resolved.embeddings.chunkChars).toBe(DEFAULT_EMBEDDINGS.chunkChars)
  })

  it('rejects an unknown embedding provider', () => {
    expect(() => MemorySettingsSchema({ embeddings: { provider: 'remote' } })).toThrow()
  })
})
