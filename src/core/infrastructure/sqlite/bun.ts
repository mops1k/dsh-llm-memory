import { createRequire } from 'node:module'
import type { SqliteDatabase, SqliteDriver, SqliteOpenOptions, SqliteStatement } from '../../port/sqlite.js'

const requireFromHere = createRequire(import.meta.url)

interface BunDatabase {
  exec(sql: string): void
  prepare(sql: string): { all(...p: unknown[]): unknown[]; get(...p: unknown[]): unknown; run(...p: unknown[]): unknown }
  close(): void
  loadExtension?(path: string, entrypoint?: string): void
}

/** Bun driver, loaded lazily so a Node host never touches `bun:sqlite`. */
export const bunSqliteDriver: SqliteDriver = {
  name: 'bun',
  open(path: string, options?: SqliteOpenOptions): SqliteDatabase {
    const mod = requireFromHere('bun:sqlite') as { Database: new (path: string) => BunDatabase }
    const db = new mod.Database(path)
    if (options?.readOnly === true) db.exec('PRAGMA query_only = 1;')
    return {
      exec: sql => db.exec(sql),
      prepare: sql => db.prepare(sql) as unknown as SqliteStatement,
      close: () => db.close(),
      loadExtension: (extension, entrypoint) => {
        if (!db.loadExtension) throw new Error('bun:sqlite has no loadExtension in this version')
        db.loadExtension(extension, entrypoint)
      },
    }
  },
}
