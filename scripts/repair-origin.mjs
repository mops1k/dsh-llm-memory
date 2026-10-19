import { DatabaseSync } from 'node:sqlite'

const file = process.argv[2]
if (!file) { console.error('usage: node scripts/repair-origin.mjs <memory.db>'); process.exit(2) }
const db = new DatabaseSync(file)
const before = db.prepare('PRAGMA table_info(memories)').all()
const origin = before.find(c => c.name === 'origin')
if (origin && origin.notnull === 0) { console.log('already nullable'); db.close(); process.exit(0) }
const createSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='memories'").get().sql
const indexes = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='memories' AND sql IS NOT NULL").all()
const newSql = createSql
  .replace(/CREATE TABLE "?memories"?/i, 'CREATE TABLE memories_new')
  .replace(/origin\s+TEXT\s+NOT NULL\s+DEFAULT\s+'kilo'/i, 'origin TEXT')
  .replace(/origin\s+TEXT\s+NOT NULL/i, 'origin TEXT')
const columns = before.map(c => `"${c.name}"`).join(', ')
db.exec('BEGIN IMMEDIATE')
try {
  db.exec(newSql)
  db.exec(`INSERT INTO memories_new (${columns}) SELECT ${columns} FROM memories`)
  const count = db.prepare('SELECT COUNT(*) n FROM memories').get().n
  const countNew = db.prepare('SELECT COUNT(*) n FROM memories_new').get().n
  if (count !== countNew) throw new Error(`row count mismatch ${count} != ${countNew}`)
  db.exec('DROP TABLE memories')
  db.exec('ALTER TABLE memories_new RENAME TO memories')
  for (const index of indexes) db.exec(index.sql)
  db.exec('COMMIT')
  console.log('origin nullable, counts', count, 'indexes', indexes.length)
} catch (error) {
  db.exec('ROLLBACK')
  throw error
}
console.log('integrity', db.prepare('PRAGMA integrity_check').get().integrity_check)
db.close()
