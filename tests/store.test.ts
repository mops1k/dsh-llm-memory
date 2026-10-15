import { existsSync, statSync, utimesSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { pageToText } from '../src/core/frontmatter'
import { entryFilePath, removeFileIfExists, writeFileAtomic } from '../src/core/paths'
import { MemoryStore, newMemoryEntry } from '../src/core/store'
import { cleanupRoot, makeTempRoot } from './helpers'

let root: string
let store: MemoryStore

beforeEach(() => {
  root = makeTempRoot()
  store = new MemoryStore({ storageRoot: root })
})

afterEach(() => {
  store.close()
  cleanupRoot(root)
})

describe('MemoryStore', () => {
  it('writes markdown and reads the entry back', () => {
    const entry = newMemoryEntry({
      id: 'm_save1',
      scope: 'project',
      project: 'proj',
      kind: 'facts',
      title: 'Alpha fact',
      text: 'Alpha body',
      tags: ['a', 'b'],
      importance: 4,
    })
    store.upsert(entry)

    expect(existsSync(entryFilePath(store.root, entry))).toBe(true)
    expect(store.get('m_save1')).toMatchObject({
      id: 'm_save1',
      project: 'proj',
      kind: 'facts',
      title: 'Alpha fact',
      text: 'Alpha body',
      importance: 4,
      tags: ['a', 'b'],
    })
  })

  it('rebuilds the index from disk when the database is empty', () => {
    const entry = newMemoryEntry({ id: 'm_disk1', project: 'proj2', title: 'From disk', text: 'persisted' })
    writeFileAtomic(entryFilePath(root, entry), pageToText(entry))

    const fresh = new MemoryStore({ storageRoot: root })
    try {
      expect(fresh.get('m_disk1')?.text).toBe('persisted')
    } finally {
      fresh.close()
    }
  })

  it('indexes user-scope pages with the derived scope and project', () => {
    const entry = newMemoryEntry({ id: 'm_user1', scope: 'user', title: 'Global note', text: 'cross project' })
    writeFileAtomic(entryFilePath(root, entry), pageToText(entry))

    expect(store.reindexFromDisk()).toBe(1)
    expect(store.get('m_user1')).toMatchObject({ scope: 'user', project: '', text: 'cross project' })
  })

  it('deletes markdown and the index row', () => {
    const entry = newMemoryEntry({ id: 'm_del1', title: 'Delete me', text: 'temp' })
    store.upsert(entry)
    const file = entryFilePath(store.root, entry)
    expect(existsSync(file)).toBe(true)

    expect(store.delete('m_del1')).toBe(true)
    expect(store.get('m_del1')).toBeNull()
    expect(existsSync(file)).toBe(false)
    expect(store.delete('m_del1')).toBe(false)
  })

  it('searches with FTS5 and falls back to LIKE for substrings', () => {
    store.upsert(newMemoryEntry({ id: 'm_text1', title: 'Device', text: 'The extraordinary device' }))

    expect(store.search('extraordinary').map((entry) => entry.id)).toContain('m_text1')
    expect(store.search('ordinary').map((entry) => entry.id)).toContain('m_text1')
    expect(store.search('zzzmissingzzz')).toEqual([])
  })

  it('applies filters, pagination and sorting', () => {
    store.upsert(newMemoryEntry({ id: 'm_f1', kind: 'facts', title: 'Fact high', text: 'shared word', importance: 5, tags: ['tagx'] }))
    store.upsert(newMemoryEntry({ id: 'm_f2', kind: 'rules', title: 'Rule low', text: 'shared word', importance: 1 }))
    store.upsert(
      newMemoryEntry({ id: 'm_f3', kind: 'facts', title: 'Fact old', text: 'shared word', importance: 3, status: 'superseded' }),
    )

    expect(store.list().total).toBe(3)
    expect(store.list({ kind: 'facts' }).total).toBe(2)
    expect(store.list({ status: 'active' }).items.map((entry) => entry.id)).not.toContain('m_f3')
    expect(store.list({ tag: 'tagx' }).items.map((entry) => entry.id)).toEqual(['m_f1'])
    expect(store.list({ limit: 1 }).items).toHaveLength(1)
    expect(store.list({ limit: 1, offset: 1 }).items).toHaveLength(1)
    expect(store.list({ sort: 'importance' }).items[0]?.id).toBe('m_f1')
  })

  it('keeps ext_key imports idempotent', () => {
    const first = store.upsert(newMemoryEntry({ id: 'm_ext_a', extKey: 'kilo:1', title: 'First', text: 'one' }))
    const second = store.upsert(newMemoryEntry({ id: 'm_ext_b', extKey: 'kilo:1', title: 'Updated', text: 'two' }))

    expect(first.id).toBe('m_ext_a')
    expect(second.id).toBe('m_ext_a')
    expect(store.allIds()).toEqual(['m_ext_a'])
    expect(store.getByExtKey('kilo:1')?.text).toBe('two')
  })

  it('reopens the same database without rebuilding', () => {
    store.upsert(newMemoryEntry({ id: 'm_reopen', title: 'Persisted', text: 'kept' }))
    store.close()

    const reopened = new MemoryStore({ storageRoot: root })
    try {
      expect(reopened.get('m_reopen')?.text).toBe('kept')
      expect(reopened.hasFts).toBe(true)
    } finally {
      reopened.close()
    }
  })

  it('drops rows whose page is gone after a manual reindex', () => {
    const entry = newMemoryEntry({ id: 'm_stale', title: 'Stale', text: 'gone from disk' })
    store.upsert(entry)
    const file = entryFilePath(store.root, entry)
    expect(existsSync(file)).toBe(true)

    removeFileIfExists(file)
    store.reindexFromDisk()

    expect(store.get('m_stale')).toBeNull()
    expect(store.allIds()).not.toContain('m_stale')
  })
})

describe('MemoryStore incremental reconcile', () => {
  it('reads no page when nothing changed on disk', () => {
    store.upsert(newMemoryEntry({ id: 'm_r1', title: 'First', text: 'one' }))
    store.upsert(newMemoryEntry({ id: 'm_r2', title: 'Second', text: 'two' }))

    const report = store.reconcileFromDisk()
    expect(report).toMatchObject({
      mode: 'incremental',
      scanned: 2,
      read: 0,
      added: 0,
      updated: 0,
      unchanged: 2,
      removed: 0,
    })
    expect(report.ms).toBeGreaterThanOrEqual(0)
  })

  it('rebuilds a database without page fingerprints once, then skips them', () => {
    store.upsert(newMemoryEntry({ id: 'm_legacy1', title: 'Legacy', text: 'old row' }))
    store.upsert(newMemoryEntry({ id: 'm_legacy2', title: 'Legacy two', text: 'old row two' }))
    const dbPath = store.dbPath
    store.close()

    const raw = new DatabaseSync(dbPath)
    raw.exec('UPDATE memories SET file_size = NULL, file_mtime_ms = NULL;')
    raw.close()

    const reopened = new MemoryStore({ storageRoot: root })
    try {
      const first = reopened.reconcileFromDisk()
      expect(first).toMatchObject({ mode: 'full', read: 2 })
      expect(reopened.get('m_legacy1')?.text).toBe('old row')

      expect(reopened.reconcileFromDisk()).toMatchObject({
        mode: 'incremental',
        scanned: 2,
        read: 0,
        unchanged: 2,
      })
    } finally {
      reopened.close()
    }
  })

  it('reads only changed and new pages, and drops a deleted one', () => {
    store.upsert(newMemoryEntry({ id: 'm_i1', title: 'First', text: 'one' }))
    store.upsert(newMemoryEntry({ id: 'm_i2', title: 'Second', text: 'two' }))
    const third = store.upsert(newMemoryEntry({ id: 'm_i3', title: 'Third', text: 'three' }))

    const edited = newMemoryEntry({ id: 'm_i1', title: 'First', text: 'one edited' })
    writeFileAtomic(entryFilePath(root, edited), pageToText(edited))
    removeFileIfExists(entryFilePath(root, third))
    const fresh = newMemoryEntry({ id: 'm_i4', title: 'Fourth', text: 'four' })
    writeFileAtomic(entryFilePath(root, fresh), pageToText(fresh))

    const report = store.reconcileFromDisk()
    expect(report).toMatchObject({ scanned: 3, read: 2, added: 1, updated: 1, unchanged: 1, removed: 1 })
    expect(store.get('m_i1')?.text).toBe('one edited')
    expect(store.get('m_i2')?.text).toBe('two')
    expect(store.get('m_i3')).toBeNull()
    expect(store.get('m_i4')?.text).toBe('four')
  })

  it('detects an external edit that keeps the file size', () => {
    const entry = newMemoryEntry({ id: 'm_same1', title: 'Same size', text: 'aaaa' })
    store.upsert(entry)
    const file = entryFilePath(root, entry)
    const before = statSync(file).mtimeMs

    const rewritten = newMemoryEntry({ id: 'm_same1', title: 'Same size', text: 'bbbb' })
    writeFileAtomic(file, pageToText(rewritten))
    // Pin a strictly different mtime: with an equal size, only the timestamp
    // can tell the reconcile that this page must be re-read.
    utimesSync(file, new Date(), new Date(before + 2000))

    const report = store.reconcileFromDisk()
    expect(report.read).toBe(1)
    expect(store.get('m_same1')?.text).toBe('bbbb')
  })

  it('refreshes only the fingerprint when a page was touched but not changed', () => {
    const entry = store.upsert(
      newMemoryEntry({ id: 'm_touch1', scope: 'project', project: 'proj', title: 'Touched', text: 'same body' }),
    )
    const file = entryFilePath(root, entry)
    const before = statSync(file).mtimeMs

    // Same bytes, newer timestamp: a backup restore or `touch`.
    utimesSync(file, new Date(), new Date(before + 5000))

    const report = store.reconcileFromDisk()
    expect(report).toMatchObject({ read: 1, refreshed: 1, updated: 0, added: 0, unchanged: 0 })
    expect(store.get('m_touch1')?.text).toBe('same body')
    expect(store.search('same body').map((hit) => hit.id)).toContain('m_touch1')

    // The refreshed fingerprint is stored, so the next pass does not read it.
    expect(store.reconcileFromDisk()).toMatchObject({ read: 0, refreshed: 0, unchanged: 1 })
  })

  it('replaces the row when a page carries a different entry id', () => {
    const entry = newMemoryEntry({ id: 'm_old_id', title: 'Renamed', text: 'body' })
    store.upsert(entry)

    const renamed = { ...entry, id: 'm_new_id' }
    writeFileAtomic(entryFilePath(root, entry), pageToText(renamed))

    store.reconcileFromDisk()
    expect(store.get('m_old_id')).toBeNull()
    expect(store.get('m_new_id')?.text).toBe('body')
  })

  it('lets a fresh store instance skip unchanged pages too', () => {
    store.upsert(newMemoryEntry({ id: 'm_fresh1', title: 'First', text: 'one' }))
    store.upsert(newMemoryEntry({ id: 'm_fresh2', title: 'Second', text: 'two' }))
    store.close()

    const reopened = new MemoryStore({ storageRoot: root })
    try {
      expect(reopened.reconcileFromDisk()).toMatchObject({ scanned: 2, read: 0, unchanged: 2 })
    } finally {
      reopened.close()
    }
  })

  it('defers a directory that exceeds its budget and keeps its rows', () => {
    store.upsert(newMemoryEntry({ id: 'm_budget1', scope: 'project', project: 'proj', title: 'One', text: 'one' }))
    store.upsert(newMemoryEntry({ id: 'm_budget2', scope: 'project', project: 'proj', title: 'Two', text: 'two' }))
    store.reindexFromDisk()

    // The injected clock advances past the budget on the first check, so the
    // directory is deferred regardless of how fast this filesystem is.
    let ticks = 0
    const report = store.reconcileFromDisk({ budgetPerBaseDirMs: 1, now: () => (ticks += 5) })

    expect(report.scanned).toBe(2)
    expect(report.deferred).toHaveLength(1)
    expect(report.read).toBe(0)
    expect(report.unchanged).toBe(0)
    expect(store.list({ project: 'proj' }).total).toBe(2)
  })

  it('still drops a deleted page inside a deferred directory', () => {
    const kept = store.upsert(
      newMemoryEntry({ id: 'm_defer1', scope: 'project', project: 'proj', title: 'Kept', text: 'kept' }),
    )
    const gone = store.upsert(
      newMemoryEntry({ id: 'm_defer2', scope: 'project', project: 'proj', title: 'Gone', text: 'gone' }),
    )
    removeFileIfExists(entryFilePath(root, gone))

    let ticks = 0
    const report = store.reconcileFromDisk({ budgetPerBaseDirMs: 1, now: () => (ticks += 5) })

    expect(report.deferred).toHaveLength(1)
    expect(report.removed).toBe(1)
    expect(store.get(kept.id)?.text).toBe('kept')
    expect(store.get(gone.id)).toBeNull()
  })
})
