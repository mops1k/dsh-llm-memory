/**
 * SQLite port: the only surface the domain/application layers may use.
 *
 * Implementations live in `infrastructure/sqlite` (Node `node:sqlite` and Bun
 * `bun:sqlite`). ADR-008: driver imports are allowed only in that layer.
 */
export interface SqliteStatement {
  /** Rows are untyped at the port boundary; callers narrow them. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  all<T = any>(...params: unknown[]): T[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get<T = any>(...params: unknown[]): T | undefined
  run(...params: unknown[]): unknown
}

export interface SqliteDatabase {
  exec(sql: string): void
  prepare(sql: string): SqliteStatement
  close(): void
  loadExtension(path: string, entrypoint?: string): void
}

export interface SqliteOpenOptions {
  /** Allow `loadExtension` later on the same connection (`allowExtension` in node:sqlite). */
  allowExtension?: boolean
  readOnly?: boolean
}

export interface SqliteDriver {
  readonly name: 'node' | 'bun'
  open(path: string, options?: SqliteOpenOptions): SqliteDatabase
}
