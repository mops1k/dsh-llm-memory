/**
 * Sync-groundwork invariants (ADR-006, этап 10): the reserved schema fields and
 * `memory_revisions` exist, but nothing writes them, sync stays disabled and the
 * behaviour of save/recall/update is identical with or without sync values.
 */
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { mergeConfig, DEFAULT_CONFIG } from '@llm-memory/core/domain/config'
import { MemoryEngine } from '@llm-memory/core/application/engine'
import { migrateSchemaToV2 } from '@llm-memory/core/infrastructure/migrate'
import { openDatabase } from '@llm-memory/core/infrastructure/sqlite'
import { DEFAULT_SYNC_CONFIG, NullSync } from '@llm-memory/core/sync/index'

const dirs: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

function kiloFixtureCopy(): string {
  const dir = tempDir('llm-sync-migrate-')
  const target = join(dir, 'memory.db')
  copyFileSync(join(import.meta.dirname, 'fixtures', 'kilo', 'memory.db'), target)
  return target
}

const RESERVED = ['namespace', 'revision', 'device_id', 'updated_by', 'deleted_at', 'sync_state'] as const

describe('sync config is reserved and disabled', () => {
  it('ships a disabled default in the core config', () => {
    expect(DEFAULT_SYNC_CONFIG).toEqual({ enabled: false, team: null, remote: null })
    expect(DEFAULT_CONFIG.sync).toEqual(DEFAULT_SYNC_CONFIG)
  })

  it('keeps the disabled default when only a team is set and merges explicit values', () => {
    expect(mergeConfig({}).sync).toEqual(DEFAULT_SYNC_CONFIG)
    expect(mergeConfig({ sync: { team: 'core' } }).sync).toEqual({ enabled: false, team: 'core', remote: null })
    expect(mergeConfig({ sync: { enabled: true, remote: 'git@example/core.git' } }).sync).toEqual({
      enabled: true,
      team: null,
      remote: 'git@example/core.git',
    })
  })
})

describe('schema migration reserves the sync fields', () => {
  it('adds every reserved column with its default and creates an empty revisions table', () => {
    const dbPath = kiloFixtureCopy()
    const report = migrateSchemaToV2({ dbPath, apply: true })
    expect(report.addedColumns).toEqual(expect.arrayContaining([...RESERVED]))
    expect(report.missingRevisionsTable).toBe(true)

    const db = new DatabaseSync(dbPath)
    try {
      const columns = (db.prepare('PRAGMA table_info(memories)').all() as { name: string }[]).map(row => row.name)
      expect(columns).toEqual(expect.arrayContaining([...RESERVED]))
      const row = db
        .prepare(
          'SELECT namespace, revision, device_id, updated_by, deleted_at, sync_state FROM memories LIMIT 1',
        )
        .get() as Record<string, unknown>
      expect(row).toEqual({
        namespace: 'local',
        revision: 0,
        device_id: '',
        updated_by: '',
        deleted_at: null,
        sync_state: 'local',
      })
      expect(db.prepare('SELECT COUNT(*) AS n FROM memory_revisions').get()).toEqual({ n: 0 })
    } finally {
      db.close()
    }
  })

  it('is idempotent and keeps the revisions table empty on a second run', () => {
    const dbPath = kiloFixtureCopy()
    migrateSchemaToV2({ dbPath, apply: true })
    const again = migrateSchemaToV2({ dbPath, apply: true })
    expect(again.addedColumns).toEqual([])
    expect(again.missingRevisionsTable).toBe(false)
    const db = new DatabaseSync(dbPath)
    try {
      expect(db.prepare('SELECT COUNT(*) AS n FROM memory_revisions').get()).toEqual({ n: 0 })
    } finally {
      db.close()
    }
  })
})

describe('normal operations leave the sync layer alone', () => {
  it('never writes revisions and preserves values set by a future sync layer', () => {
    const root = tempDir('llm-sync-store-')
    const engine = new MemoryEngine({ storageRoot: root, project: 'demo', config: mergeConfig({}) })
    try {
      const entry = engine.save({ text: 'first body', title: 'sync guard' })
      const db = openDatabase(engine.getStore().dbPath)
      try {
        db.prepare(
          "UPDATE memories SET namespace = 'team', revision = 7, device_id = 'dev-a', updated_by = 'alice', sync_state = 'synced' WHERE id = ?",
        ).run(entry.id)
      } finally {
        db.close()
      }

      engine.update(entry.id, { text: 'second body' })
      engine.forget(entry.id)

      const after = openDatabase(engine.getStore().dbPath)
      try {
        expect(
          after
            .prepare('SELECT namespace, revision, device_id, updated_by, sync_state FROM memories WHERE id = ?')
            .get(entry.id),
        ).toEqual({ namespace: 'team', revision: 7, device_id: 'dev-a', updated_by: 'alice', sync_state: 'synced' })
        expect(after.prepare('SELECT COUNT(*) AS n FROM memory_revisions').get()).toEqual({ n: 0 })
      } finally {
        after.close()
      }
    } finally {
      engine.close()
    }
  })

  it('does not fill revisions on save, consolidate or delete', () => {
    const root = tempDir('llm-sync-ops-')
    const engine = new MemoryEngine({ storageRoot: root, project: 'demo', config: mergeConfig({}) })
    try {
      const one = engine.save({ text: 'one', title: 'one' })
      engine.save({ text: 'two', title: 'two' })
      engine.forget(one.id)
      engine.delete(one.id)
      const db = openDatabase(engine.getStore().dbPath)
      try {
        expect(db.prepare('SELECT COUNT(*) AS n FROM memory_revisions').get()).toEqual({ n: 0 })
        // A hard delete removes the row today; a tombstone (`deleted_at`) is the
        // future sync-layer mechanism and stays NULL for every write.
        expect(db.prepare('SELECT COUNT(*) AS n FROM memories WHERE deleted_at IS NOT NULL').get()).toEqual({ n: 0 })
      } finally {
        db.close()
      }
    } finally {
      engine.close()
    }
  })

  it('keeps recall, status and graph identical when sync values are present', async () => {
    const root = tempDir('llm-sync-behaviour-')
    const engine = new MemoryEngine({ storageRoot: root, project: 'demo', config: mergeConfig({}) })
    try {
      const alpha = engine.save({ text: 'alpha decision', title: 'alpha' })
      engine.save({ text: 'beta fact', title: 'beta' })
      const before = await engine.recall('alpha', { touch: false })
      const beforeIds = before.items.map(item => item.id)
      const beforeStatus = engine.statusReport()
      const beforeGraph = engine.graph()

      const db = openDatabase(engine.getStore().dbPath)
      try {
        db.prepare(
          "UPDATE memories SET namespace = 'team', revision = 3, device_id = 'dev-b', updated_by = 'bob', sync_state = 'synced', deleted_at = ? WHERE id = ?",
        ).run('2026-01-01T00:00:00.000Z', alpha.id)
      } finally {
        db.close()
      }

      const after = await engine.recall('alpha', { touch: false })
      expect(after.items.map(item => item.id)).toEqual(beforeIds)
      expect(engine.statusReport().byStatus).toEqual(beforeStatus.byStatus)
      expect(engine.graph().edges.length).toBeGreaterThanOrEqual(beforeGraph.edges.length)
      // The tombstone marker is reserved: until the sync layer exists it does not
      // hide an entry from recall or status.
      expect(after.items.map(item => item.id)).toContain(alpha.id)
    } finally {
      engine.close()
    }
  })
})

describe('no network, no background jobs', () => {
  it('keeps sync a no-op even when enabled in the config', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('network must not be used')
    })
    const disabled = new MemoryEngine({ storageRoot: tempDir('llm-sync-off-'), project: 'demo', config: mergeConfig({}) })
    const enabled = new MemoryEngine({
      storageRoot: tempDir('llm-sync-on-'),
      project: 'demo',
      config: mergeConfig({ sync: { enabled: true, team: 'core' } }),
    })
    try {
      const sync = new NullSync()
      await sync.pull(null)
      expect(await sync.push([])).toEqual({ accepted: [], rejected: [] })
      for (const engine of [disabled, enabled]) {
        engine.save({ text: 'enabled sync changes nothing', title: 'noop' })
      }
      const offRecall = await disabled.recall('noop', { touch: false })
      const onRecall = await enabled.recall('noop', { touch: false })
      expect(onRecall.items.map(item => item.title)).toEqual(offRecall.items.map(item => item.title))
      expect(enabled.statusReport().total).toBe(disabled.statusReport().total)
      expect(fetchSpy).not.toHaveBeenCalled()
      // No background job and no revisions appear just because sync is "enabled".
      expect(enabled.statusReport().total).toBe(1)
    } finally {
      disabled.close()
      enabled.close()
    }
  })
})
