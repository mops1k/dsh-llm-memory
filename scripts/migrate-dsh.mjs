/**
 * DSH store migration to schema v2 with an optional pre-migration copy.
 *
 *   node scripts/migrate-dsh.mjs --db ~/.dsh/llm-memory/_db/memory.db [--apply --backup <dir>]
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { migrateSchemaToV2 } from '../packages/core/lib/infrastructure/migrate.js'
import { openDatabase } from '../packages/core/lib/infrastructure/sqlite/index.js'

/** Consistent snapshot of a live (possibly WAL-busy) database. */
function snapshot(dbPath, target) {
  try {
    const db = openDatabase(dbPath)
    try {
      db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`)
    } finally {
      db.close()
    }
    return 'vacuum-into'
  } catch (error) {
    copyFileSync(dbPath, target)
    for (const suffix of ['-wal', '-shm']) if (existsSync(dbPath + suffix)) copyFileSync(dbPath + suffix, target + suffix)
    return `file-copy (${String(error)})`
  }
}

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const index = argv.indexOf(`--${name}`)
  return index >= 0 ? argv[index + 1] : fallback
}
const dbPath = flag('db')
if (!dbPath) {
  console.error('usage: node scripts/migrate-dsh.mjs --db <file> [--apply --backup <dir>]')
  process.exit(2)
}
const apply = argv.includes('--apply')
let backupPath = null
let backupMode = null
if (apply) {
  const dir = flag('backup', join(dbPath, '..', '..', 'backups'))
  mkdirSync(dir, { recursive: true })
  backupPath = join(dir, `memory-${new Date().toISOString().replace(/[:.]/g, '-')}.db`)
  backupMode = snapshot(dbPath, backupPath)
}
const report = migrateSchemaToV2({ dbPath, apply })
console.log(JSON.stringify({ ...report, backupPath, backupMode }, null, 2))
