/**
 * sqlite-vec backend: extension loading, KNN parity with the in-process scan,
 * quantization and the fallback paths that keep recall working when the optional
 * extension is missing or the connection cannot load it.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'

import { MemoryStore } from '@llm-memory/core/store'
import { JsVectorIndex, SqliteVecIndex, createVectorIndex } from '@llm-memory/core/vector-index'
import type { VectorRecord } from '@llm-memory/core/types'

const DIM = 8

const roots: string[] = []

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'llm-memory-backends-'))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** In-memory connection; extension loading is only enabled on request. */
function memoryDb(allowExtension = true): DatabaseSync {
  return allowExtension ? new DatabaseSync(':memory:', { allowExtension: true }) : new DatabaseSync(':memory:')
}

/** Normalize a vector the way the real provider does. */
function unit(...values: number[]): Float32Array {
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value * value, 0)) || 1
  return Float32Array.from(values.map((value) => value / norm))
}

function padded(...head: number[]): Float32Array {
  return unit(...head, ...Array.from({ length: DIM - head.length }, () => 0))
}

function record(entryId: string, vector: Float32Array, overrides: Partial<VectorRecord> = {}): VectorRecord {
  return {
    entryId,
    chunkIndex: 0,
    scope: 'project',
    project: 'demo',
    kind: 'facts',
    tier: 'normal',
    status: 'active',
    hash: `h-${entryId}`,
    vector,
    ...overrides,
  }
}

const A = padded(1, 0)
const B = padded(0, 1)
const C = padded(0.9, 0.1)
const QUERY = padded(0.9, 0.1)

const RECORDS: VectorRecord[] = [
  record('a', A),
  record('b', B, { kind: 'rules', tier: 'immutable' }),
  record('c', C, { chunkIndex: 1 }),
]

describe('SqliteVecIndex', () => {
  it('loads the extension, indexes chunks and runs KNN with filters', () => {
    const debug: string[] = []
    const index = createVectorIndex('sqlite-vec', {
      db: memoryDb(),
      model: 'test-model',
      dim: DIM,
      debug: (message) => debug.push(message),
    })
    expect(index).toBeInstanceOf(SqliteVecIndex)
    expect((index as SqliteVecIndex).version.length).toBeGreaterThan(0)
    expect(debug.join('\n')).toContain('sqlite-vec')

    index!.upsert(RECORDS)
    expect(index!.size()).toBe(3)
    expect(index!.storedHashes('c')).toEqual(new Map([[1, 'h-c']]))

    const nearest = index!.search({ vector: QUERY, limit: 5 })
    expect(nearest.map((match) => match.entryId)).toEqual(['c', 'a', 'b'])
    expect(nearest[0]!.score).toBeCloseTo(1, 2)
    expect(nearest[0]!.chunkIndex).toBe(1)

    // Metadata filters run inside the vec0 query.
    expect(index!.search({ vector: QUERY, limit: 5, filter: { kind: 'rules' } }).map((m) => m.entryId)).toEqual(['b'])
    expect(index!.search({ vector: QUERY, limit: 5, filter: { tier: 'immutable' } }).map((m) => m.entryId)).toEqual(['b'])
    expect(index!.search({ vector: QUERY, limit: 5, filter: { scope: 'user' } })).toEqual([])
    expect(index!.search({ vector: QUERY, limit: 5, entryIds: ['a'] }).map((m) => m.entryId)).toEqual(['a'])
    expect(index!.search({ vector: QUERY, limit: 5, entryIds: [] })).toEqual([])
    expect(index!.search({ vector: QUERY, limit: 5, minScore: 0.999 }).map((m) => m.entryId)).toEqual(['c'])
    expect(index!.search({ vector: QUERY, limit: 1 })).toHaveLength(1)
    expect(index!.stats()).toMatchObject({ backend: 'sqlite-vec', chunks: 3, entries: 3, model: 'test-model', dim: DIM })

    index!.remove('b')
    expect(index!.size()).toBe(2)
    expect(index!.search({ vector: QUERY, limit: 5 }).map((m) => m.entryId)).toEqual(['c', 'a'])
    index!.clear('test-model')
    expect(index!.size()).toBe(2)
    index!.clear()
    expect(index!.size()).toBe(0)
    expect(index!.search({ vector: QUERY, limit: 5 })).toEqual([])
  })

  it('returns the same neighbours and scores as the in-process backend', () => {
    const js = createVectorIndex('js', { db: memoryDb(), model: 'test-model', dim: DIM, debug: () => {} })
    const vec = createVectorIndex('sqlite-vec', { db: memoryDb(), model: 'test-model', dim: DIM, debug: () => {} })
    js!.upsert(RECORDS)
    vec!.upsert(RECORDS)

    // Unambiguous queries: exact ties may be ordered differently by the two
    // scans (the in-process one is stable, vec0 is not).
    for (const query of [QUERY, padded(0, 1), padded(1, 0.5)]) {
      const fromJs = js!.search({ vector: query, limit: 3 })
      const fromVec = vec!.search({ vector: query, limit: 3 })
      expect(fromVec.map((match) => match.entryId)).toEqual(fromJs.map((match) => match.entryId))
      fromJs.forEach((match, index) => expect(fromVec[index]!.score).toBeCloseTo(match.score, 3))
    }
  })

  it('rebuilds the derived table from the cache without re-embedding', () => {
    const db = memoryDb()
    const js = createVectorIndex('js', { db, model: 'test-model', dim: DIM, debug: () => {} })!
    js.upsert(RECORDS)

    // A sqlite-vec index on the same database repopulates vec0 from memory_vectors.
    const vec = createVectorIndex('sqlite-vec', { db, model: 'test-model', dim: DIM, debug: () => {} })!
    expect(vec.size()).toBe(3)
    expect(vec.search({ vector: QUERY, limit: 5 }).map((match) => match.entryId)).toEqual(['c', 'a', 'b'])
    // Switching back to the in-process backend keeps working on the same data.
    const back = createVectorIndex('js', { db, model: 'test-model', dim: DIM, debug: () => {} })!
    expect(back.search({ vector: QUERY, limit: 5 }).map((match) => match.entryId)).toEqual(['c', 'a', 'b'])
  })

  it('quantizes to int8 and bit, and falls back to int8 for a dimension that bit cannot take', () => {
    const int8 = createVectorIndex('sqlite-vec', {
      db: memoryDb(),
      model: 'test-model',
      dim: DIM,
      debug: () => {},
      quantization: 'int8',
    }) as SqliteVecIndex
    expect(int8.quantization).toBe('int8')
    int8.upsert(RECORDS)
    expect(int8.search({ vector: QUERY, limit: 5 })[0]!.entryId).toBe('c')

    const bit = createVectorIndex('sqlite-vec', {
      db: memoryDb(),
      model: 'test-model',
      dim: DIM,
      debug: () => {},
      quantization: 'bit',
    }) as SqliteVecIndex
    expect(bit.quantization).toBe('bit')
    bit.upsert(RECORDS)
    const bitMatches = bit.search({ vector: QUERY, limit: 3 })
    expect(bitMatches.length).toBeGreaterThan(0)
    for (const match of bitMatches) expect(match.score).toBeGreaterThanOrEqual(0)

    const odd = createVectorIndex('sqlite-vec', {
      db: memoryDb(),
      model: 'test-model',
      dim: 5,
      debug: () => {},
      quantization: 'bit',
    }) as SqliteVecIndex
    expect(odd.quantization).toBe('int8')
  })

  it('falls back to the in-process index when the extension cannot load', () => {
    const debug: string[] = []
    const missing = createVectorIndex('sqlite-vec', {
      db: memoryDb(),
      model: 'test-model',
      dim: DIM,
      debug: (message) => debug.push(message),
      extensionPath: '/nonexistent/vec0.so',
    })
    expect(missing).toBeInstanceOf(JsVectorIndex)
    expect(missing!.backend).toBe('js')
    expect(debug.join('\n')).toContain('sqlite-vec unavailable')

    const blocked: string[] = []
    const notAllowed = createVectorIndex('sqlite-vec', {
      db: memoryDb(false),
      model: 'test-model',
      dim: DIM,
      debug: (message) => blocked.push(message),
    })
    expect(notAllowed).toBeInstanceOf(JsVectorIndex)
    expect(blocked.join('\n')).toContain('cannot be loaded')
  })
})

describe('MemoryStore vector backends', () => {
  it('uses the vec0 backend only when the connection allowed extensions', () => {
    const enabled = new MemoryStore({ storageRoot: makeRoot(), allowExtension: true })
    expect(enabled.initVectorIndex({ model: 'test-model', dim: DIM, backend: 'sqlite-vec' })).toBeInstanceOf(
      SqliteVecIndex,
    )
    enabled.close()

    const disabled = new MemoryStore({ storageRoot: makeRoot() })
    const fallback = disabled.initVectorIndex({ model: 'test-model', dim: DIM, backend: 'sqlite-vec' })
    expect(fallback).toBeInstanceOf(JsVectorIndex)
    expect(disabled.vectorIndex()?.backend).toBe('js')
    disabled.close()
  })
})
