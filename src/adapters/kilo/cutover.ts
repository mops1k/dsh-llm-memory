/**
 * Kilo cutover rehearsal: everything runs on copies. Production switching is a
 * separate, manual step with the same checks (docs/kilo-cutover.md).
 */
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createBackup, restoreBackup, verifyBackup } from '../../core/infrastructure/backup.js'
import { openDatabase } from '../../core/infrastructure/sqlite/index.js'
import { MemoryStore } from '../../core/infrastructure/store.js'

import { DEFAULT_KILO_CONFIG, resolveKiloConfig } from './config.js'
import { migrateKiloStore } from './migrate.js'
import { createKiloRuntime } from './runtime.js'
import { KiloService } from './service.js'
import { startKiloWebServer } from './web-server.js'
import { kiloMemoryTools } from './tools.js'

export interface CutoverSource {
  dbPath: string
  storeDir: string
  projectDirs?: string[]
  configPath?: string
}

export interface CutoverOptions {
  source: CutoverSource
  workDir?: string
  queries?: number
  now?: Date
}

export interface CutoverReport {
  source: { dbPath: string; entries: number; active: number; logicalHash: string }
  backup: { archive: string; bytes: number; verified: boolean }
  migration: { addedColumns: string[]; before: { entries: number; active: number }; after: { entries: number; active: number }; integrityCheck: string }
  preservation: { entries: boolean; active: boolean; relations: boolean; projectPages: boolean }
  recall: { queries: number; averageIntersection: number; minimumIntersection: number; threshold: number; passed: boolean }
  smoke: { tools: number; hookInjectsGuide: boolean; panel: boolean; backupRestore: boolean; settings: boolean }
  rollback: { ok: boolean; entries: number; active: number; logicalHashMatches: boolean }
  productionReady: boolean
}

function counts(dbPath: string): { entries: number; active: number } {
  const db = openDatabase(dbPath)
  try {
    const row = db.prepare("SELECT COUNT(*) AS entries, SUM(status = 'active') AS active FROM memories").get<{ entries: number; active: number }>()
    return { entries: row?.entries ?? 0, active: row?.active ?? 0 }
  } finally {
    db.close()
  }
}

function logicalHash(dbPath: string): string {
  const db = openDatabase(dbPath)
  try {
    const rows = db.prepare('SELECT id, status, updatedAt, content FROM memories ORDER BY id').all<Record<string, unknown>>()
    return createHash('sha256').update(JSON.stringify(rows)).digest('hex')
  } finally {
    db.close()
  }
}

function relationWeight(dbPath: string): number {
  const db = openDatabase(dbPath)
  try {
    const rows = db.prepare('SELECT supersededBy, related FROM memories').all<Record<string, unknown>>()
    const size = (value: unknown): number => {
      try {
        const parsed = JSON.parse(String(value ?? '[]')) as unknown
        return Array.isArray(parsed) ? parsed.length : 0
      } catch {
        return 0
      }
    }
    return rows.reduce((sum, row) => sum + size(row['supersededBy']) + size(row['related']), 0)
  } finally {
    db.close()
  }
}

function lexicalTop(dbPath: string, query: string, limit: number, dialect: 'kilo' | 'core'): string[] {
  const tokens = query.toLowerCase().split(/\W+/).filter(token => token.length > 2)
  if (tokens.length === 0) return []
  const body = dialect === 'kilo' ? 'content' : 'text'
  const db = openDatabase(dbPath)
  try {
    const rows = db
      .prepare(`SELECT id, title, ${body} AS body, keywords FROM memories WHERE status = 'active'`)
      .all<Record<string, unknown>>()
    return rows
      .map(row => {
        const title = String(row['title'] ?? '').toLowerCase()
        const content = String(row['body'] ?? '').toLowerCase()
        const keywords = String(row['keywords'] ?? '').toLowerCase()
        let score = 0
        for (const token of tokens) {
          score += (title.split(token).length - 1) * 3
          score += (keywords.split(token).length - 1) * 2
          score += content.split(token).length - 1
        }
        return { id: String(row['id']), score }
      })
      .filter(item => item.score > 0)
      .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
      .slice(0, limit)
      .map(item => item.id)
  } finally {
    db.close()
  }
}

function sampleQueries(dbPath: string, count: number): string[] {
  const db = openDatabase(dbPath)
  try {
    const rows = db.prepare("SELECT title, content FROM memories WHERE status = 'active' ORDER BY id LIMIT ?").all<Record<string, unknown>>(count)
    return rows
      .map(row => `${String(row['title'] ?? '')} ${String(row['content'] ?? '')}`.split(/\s+/).filter(word => word.length > 4).slice(0, 3).join(' '))
      .filter(query => query.length > 0)
  } finally {
    db.close()
  }
}

export async function rehearseCutover(options: CutoverOptions): Promise<CutoverReport> {
  const now = options.now ?? new Date()
  const workDir = options.workDir ?? mkdtempSync(join(tmpdir(), 'kilo-cutover-'))
  mkdirSync(workDir, { recursive: true })
  const backupsDir = join(workDir, 'backups')
  const sourceSnapshot = join(workDir, 'source', 'db', 'memory.db')
  mkdirSync(join(workDir, 'source', 'db'), { recursive: true })
  copyFileSync(options.source.dbPath, sourceSnapshot)
  const source = {
    dbPath: options.source.dbPath,
    ...counts(sourceSnapshot),
    logicalHash: logicalHash(sourceSnapshot),
  }

  // 1. Backup the source store (same code path as production).
  const backup = createBackup({
    harness: 'kilo',
    storeDir: options.source.storeDir,
    dbPath: sourceSnapshot,
    projectDirs: options.source.projectDirs ?? [],
    backupsDir,
    now,
  })
  const verified = verifyBackup(backup.archive).ok

  // 2. Migrate a copy, never the source.
  const migratedRoot = join(workDir, 'migrated')
  mkdirSync(join(migratedRoot, 'db'), { recursive: true })
  copyFileSync(sourceSnapshot, join(migratedRoot, 'db', 'memory.db'))
  for (const dir of ['pages', 'raw', 'config']) {
    const from = join(options.source.storeDir, dir)
    if (existsSync(from)) copyDir(from, join(migratedRoot, dir))
  }
  const migration = migrateKiloStore({ dbPath: join(migratedRoot, 'db', 'memory.db'), apply: true, backupDir: join(workDir, 'migration-backups') })
  const after = counts(join(migratedRoot, 'db', 'memory.db'))

  // 3. Preservation: counts, relations and project pages.
  const preservation = {
    entries: after.entries === source.entries,
    active: after.active === source.active,
    relations: relationWeight(join(migratedRoot, 'db', 'memory.db')) === relationWeight(sourceSnapshot),
    projectPages: (options.source.projectDirs ?? []).every(dir => existsSync(dir)),
  }

  // 4. Recall baseline: lexical top-10 on sample queries, migrated core store.
  const queries = sampleQueries(sourceSnapshot, options.queries ?? 100)
  const store = new MemoryStore({ storageRoot: migratedRoot, dbPath: join(migratedRoot, 'db', 'memory.db') })
  store.open()
  store.rebuildFts()
  let total = 0
  let minimum = 1
  for (const query of queries) {
    const expected = lexicalTop(sourceSnapshot, query, 10, 'kilo')
    const actual = lexicalTop(join(migratedRoot, 'db', 'memory.db'), query, 10, 'core')
    const set = new Set(actual)
    const intersection = expected.length === 0 ? 1 : expected.filter(id => set.has(id)).length / expected.length
    total += intersection
    minimum = Math.min(minimum, intersection)
  }
  const average = queries.length === 0 ? 1 : total / queries.length
  store.close()

  // 5. Smoke: tools, hooks, panel, backup/restore, settings.
  const config = resolveKiloConfig({ memory: { ...DEFAULT_KILO_CONFIG.memory, storageRoot: migratedRoot }, web: { ...DEFAULT_KILO_CONFIG.web, enabled: false } })
  const service = new KiloService({ config })
  service.init()
  const tools = Object.keys(kiloMemoryTools(service)).length
  const runtime = createKiloRuntime({ service, config })
  const output = { system: [] as string[] }
  await runtime.hooks['experimental.chat.system.transform']?.({ sessionID: 'rehearsal' }, output)
  const hookInjectsGuide = output.system.some(text => text.includes('llm_memory_recall'))
  const panel = await startKiloWebServer({ service, config: { ...config, web: { ...config.web, enabled: true, port: 0 } }, port: 0 })
  let panelOk = false
  try {
    panelOk = panel.url !== null && (await fetch(`${panel.url}api/legacy/status`).then(response => response.ok))
  } finally {
    await panel.close()
  }
  // The restore replaces the database file, so the service must release it first:
  // Windows refuses to unlink a file that still has an open handle.
  service.close()
  const smokeBackup = createBackup({ harness: 'kilo', storeDir: migratedRoot, dbPath: join(migratedRoot, 'db', 'memory.db'), backupsDir: join(workDir, 'smoke-backups') })
  const smokeRestore = restoreBackup({
    harness: 'kilo',
    storeDir: migratedRoot,
    dbPath: join(migratedRoot, 'db', 'memory.db'),
    backupsDir: join(workDir, 'smoke-backups'),
    archive: smokeBackup.archive,
    confirm: 'RESTORE',
  })
  const smoke = {
    tools,
    hookInjectsGuide,
    panel: panelOk,
    backupRestore: smokeRestore.restored && verifyBackup(smokeBackup.archive).ok,
    settings: config.memory.promptMode === 'dynamic',
  }

  // 6. Rollback rehearsal: restore the source backup into a clean target.
  const rollbackRoot = join(workDir, 'rollback')
  mkdirSync(join(rollbackRoot, 'db'), { recursive: true })
  const rollback = restoreBackup({
    harness: 'kilo',
    storeDir: rollbackRoot,
    dbPath: join(rollbackRoot, 'db', 'memory.db'),
    backupsDir: join(workDir, 'rollback-backups'),
    archive: backup.archive,
    confirm: 'RESTORE',
  })
  const rollbackCounts = counts(join(rollbackRoot, 'db', 'memory.db'))
  const rollbackReport = {
    ok: rollback.restored && rollback.integrityCheck === 'ok',
    entries: rollbackCounts.entries,
    active: rollbackCounts.active,
    logicalHashMatches: logicalHash(join(rollbackRoot, 'db', 'memory.db')) === source.logicalHash,
  }

  const recall = { queries: queries.length, averageIntersection: average, minimumIntersection: minimum, threshold: 0.9, passed: average >= 0.9 }
  const report: CutoverReport = {
    source: { dbPath: source.dbPath, entries: source.entries, active: source.active, logicalHash: source.logicalHash },
    backup: { archive: backup.archive, bytes: backup.bytes, verified },
    migration: {
      addedColumns: migration.addedColumns,
      before: migration.before,
      after: migration.after,
      integrityCheck: migration.integrityCheck,
    },
    preservation,
    recall,
    smoke,
    rollback: rollbackReport,
    productionReady:
      verified &&
      migration.integrityCheck === 'ok' &&
      preservation.entries &&
      preservation.active &&
      preservation.relations &&
      recall.passed &&
      rollbackReport.ok &&
      rollbackReport.logicalHashMatches,
  }
  const reportPath = join(workDir, 'migration-report.json')
  writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8')
  return report
}

function copyDir(from: string, to: string): void {
  mkdirSync(to, { recursive: true })
  for (const name of readdirSync(from)) {
    const source = join(from, name)
    const target = join(to, name)
    if (statSync(source).isDirectory()) copyDir(source, target)
    else copyFileSync(source, target)
  }
}

export function cleanupWorkDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true })
}
