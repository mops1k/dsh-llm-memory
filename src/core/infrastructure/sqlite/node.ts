import { DatabaseSync } from 'node:sqlite'
import type { SqliteDatabase, SqliteDriver, SqliteOpenOptions, SqliteStatement } from '../../port/sqlite.js'

/** Node 22.5+/24 driver. ADR-008: `node:sqlite` may be imported only here. */
export const nodeSqliteDriver: SqliteDriver = {
  name: 'node',
  open(path: string, options?: SqliteOpenOptions): SqliteDatabase {
    const db =
      options?.allowExtension === true
        ? new DatabaseSync(path, { allowExtension: true })
        : new DatabaseSync(path)
    return {
      exec: sql => db.exec(sql),
      prepare: sql => db.prepare(sql) as unknown as SqliteStatement,
      close: () => db.close(),
      loadExtension: extension => db.loadExtension(extension),
    }
  },
}
