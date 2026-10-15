/**
 * Recall output format: the setting decides what the agent gets when it does not
 * ask for a format, and can pin it outright. The list lived in kilo-memory as
 * `defaultRecallFormat`; the port to dsh dropped it, so recall silently stayed on
 * markdown whatever the user wanted (16.10.2026).
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { DEFAULT_CONFIG, mergeConfig } from '../src/core/config'
import { MemoryEngine } from '../src/core/engine'

const roots: string[] = []

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'llm-memory-format-'))
  roots.push(root)
  return root
}

function makeEngine(config: Record<string, unknown> = {}): MemoryEngine {
  const engine = new MemoryEngine({ storageRoot: makeRoot(), project: 'demo', config })
  engine.save({ title: 'Нужный факт', text: 'Здесь есть слово needle и пояснение к нему.' })
  return engine
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('recall format setting', () => {
  it('defaults to markdown and lets the agent ask for another format', async () => {
    expect(DEFAULT_CONFIG.recallFormat).toBe('markdown')
    expect(DEFAULT_CONFIG.recallAllowFormatOverride).toBe(true)

    const engine = makeEngine()
    expect((await engine.recall('needle')).format).toBe('markdown')
    expect((await engine.recall('needle', { format: 'json' })).format).toBe('json')
  })

  it('uses the configured format when the agent does not ask for one', async () => {
    const engine = makeEngine({ recallFormat: 'table' })
    const result = await engine.recall('needle')
    expect(result.format).toBe('table')
    expect(result.text.split('\n')[0]).toContain('|')
  })

  it('pins the format when overrides are switched off', async () => {
    const engine = makeEngine({ recallFormat: 'timeline', recallAllowFormatOverride: false })
    const result = await engine.recall('needle', { format: 'json' })
    expect(result.format).toBe('timeline')
    // A pinned format still renders: the caller gets the timeline, not an error.
    expect(result.text).toContain('Нужный факт')
    expect(result.items.length).toBeGreaterThan(0)
  })

  it('falls back to markdown on an unknown stored value', () => {
    const merged = mergeConfig({ recallFormat: 'yaml', recallAllowFormatOverride: 'yes' } as never)
    expect(merged.recallFormat).toBe('markdown')
    expect(merged.recallAllowFormatOverride).toBe(true)
  })
})
