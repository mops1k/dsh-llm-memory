/**
 * Kilo store migration CLI.
 *
 *   node scripts/migrate-kilo.mjs --db <path> [--apply] [--backup <dir>]
 *
 * Dry-run by default: only reports what would change.
 */
import { migrateKiloStore } from '../lib/adapters/kilo/migrate.js'

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : fallback
}

const dbPath = arg('db')
if (!dbPath) {
  console.error('usage: node scripts/migrate-kilo.mjs --db <path> [--apply] [--backup <dir>]')
  process.exit(2)
}

const report = migrateKiloStore({
  dbPath,
  apply: process.argv.includes('--apply'),
  backupDir: arg('backup', undefined),
})
console.log(JSON.stringify(report, null, 2))
