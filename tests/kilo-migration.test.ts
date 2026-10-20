import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, describe, expect, it } from 'vitest'

import { migrateKiloStore } from '@llm-memory/adapter/kilo/migrate'
import { MemoryStore, newMemoryEntry } from '@llm-memory/core/infrastructure/store'

const temps: string[] = []
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function copyFixture(name: string): { db: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'llm-kilo-mig-'))
  temps.push(dir)
  const db = join(dir, name)
  copyFileSync(join(import.meta.dirname, 'fixtures', 'kilo', 'memory.db'), db)
  return { db, dir }
}

function tableExists(db: string, table: string): boolean {
  const handle = new DatabaseSync(db, { readOnly: true })
  try {
    return Boolean(handle.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(table))
  } finally {
    handle.close()
  }
}

describe('kilo store migration', () => {
  it('dry-run reports changes without touching the database', () => {
    const { db } = copyFixture('memory.db')
    const report = migrateKiloStore({ dbPath: db })
    expect(report.apply).toBe(false)
    expect(report.wouldAddColumns).toHaveLength(17)
    expect(report.addedColumns).toEqual([])
    expect(report.backupPath).toBeNull()
    expect(report.before).toEqual({ entries: 24, active: 20 })
    expect(tableExists(db, 'memory_revisions')).toBe(false)
  })

  it('applies the migration with a backup and keeps every row', () => {
    const { db, dir } = copyFixture('memory.db')
    const report = migrateKiloStore({ dbPath: db, apply: true, backupDir: join(dir, 'backups') })
    expect(report.addedColumns).toHaveLength(17)
    expect(report.createdIndexes).toHaveLength(3)
    expect(report.before).toEqual({ entries: 24, active: 20 })
    expect(report.after).toEqual(report.before)
    expect(report.integrityCheck).toBe('ok')
    expect(report.backupPath && existsSync(report.backupPath)).toBe(true)
    expect(tableExists(db, 'memory_revisions')).toBe(true)
  })

  it('is idempotent on a second apply', () => {
    const { db, dir } = copyFixture('memory.db')
    migrateKiloStore({ dbPath: db, apply: true, backupDir: join(dir, 'backups') })
    const again = migrateKiloStore({ dbPath: db, apply: true, backupDir: join(dir, 'backups') })
    expect(again.addedColumns).toEqual([])
    expect(again.createdIndexes).toEqual([])
    expect(again.after).toEqual({ entries: 24, active: 20 })
  })

  it('migrates a copy of the live Kilo store without losing records', () => {
    const live = '/mnt/c/Users/Kvintilyanov/.config/kilo/memory/db/memory.db'
    if (!existsSync(live)) return
    // Kilo may be running: a hot WAL on the Windows mount can fail with EIO.
    try {
      const probe = new DatabaseSync(live, { readOnly: true })
      probe.prepare('SELECT COUNT(*) FROM memories').get()
      probe.close()
    } catch (error) {
      if (/disk I\/O error|database is locked|SQLITE_BUSY/i.test(String(error))) return
      throw error
    }
    const dir = mkdtempSync(join(tmpdir(), 'llm-kilo-live-'))
    temps.push(dir)
    const db = join(dir, 'memory.db')
    copyFileSync(live, db)
    // Compare with the copy the migration actually reads: the live file can be
    // ahead of its WAL snapshot while Kilo is running, and a hot WAL must not
    // make the parity check flap.
    const source = new DatabaseSync(db, { readOnly: true })
    const expected = source.prepare("SELECT COUNT(*) AS entries, SUM(status='active') AS active FROM memories").get()
    source.close()
    const report = migrateKiloStore({ dbPath: db, apply: true, backupDir: join(dir, 'backups') })
    expect(report.after).toEqual(expected)
    expect(report.integrityCheck).toBe('ok')
  })

  it('accepts store writes after migration (origin is nullable)', () => {
    const { db } = copyFixture('memory.db')
    migrateKiloStore({ dbPath: db, apply: true })
    const store = new MemoryStore({ storageRoot: join(db, '..'), dbPath: db })
    store.open()
    try {
      const entry = newMemoryEntry({ text: 'post-migration write', scope: 'user', kind: 'facts' })
      expect(() => store.upsert(entry)).not.toThrow()
      expect(store.get(entry.id)?.text).toBe('post-migration write')
    } finally {
      store.close()
    }
  })
})
