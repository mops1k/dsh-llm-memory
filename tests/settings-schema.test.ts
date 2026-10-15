/**
 * The settings schema is the plugin's Loader config, so two contracts matter:
 * dsh's Settings UI exposes a field only when its schema is declared
 * `.volatile()` (otherwise the page is empty — the bug this file guards), and
 * cordis resolves those fields into reactive wrappers that the plugin must
 * unwrap before the core sees plain data. The nested `embeddings` group has to
 * survive both: resolve with defaults, accept partial edits and stay visible.
 */
import { describe, expect, it } from 'vitest'

import { DEFAULT_EMBEDDINGS } from '../src/core/config'
import {
  MemoryPluginConfigSchema,
  MemorySettingsSchema,
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
    expect(visibleFields(schema)).toContain('embeddings.provider')
    expect(visibleFields(schema)).toContain('embeddings.prewarm')
  })

  it('resolves the nested embeddings group from an empty patch', () => {
    const resolved = unwrapSettings(MemoryPluginConfigSchema({}))
    // The plugin enables the local provider even though the core default is off.
    expect(resolved.embeddings.provider).toBe('local')
    expect(resolved.embeddings.model).toBe(DEFAULT_EMBEDDINGS.model)
    expect(resolved.embeddings.dim).toBe(DEFAULT_EMBEDDINGS.dim)
    expect(resolved.embeddings.backend).toBe(DEFAULT_EMBEDDINGS.backend)
    expect(resolved.embeddings.prewarm).toBe(DEFAULT_EMBEDDINGS.prewarm)
  })

  it('delivers volatile fields as reactive wrappers until they are unwrapped', () => {
    const raw = MemoryPluginConfigSchema({})
    expect(typeof (raw.recallLimit as unknown as VolatileValue<number>).get).toBe('function')
    expect(unwrapSettings(raw).recallLimit).toBe(
      (raw.recallLimit as unknown as VolatileValue<number>).get(),
    )
  })

  it('keeps edits inside the nested group and fills the rest with defaults', () => {
    const resolved = unwrapSettings(
      MemorySettingsSchema({ embeddings: { backend: 'sqlite-vec', topK: 80 } }),
    )
    expect(resolved.embeddings.backend).toBe('sqlite-vec')
    expect(resolved.embeddings.topK).toBe(80)
    expect(resolved.embeddings.model).toBe(DEFAULT_EMBEDDINGS.model)
    expect(resolved.embeddings.chunkChars).toBe(DEFAULT_EMBEDDINGS.chunkChars)
  })

  it('unwraps nested and array values without touching plain data', () => {
    expect(
      unwrapSettings({
        recallLimit: volatileOf(5),
        importRoots: [volatileOf('/mnt/c/memory'), '/opt/memory'],
        embeddings: { provider: volatileOf('local'), dim: volatileOf(384) },
      }),
    ).toEqual({
      recallLimit: 5,
      importRoots: ['/mnt/c/memory', '/opt/memory'],
      embeddings: { provider: 'local', dim: 384 },
    })
  })

  it('rejects an unknown embedding provider', () => {
    expect(() => MemorySettingsSchema({ embeddings: { provider: 'remote' } })).toThrow()
  })
})
