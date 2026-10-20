import { bunSqliteDriver } from './bun.js'
import { nodeSqliteDriver } from './node.js'
import type { SqliteDatabase, SqliteDriver, SqliteOpenOptions } from '../../port/sqlite.js'

function isBun(): boolean {
  return typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined'
}

/** Driver for the current runtime (Bun first, then Node). */
export function resolveSqliteDriver(): SqliteDriver {
  return isBun() ? bunSqliteDriver : nodeSqliteDriver
}

export function openDatabase(path: string, options?: SqliteOpenOptions): SqliteDatabase {
  return resolveSqliteDriver().open(path, options)
}

export { bunSqliteDriver, nodeSqliteDriver }
export type { SqliteDatabase, SqliteDriver, SqliteOpenOptions }
