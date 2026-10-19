import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  DEFAULT_SYNC_CONFIG,
  ensureRevisionsTable,
  NullSync,
  type SyncOperation,
} from '@llm-memory/core/sync/index'

const temps: string[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), 'llm-sync-'))
  temps.push(dir)
  const target = join(dir, 'memory.db')
  copyFileSync(join(import.meta.dirname, 'fixtures', 'kilo', 'memory.db'), target)
  return target
}

describe('sync groundwork', () => {
  it('is disabled by default and has a no-op transport', async () => {
    expect(DEFAULT_SYNC_CONFIG).toEqual({ enabled: false, team: null, remote: null })
    const sync = new NullSync()
    expect(sync.capabilities()).toEqual({ name: 'null', push: false, pull: false })
    const page = await sync.pull(null)
    expect(page).toEqual({ cursor: null, operations: [] })
    const op: SyncOperation = {
      entryId: 'm_1',
      revision: 1,
      op: 'upsert',
      actor: 'test',
      deviceId: 'dev',
      createdAt: '2026-01-01T00:00:00.000Z',
      payloadHash: 'hash',
    }
    expect(await sync.push([op])).toEqual({ accepted: [], rejected: [] })
  })

  it('never touches the network', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('network must not be used')
    })
    const sync = new NullSync()
    await sync.pull('cursor')
    await sync.push([])
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('creates memory_revisions idempotently', () => {
    const path = tempDb()
    const db = new DatabaseSync(path)
    try {
      ensureRevisionsTable(db)
      ensureRevisionsTable(db)
      const columns = (db.prepare('PRAGMA table_info(memory_revisions)').all() as { name: string }[]).map(row => row.name)
      expect(columns).toEqual([
        'entry_id', 'revision', 'op', 'base_revision', 'actor', 'device_id', 'created_at', 'payload_hash',
      ])
      const pk = (db.prepare('PRAGMA table_info(memory_revisions)').all() as { name: string; pk: number }[])
        .filter(row => row.pk > 0)
        .map(row => row.name)
      expect(pk).toEqual(['entry_id', 'revision'])
      expect(db.prepare('SELECT COUNT(*) AS n FROM memory_revisions').get()).toEqual({ n: 0 })
    } finally {
      db.close()
    }
  })
})
