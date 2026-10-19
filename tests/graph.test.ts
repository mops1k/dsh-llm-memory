import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, describe, expect, it } from 'vitest'

import {
  ensureGraphTables,
  loadPersistedGraph,
  persistGraph,
  resolveGraph,
} from '@llm-memory/core/application/graph'
import { buildGraph } from '@llm-memory/core/application/wiki'
import { entryFromKiloRow } from '@llm-memory/core/domain/mapping'
import type { MemoryEntry } from '@llm-memory/core/domain/types'

const FIXTURE = join(import.meta.dirname, 'fixtures', 'kilo', 'memory.db')
const temps: string[] = []

function tempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), 'llm-graph-'))
  temps.push(dir)
  const target = join(dir, 'memory.db')
  copyFileSync(FIXTURE, target)
  return target
}
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function entries(path: string): MemoryEntry[] {
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    return (db.prepare('SELECT * FROM memories').all() as Record<string, unknown>[]).map(entryFromKiloRow)
  } finally {
    db.close()
  }
}

describe('memory graph', () => {
  it('falls back to the computed graph when nothing is persisted', () => {
    const path = tempDb()
    const db = new DatabaseSync(path)
    try {
      const computed = buildGraph(entries(path))
      expect(loadPersistedGraph(db)).toBeNull()
      const resolved = resolveGraph(entries(path), db)
      expect(resolved.entities.length).toBe(24)
      expect(resolved.edges.length).toBe(computed.edges.length)
      expect(computed.edges.length).toBeGreaterThan(0)
    } finally {
      db.close()
    }
  })

  it('persists the computed graph and serves it back', () => {
    const path = tempDb()
    const db = new DatabaseSync(path)
    try {
      const computed = buildGraph(entries(path))
      const report = persistGraph(db, computed)
      expect(report.entities).toBe(24)
      const loaded = loadPersistedGraph(db)
      expect(loaded?.entities.length).toBe(computed.entities.length)
      expect(loaded?.edges.length).toBe(computed.edges.length)
      const resolved = resolveGraph(entries(path), db)
      expect(resolved.entities.map(e => e.id).sort()).toEqual(computed.entities.map(e => e.id).sort())
    } finally {
      db.close()
    }
  })

  it('is idempotent: a second persist does not duplicate rows', () => {
    const path = tempDb()
    const db = new DatabaseSync(path)
    try {
      const computed = buildGraph(entries(path))
      persistGraph(db, computed)
      persistGraph(db, computed)
      const counts = db
        .prepare('SELECT (SELECT COUNT(*) FROM memory_entities) AS entities, (SELECT COUNT(*) FROM memory_edges) AS edges')
        .get() as { entities: number; edges: number }
      expect(counts.entities).toBe(computed.entities.length)
      expect(counts.edges).toBe(computed.edges.length)
    } finally {
      db.close()
    }
  })

  it('returns null and does not throw when graph tables are missing', () => {
    const path = tempDb()
    const db = new DatabaseSync(path)
    try {
      db.exec('DROP TABLE IF EXISTS memory_edges')
      db.exec('DROP TABLE IF EXISTS memory_entities')
      expect(loadPersistedGraph(db)).toBeNull()
      expect(resolveGraph(entries(path), db).entities.length).toBe(24)
      ensureGraphTables(db)
      ensureGraphTables(db)
      expect(loadPersistedGraph(db)).toBeNull()
    } finally {
      db.close()
    }
  })
})
