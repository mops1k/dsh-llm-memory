/**
 * The settings schema is the plugin's Loader config, so two contracts matter:
 * dsh's Settings UI exposes a field only when its schema is declared
 * `.volatile()`, and it renders schema *leaves* only — a nested object group is
 * never drawn (both facts verified against the running GUI on 2026-10-15). The
 * embedding fields are therefore flat and folded back into the core
 * configuration shape by `toMemoryConfig`. Cordis delivers volatile fields as
 * reactive wrappers, which the plugin unwraps at its boundary.
 */
import { describe, expect, it } from 'vitest'

import { DEFAULT_EMBEDDINGS, mergeConfig } from '@llm-memory/core/config'
import {
  MemoryPluginConfigSchema,
  MemorySettingsSchema,
  toMemoryConfig,
  unwrapSettings,
  type VolatileValue,
} from '../src/dsh/settings'

/** Structural view of a schemastery node: enough for the visibility mirror. */
interface SchemaNode {
  type?: string
  meta?: { volatile?: boolean }
  dict?: Record<string, SchemaNode>
}

/**
 * Mirror of `dsh-settings`' internal `volatileForm` rule: a leaf reaches the
 * generated Settings page only when it (or an ancestor) is volatile.
 */
function visibleFields(node: SchemaNode, prefix = ''): string[] {
  if (node.meta?.volatile) return prefix === '' ? [] : [prefix]
  if (node.type === 'object') {
    return Object.entries(node.dict ?? {}).flatMap(([key, child]) =>
      visibleFields(child, prefix === '' ? key : `${prefix}.${key}`),
    )
  }
  return []
}

/** Every leaf path of a schema, used as the expected Settings page contents. */
function leafPaths(node: SchemaNode, prefix = ''): string[] {
  if (node.dict !== undefined && Object.keys(node.dict).length > 0) {
    return Object.entries(node.dict).flatMap(([key, child]) =>
      leafPaths(child, prefix === '' ? key : `${prefix}.${key}`),
    )
  }
  return prefix === '' ? [] : [prefix]
}

/** A minimal stand-in for the reactive wrapper cordis delivers. */
function volatileOf<T>(value: T): VolatileValue<T> {
  return { get: () => value }
}

describe('memory settings schema', () => {
  it('exposes every field to the Settings page (all leaves are volatile)', () => {
    const schema = MemoryPluginConfigSchema as unknown as SchemaNode
    expect(visibleFields(schema)).toEqual(leafPaths(schema))
    expect(visibleFields(schema)).toContain('embeddingsProvider')
    expect(visibleFields(schema)).toContain('embeddingsPrewarm')
  })

  it('keeps the embedding fields flat, because a nested group is not rendered', () => {
    const settings = unwrapSettings(MemoryPluginConfigSchema({}))
    // The plugin enables the local provider even though the core default is off.
    expect(settings.embeddingsProvider).toBe('local')
    expect(settings.embeddingsModel).toBe(DEFAULT_EMBEDDINGS.model)
    expect(settings.embeddingsDim).toBe(DEFAULT_EMBEDDINGS.dim)
    expect(settings.embeddingsBackend).toBe(DEFAULT_EMBEDDINGS.backend)
    expect(settings.embeddingsPrewarm).toBe(DEFAULT_EMBEDDINGS.prewarm)
    expect(settings).not.toHaveProperty('embeddings')
  })

  it('folds the flat fields back into the core embeddings group', () => {
    const core = mergeConfig(toMemoryConfig(unwrapSettings(MemorySettingsSchema({}))))
    expect(core.embeddings.provider).toBe('local')
    expect(core.embeddings.model).toBe(DEFAULT_EMBEDDINGS.model)
    expect(core.embeddings.dim).toBe(DEFAULT_EMBEDDINGS.dim)
    expect(core.embeddings.chunkChars).toBe(DEFAULT_EMBEDDINGS.chunkChars)
  })

  it('applies a flat edit to the nested core field', () => {
    const settings = unwrapSettings(
      MemorySettingsSchema({ embeddingsBackend: 'sqlite-vec', embeddingsTopK: 80 }),
    )
    const core = mergeConfig(toMemoryConfig(settings))
    expect(core.embeddings.backend).toBe('sqlite-vec')
    expect(core.embeddings.topK).toBe(80)
    expect(core.embeddings.model).toBe(DEFAULT_EMBEDDINGS.model)
  })

  it('delivers volatile fields as reactive wrappers until they are unwrapped', () => {
    const raw = MemoryPluginConfigSchema({})
    expect(typeof (raw.recallLimit as unknown as VolatileValue<number>).get).toBe('function')
    expect(unwrapSettings(raw).recallLimit).toBe(
      (raw.recallLimit as unknown as VolatileValue<number>).get(),
    )
  })

  it('unwraps nested and array values without touching plain data', () => {
    expect(
      unwrapSettings({
        recallLimit: volatileOf(5),
        importRoots: [volatileOf('/mnt/c/memory'), '/opt/memory'],
        embeddingsProvider: volatileOf('local'),
        embeddingsDim: volatileOf(384),
      }),
    ).toEqual({
      recallLimit: 5,
      importRoots: ['/mnt/c/memory', '/opt/memory'],
      embeddingsProvider: 'local',
      embeddingsDim: 384,
    })
  })

  it('rejects an unknown embedding provider', () => {
    expect(() => MemorySettingsSchema({ embeddingsProvider: 'remote' })).toThrow()
  })
})
