/**
 * Backup CLI (ADR-005): manual only, destructive steps need typed confirmation.
 *
 *   node scripts/backup-cli.mjs create  --harness kilo --store <dir> --db <file> [--projects a,b] [--backups <dir>] [--passphrase x]
 *   node scripts/backup-cli.mjs list    --backups <dir>
 *   node scripts/backup-cli.mjs verify  --archive <file> [--passphrase x]
 *   node scripts/backup-cli.mjs restore --harness kilo --store <dir> --db <file> --archive <file> --confirm RESTORE [--dry-run]
 *   node scripts/backup-cli.mjs delete  --archive <file> --confirm DELETE
 */
import {
  createBackup,
  deleteBackup,
  listBackups,
  restoreBackup,
  verifyBackup,
} from '../packages/core/lib/infrastructure/backup.js'

const argv = process.argv.slice(2)
const command = argv[0]
const flag = (name, fallback) => {
  const index = argv.indexOf(`--${name}`)
  return index >= 0 ? argv[index + 1] : fallback
}
const has = name => argv.includes(`--${name}`)

const target = () => ({
  harness: flag('harness', 'kilo'),
  storeDir: flag('store', ''),
  dbPath: flag('db', ''),
  projectDirs: (flag('projects', '') || '').split(',').filter(Boolean),
  backupsDir: flag('backups', ''),
})

function print(value) {
  console.log(JSON.stringify(value, null, 2))
}

switch (command) {
  case 'create': {
    const paths = target()
    if (!paths.storeDir || !paths.dbPath || !paths.backupsDir) throw new Error('create needs --store, --db, --backups')
    const passphrase = flag('passphrase')
    print(createBackup({ ...paths, ...(passphrase ? { passphrase } : {}) }))
    break
  }
  case 'list':
    print(listBackups(flag('backups', ''), flag('passphrase')))
    break
  case 'verify':
    print(verifyBackup(flag('archive', ''), flag('passphrase')))
    break
  case 'restore': {
    const paths = target()
    const archive = flag('archive', '')
    const confirm = flag('confirm', '')
    if (has('dry-run')) {
      print({ dryRun: true, verification: verifyBackup(archive, flag('passphrase')) })
      break
    }
    print(restoreBackup({ ...paths, archive, confirm, ...(flag('passphrase') ? { passphrase: flag('passphrase') } : {}) }))
    break
  }
  case 'delete':
    print({ deleted: deleteBackup(flag('archive', ''), flag('confirm'), flag('backups', undefined)) })
    break
  default:
    console.error('usage: node scripts/backup-cli.mjs create|list|verify|restore|delete [options]')
    process.exit(2)
}
