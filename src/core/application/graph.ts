/**
 * Memory graph: computed on read (DSH) or persisted (Kilo `memory_entities` /
 * `memory_edges`), with a computed fallback when the persisted tables are
 * missing or empty. Core keeps both modes behind one entry point (ADR-002).
 */
import type { SqliteDatabase } from '../port/sqlite.js'
import type {
  MemoryEdgeType,
  MemoryEntry,
  MemoryGraph,
  MemoryGraphEdge,
  MemoryGraphEntity,
} from '../domain/types.js'
import { buildGraph, type BuildGraphOptions } from './wiki.js'

const ENTITY_DDL = `CREATE TABLE IF NOT EXISTS memory_entities (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  scope TEXT NOT NULL,
  project_root TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
)`

const EDGE_DDL = `CREATE TABLE IF NOT EXISTS memory_edges (
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  type TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (source_id, target_id, type)
)`

/** Create the persisted graph tables (idempotent, Kilo-compatible schema). */
export function ensureGraphTables(db: SqliteDatabase): void {
  db.exec(ENTITY_DDL)
  db.exec(EDGE_DDL)
}

export interface PersistGraphReport {
  entities: number
  edges: number
}

/** Upsert a graph into the persisted tables. Safe to call repeatedly. */
export function persistGraph(db: SqliteDatabase, graph: MemoryGraph, now = new Date().toISOString()): PersistGraphReport {
  ensureGraphTables(db)
  db.exec('BEGIN IMMEDIATE')
  try {
    const entity = db.prepare(
      `INSERT INTO memory_entities (id, kind, name, scope, project_root, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, name = excluded.name,
         scope = excluded.scope, project_root = excluded.project_root, updated_at = excluded.updated_at`,
    )
    for (const item of graph.entities) {
      entity.run(item.id, item.kind, item.name, item.scope, item.project, now)
    }
    const edge = db.prepare(
      `INSERT INTO memory_edges (source_id, target_id, type, weight, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(source_id, target_id, type) DO UPDATE SET weight = excluded.weight, updated_at = excluded.updated_at`,
    )
    for (const item of graph.edges) {
      edge.run(item.source, item.target, item.type, item.weight, now, now)
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return { entities: graph.entities.length, edges: graph.edges.length }
}

/** Read the persisted graph, or `null` when the tables are absent/empty. */
export function loadPersistedGraph(db: SqliteDatabase): MemoryGraph | null {
  let entities: MemoryGraphEntity[]
  let edges: MemoryGraphEdge[]
  try {
    entities = db
      .prepare('SELECT id, kind, name, scope, project_root FROM memory_entities')
      .all<MemoryGraphEntity & { project_root: string }>()
      .map(row => ({ id: row.id, kind: row.kind, name: row.name, scope: row.scope, project: row.project_root }))
    edges = db
      .prepare('SELECT source_id, target_id, type, weight FROM memory_edges')
      .all<{ source_id: string; target_id: string; type: string; weight: number }>()
      .map(row => ({
        source: row.source_id,
        target: row.target_id,
        type: row.type as MemoryEdgeType,
        weight: row.weight,
      }))
  } catch {
    return null
  }
  if (entities.length === 0) return null
  return { entities, edges }
}

/**
 * Graph for the current store: the persisted one when it has rows, otherwise
 * computed from the entries (computed is never written implicitly).
 */
export function resolveGraph(entries: MemoryEntry[], db?: SqliteDatabase, options?: BuildGraphOptions): MemoryGraph {
  if (db) {
    const persisted = loadPersistedGraph(db)
    if (persisted) return persisted
  }
  return buildGraph(entries, options)
}
