/**
 * Storage open failures must explain themselves.
 *
 * The store only supports a local disk: WAL over UNC/9p breaks with
 * "database is locked"/"disk I/O error" (spikes A1/A10), and a wrong path shows
 * up as "unable to open database file". A bare SQLite message sends the user to
 * the wrong place, so the store wraps it with the actual constraint.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { MemoryStore } from '@llm-memory/core/infrastructure/store'

const roots: string[] = []
function makeRoot(prefix = 'llm-memory-storage-'): string {
  const root = mkdtempSync(join(tmpdir(), prefix))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('storage open errors', () => {
  it('opens a normal store', () => {
    const store = new MemoryStore({ storageRoot: makeRoot() })
    expect(() => store.open()).not.toThrow()
    store.close()
  })

  it('explains an unusable database path instead of relaying SQLite', () => {
    const root = makeRoot()
    // A directory where the database file should be: SQLite cannot open it.
    mkdirSync(join(root, '_db', 'memory.db'), { recursive: true })
    const store = new MemoryStore({ storageRoot: root })
    let message = ''
    try {
      store.open()
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).toMatch(/local disk/i)
    expect(message).toContain(join(root, '_db', 'memory.db'))
  })
})
