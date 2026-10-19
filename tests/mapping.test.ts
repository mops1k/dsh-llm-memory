import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { describe, expect, it } from 'vitest'

import {
  entryFromDshRow,
  entryFromKiloRow,
  entryToDshRow,
  entryToKiloRow,
  normalizeScope,
} from '@llm-memory/core/domain/mapping'
import type { MemoryEntry } from '@llm-memory/core/domain/types'

const FIXTURE = join(import.meta.dirname, 'fixtures', 'kilo', 'memory.db')

function rows(where: string): Record<string, unknown>[] {
  const db = new DatabaseSync(FIXTURE, { readOnly: true })
  try {
    return db.prepare(`SELECT * FROM memories WHERE ${where} LIMIT 1`).all() as Record<string, unknown>[]
  } finally {
    db.close()
  }
}

describe('field mapping', () => {
  it('maps a Kilo global row into the canonical entry without losing Kilo fields', () => {
    const row = rows("scope = 'global'")[0]
    expect(row).toBeDefined()
    const entry = entryFromKiloRow(row!)
    expect(entry.origin).toBe('kilo')
    expect(entry.scope).toBe('user')
    expect(entry.text).toBe(String(row!['content']))
    expect(entry.consolidation).toBe(row!['consolidation'])
    expect(entry.accessCount).toBe(row!['accessCount'])
    expect(entry.lastAccess).toBe(row!['lastAccess'])
    expect(Array.isArray(entry.supersededBy)).toBe(true)
    expect(entry.extra).toBeUndefined()
  })

  it('maps a Kilo project row and derives the project key from project_root', () => {
    const row = rows("scope = 'project'")[0]
    const entry = entryFromKiloRow(row!)
    expect(entry.scope).toBe('project')
    expect(['proj-a', 'proj-b']).toContain(entry.project)
  })

  it('keeps unknown columns in extra', () => {
    const entry = entryFromKiloRow({ id: 'm_1', scope: 'global', kind: 'facts', content: 'x', mystery: 42 })
    expect(entry.extra).toEqual({ mystery: 42 })
  })

  it('round-trips a canonical entry through Kilo columns', () => {
    const original: MemoryEntry = entryFromKiloRow(rows("scope = 'global'")[0]!)
    const back = entryFromKiloRow(entryToKiloRow(original))
    expect(back.id).toBe(original.id)
    expect(back.text).toBe(original.text)
    expect(back.consolidation).toBe(original.consolidation)
    expect(back.accessCount).toBe(original.accessCount)
    expect(back.tier).toBe(original.tier)
  })

  it('maps DSH snake_case rows (ext_key, superseded_by) and keeps text', () => {
    const entry = entryFromDshRow({
      id: 'm_0000000000aa',
      scope: 'project',
      project: 'proj-a',
      kind: 'rules',
      tier: 'important',
      status: 'active',
      title: 'dsH row',
      text: 'тело записи',
      tags: '["a","b"]',
      keywords: 'kw',
      importance: 4,
      source: 'user',
      supersedes: '[]',
      superseded_by: '["m_0000000000ab"]',
      related: '[]',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-02T00:00:00.000Z',
      ext_key: 'kilo:m_0000000000aa',
      unknown_column: 'kept',
    })
    expect(entry.origin).toBe('dsh')
    expect(entry.text).toBe('тело записи')
    expect(entry.extKey).toBe('kilo:m_0000000000aa')
    expect(entry.supersededBy).toEqual(['m_0000000000ab'])
    expect(entry.createdAt).toBe('2026-01-01T00:00:00.000Z')
    expect(entry.extra).toMatchObject({ unknown_column: 'kept' })
    const back = entryFromDshRow(entryToDshRow(entry))
    expect(back.text).toBe(entry.text)
    expect(back.extKey).toBe(entry.extKey)
  })

  it('normalizes scopes: global is the Kilo name of the user layer', () => {
    expect(normalizeScope('global')).toBe('user')
    expect(normalizeScope('user')).toBe('user')
    expect(normalizeScope('project')).toBe('project')
    expect(normalizeScope(undefined)).toBe('user')
  })
})
