/**
 * DSH store migration to schema v2 with an optional pre-migration copy.
 *
 *   node scripts/migrate-dsh.mjs --db ~/.dsh/llm-memory/_db/memory.db [--apply --backup <dir>]
 */
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { migrateSchemaToV2 } from '../packages/core/lib/infrastructure/migrate.js'

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
if (apply) {
  const dir = flag('backup', join(dbPath, '..', '..', 'backups'))
  mkdirSync(dir, { recursive: true })
  backupPath = join(dir, `memory-${new Date().toISOString().replace(/[:.]/g, '-')}.db`)
  copyFileSync(dbPath, backupPath)
  for (const suffix of ['-wal', '-shm']) if (existsSync(dbPath + suffix)) copyFileSync(dbPath + suffix, backupPath + suffix)
}
const report = migrateSchemaToV2({ dbPath, apply })
console.log(JSON.stringify({ ...report, backupPath }, null, 2))
