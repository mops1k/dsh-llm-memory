/**
 * Team-sync groundwork (ADR-006): interfaces and a no-op transport only.
 * No network code, no background jobs, no auth/ACL — `sync.enabled` stays false.
 */
import type { SqliteDatabase } from '../port/sqlite.js'

export interface SyncCapabilities {
  readonly name: string
  readonly push: boolean
  readonly pull: boolean
}

export type SyncOperationKind = 'upsert' | 'delete'

export interface SyncOperation {
  entryId: string
  revision: number
  op: SyncOperationKind
  baseRevision?: number
  actor: string
  deviceId: string
  createdAt: string
  payloadHash: string
}

export interface SyncPage {
  /** Cursor to pass on the next pull; null means "no more pages". */
  cursor: string | null
  operations: SyncOperation[]
}

export interface SyncRejection {
  entryId: string
  revision: number
  reason: string
}

export interface SyncAck {
  accepted: string[]
  rejected: SyncRejection[]
}

export interface SyncTransport {
  capabilities(): SyncCapabilities
  pull(cursor: string | null): Promise<SyncPage>
  push(operations: SyncOperation[]): Promise<SyncAck>
}

/** Reserved config; `enabled: false` is the only supported state today. */
export interface SyncConfig {
  enabled: boolean
  team: string | null
  remote: string | null
}

export const DEFAULT_SYNC_CONFIG: SyncConfig = { enabled: false, team: null, remote: null }

/**
 * No-op transport: the default until a real transport (git first) exists.
 * It never performs I/O and never touches the network.
 */
export class NullSync implements SyncTransport {
  capabilities(): SyncCapabilities {
    return { name: 'null', push: false, pull: false }
  }

  async pull(_cursor: string | null): Promise<SyncPage> {
    return { cursor: null, operations: [] }
  }

  async push(_operations: SyncOperation[]): Promise<SyncAck> {
    return { accepted: [], rejected: [] }
  }
}

/** Append-only revisions table; filled only by a future sync layer. */
export const MEMORY_REVISIONS_DDL = `CREATE TABLE IF NOT EXISTS memory_revisions (
  entry_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  op TEXT NOT NULL,
  base_revision INTEGER,
  actor TEXT NOT NULL,
  device_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  PRIMARY KEY (entry_id, revision)
)`

export function ensureRevisionsTable(db: SqliteDatabase): void {
  db.exec(MEMORY_REVISIONS_DDL)
}
