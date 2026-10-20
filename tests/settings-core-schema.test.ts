import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '@llm-memory/core/domain/config.js'
import {
  SETTINGS_ACTIONS,
  SETTINGS_GROUPS,
  readSettingValue,
  settingsFieldPaths,
  writeSettingValue,
} from '@llm-memory/core/domain/settings-schema.js'

/** Leaf paths of a config object: arrays and records count as leaves. */
function flatten(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return prefix === '' ? [] : [prefix]
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length === 0) return prefix === '' ? [] : [prefix]
  return entries.flatMap(([key, child]) => {
    const path = prefix === '' ? key : `${prefix}.${key}`
    if (child !== null && typeof child === 'object' && !Array.isArray(child)) return flatten(child, path)
    return [path]
  })
}

describe('core settings schema', () => {
  it('covers every key of the core configuration', () => {
    const declared = new Set(settingsFieldPaths())
    const missing = flatten(DEFAULT_CONFIG).filter(path => !declared.has(path))
    expect(missing).toEqual([])
  })

  it('declares no path that the core configuration does not have', () => {
    const known = new Set(flatten(DEFAULT_CONFIG))
    const unknown = settingsFieldPaths().filter(path => !known.has(path))
    expect(unknown).toEqual([])
  })

  it('keeps paths unique and labels/hints filled', () => {
    const paths = settingsFieldPaths()
    expect(new Set(paths).size).toBe(paths.length)
    for (const group of SETTINGS_GROUPS) {
      expect(group.id.length).toBeGreaterThan(0)
      expect(group.title.length).toBeGreaterThan(0)
      for (const field of group.fields) {
        expect(field.label.length).toBeGreaterThan(0)
        expect(field.hint.length).toBeGreaterThan(0)
        if (field.type === 'select') expect(field.options?.length ?? 0).toBeGreaterThan(1)
      }
    }
  })

  it('declares every option value of the core unions', () => {
    const values = (path: string): string[] =>
      SETTINGS_GROUPS.flatMap(group => group.fields)
        .find(field => field.path === path)
        ?.options?.map(option => option.value) ?? []
    expect(values('embeddings.provider')).toEqual(['off', 'local', 'http'])
    expect(values('embeddings.backend')).toEqual(['off', 'js', 'sqlite-vec'])
    expect(values('embeddings.quantization')).toEqual(['float', 'int8', 'bit'])
    expect(values('recallScope')).toEqual(['project', 'user', 'all'])
    expect(values('rulesPromptScope')).toEqual(['project', 'all'])
  })
})

describe('core settings actions', () => {
  it('has unique ids, filled labels and confirmation words for dangerous writes', () => {
    const ids = SETTINGS_ACTIONS.map(action => action.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const action of SETTINGS_ACTIONS) {
      expect(action.label.length).toBeGreaterThan(0)
      if (action.danger === true) {
        expect(action.confirm?.length ?? 0).toBeGreaterThan(0)
        expect(action.mode).toBe('write')
      }
    }
  })

  it('covers the backup, model and maintenance actions every panel must expose', () => {
    const ids = new Set(SETTINGS_ACTIONS.map(action => action.id))
    for (const required of [
      'backup.list',
      'backup.create',
      'backup.verify',
      'backup.restore',
      'backup.delete',
      'model.status',
      'model.download',
      'model.remove',
      'lint.run',
      'heal.report',
      'heal.apply',
      'vectors.rebuild',
      'vectors.health',
      'import.run',
    ]) {
      expect(ids.has(required)).toBe(true)
    }
  })
})

describe('settings helpers', () => {
  it('reads and writes dotted paths, creating intermediate objects', () => {
    const patch: Record<string, unknown> = {}
    writeSettingValue(patch, 'embeddings.model', 'e5')
    writeSettingValue(patch, 'recallLimit', 5)
    expect(patch).toEqual({ embeddings: { model: 'e5' }, recallLimit: 5 })
    expect(readSettingValue(patch, 'embeddings.model')).toBe('e5')
    expect(readSettingValue(patch, 'missing.path')).toBeUndefined()
  })
})
