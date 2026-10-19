/**
 * Kilo cutover rehearsal on copies (never touches the live store).
 *
 *   node scripts/kilo-cutover.mjs --source ~/.config/kilo/memory \
 *     [--db <db>] [--projects <dirs>] [--work <dir>] [--queries 100]
 */
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { rehearseCutover } from '../packages/adapter/lib/kilo/cutover.js'

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const index = argv.indexOf(`--${name}`)
  return index >= 0 ? argv[index + 1] : fallback
}

const storeDir = flag('source', join(homedir(), '.config', 'kilo', 'memory'))
const report = await rehearseCutover({
  source: {
    storeDir,
    dbPath: flag('db', join(storeDir, '_db', 'memory.db')),
    projectDirs: (flag('projects', '') || '').split(',').filter(Boolean),
  },
  workDir: flag('work', join(tmpdir(), 'kilo-cutover')),
  queries: Number(flag('queries', '100')),
})
console.log(JSON.stringify(report, null, 2))
if (!report.productionReady) process.exit(1)
