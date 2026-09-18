import { existsSync } from 'node:fs'

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
