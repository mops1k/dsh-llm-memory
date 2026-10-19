import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, describe, expect, it } from 'vitest'

import { ensureSchemaV2, SCHEMA_V2_COLUMNS } from '@llm-memory/core/infrastructure/schema'

const temps: string[] = []
function tempDb(source: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'llm-schema-'))
  temps.push(dir)
  const target = join(dir, 'memory.db')
  copyFileSync(source, target)
  return target
}
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function counts(db: DatabaseSync): Record<string, unknown> {
  return db.prepare("SELECT COUNT(*) AS entries, SUM(status='active') AS active FROM memories").get() as Record<string, unknown>
}

function migrate(path: string) {
  const db = new DatabaseSync(path)
  try {
    return { first: ensureSchemaV2(db), second: ensureSchemaV2(db), counts: counts(db) }
  } finally {
    db.close()
  }
}

const FIXTURE = join(import.meta.dirname, 'fixtures', 'kilo', 'memory.db')

describe('schema v2 migration', () => {
  it('adds every column once and is idempotent on the Kilo fixture', () => {
    const path = tempDb(FIXTURE)
    const { first, second, counts: after } = migrate(path)
    expect(first.addedColumns).toEqual(SCHEMA_V2_COLUMNS.map(column => column.name))
    expect(first.createdIndexes.length).toBe(3)
    expect(second.addedColumns).toEqual([])
    expect(second.createdIndexes).toEqual([])
    expect(after).toEqual({ entries: 24, active: 20 })
    const db = new DatabaseSync(path, { readOnly: true })
    try {
      expect(db.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' })
      const names = (db.prepare('PRAGMA table_info(memories)').all() as { name: string }[]).map(row => row.name)
      for (const column of SCHEMA_V2_COLUMNS) expect(names).toContain(column.name)
    } finally {
      db.close()
    }
  })

  it('keeps ids, timestamps and Kilo fields untouched', () => {
    const path = tempDb(FIXTURE)
    const before = new DatabaseSync(path, { readOnly: true })
    const original = before
      .prepare("SELECT id, title, consolidation, accessCount, lastAccess, createdAt, updatedAt FROM memories WHERE scope='project' LIMIT 1")
      .get()
    before.close()
    migrate(path)
    const after = new DatabaseSync(path, { readOnly: true })
    const migrated = after
      .prepare("SELECT id, title, consolidation, accessCount, lastAccess, createdAt, updatedAt FROM memories WHERE scope='project' LIMIT 1")
      .get()
    after.close()
    expect(migrated).toEqual(original)
  })

  it('migrates a copy of the live Kilo store without losing records', () => {
    const live = '/mnt/c/Users/Kvintilyanov/.config/kilo/memory/db/memory.db'
    if (!existsSync(live)) return // host without the Windows mount
    const source = new DatabaseSync(live, { readOnly: true })
    const expected = source.prepare("SELECT COUNT(*) AS entries, SUM(status='active') AS active FROM memories").get()
    source.close()
    const path = tempDb(live)
    const { first, second, counts: after } = migrate(path)
    expect(first.addedColumns.length).toBe(SCHEMA_V2_COLUMNS.length)
    expect(second.addedColumns).toEqual([])
    expect(after).toEqual(expected)
  })
})
