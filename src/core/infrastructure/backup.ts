/**
 * Backup/restore for memory stores: one .llmmem archive (ZIP + manifest),
 * manual only, no auto-retention (ADR-005). Cross-harness restore is refused.
 */
import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, win32 } from 'node:path'

import { CORE_SCHEMA_VERSION, ensureSchemaV2 } from './schema.js'
import { ensureRevisionsTable } from '../sync/index.js'
import { openDatabase } from './sqlite/index.js'

export type HarnessKind = 'kilo' | 'dsh' | 'opencode' | 'mcp'

export interface BackupTarget {
  harness: HarnessKind
  /** Root of the harness store (pages, raw, config live below it). */
  storeDir: string
  /** SQLite database file to snapshot. */
  dbPath: string
  /** Extra page trees outside the store (Kilo keeps project pages in the repo). */
  projectDirs?: string[]
}

export interface CreateOptions extends BackupTarget {
  backupsDir: string
  now?: Date
  /** Optional AES-256-GCM encryption; off by default. */
  passphrase?: string
}

export interface ArchiveEntry {
  archivePath: string
  sha256: string
  size: number
}

export interface BackupManifest {
  format: 'llmmem'
  formatVersion: 1
  createdAt: string
  harness: HarnessKind
  storeId: string
  schemaVersion: number
  db: string
  entries: ArchiveEntry[]
  projects: Array<{ archivePath: string; originalPath: string }>
}

export interface BackupReport {
  archive: string
  bytes: number
  manifest: BackupManifest
  encrypted: boolean
}

export interface VerifyReport {
  ok: boolean
  archive: string
  encrypted: boolean
  errors: string[]
  manifest: BackupManifest | null
}

export interface BackupRecord {
  archive: string
  createdAt: string
  harness: string
  schemaVersion: number
  bytes: number
  encrypted: boolean
}

export interface RestoreOptions extends BackupTarget {
  archive: string
  backupsDir: string
  passphrase?: string
  /** Required for destructive operations: the caller must pass "RESTORE". */
  confirm?: string
  now?: Date
}

export interface RestoreReport {
  restored: boolean
  archive: string
  preRestoreBackup: string | null
  files: number
  counts: { entries: number; active: number }
  integrityCheck: string
  rolledBack: boolean
}

const MAGIC = 'LLMMEM1'
const ENCRYPTED_MAGIC = 'LLMMEM1E'
const HISTORY = 'backup-history.jsonl'

function sha256(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex')
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}

/* ------------------------------------------------------------------ ZIP --- */

interface ZipInput {
  name: string
  data: Buffer
}

/** Minimal ZIP writer: stored entries (no compression), DOS timestamp 0. */
function zipWrite(files: ZipInput[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8')
    const crc = crc32(file.data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(file.data.length, 18)
    local.writeUInt32LE(file.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, name, file.data)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(0, 12)
    central.writeUInt16LE(0, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(file.data.length, 20)
    central.writeUInt32LE(file.data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)
    offset += local.length + name.length + file.data.length
  }
  const centralBuffer = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(centralBuffer.length, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)
  return Buffer.concat([...locals, centralBuffer, end])
}

function zipRead(buffer: Buffer): ZipInput[] {
  const endIndex = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  if (endIndex < 0) throw new Error('not a zip archive')
  const count = buffer.readUInt16LE(endIndex + 10)
  let cursor = buffer.readUInt32LE(endIndex + 16)
  const files: ZipInput[] = []
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error('corrupt central directory')
    const method = buffer.readUInt16LE(cursor + 10)
    const size = buffer.readUInt32LE(cursor + 20)
    const nameLength = buffer.readUInt16LE(cursor + 28)
    const extraLength = buffer.readUInt16LE(cursor + 30)
    const commentLength = buffer.readUInt16LE(cursor + 32)
    const localOffset = buffer.readUInt32LE(cursor + 42)
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8')
    if (method !== 0) throw new Error(`unsupported compression for ${name}`)
    const localNameLength = buffer.readUInt16LE(localOffset + 26)
    const localExtra = buffer.readUInt16LE(localOffset + 28)
    const start = localOffset + 30 + localNameLength + localExtra
    files.push({ name, data: buffer.subarray(start, start + size) })
    cursor += 46 + nameLength + extraLength + commentLength
  }
  return files
}

/* -------------------------------------------------------------- archive --- */

function encrypt(plain: Buffer, passphrase: string): Buffer {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const key = createHash('sha256').update(salt).update(passphrase).digest()
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const body = Buffer.concat([cipher.update(plain), cipher.final()])
  return Buffer.concat([Buffer.from(ENCRYPTED_MAGIC), salt, iv, cipher.getAuthTag(), body])
}

function decrypt(file: Buffer, passphrase: string): Buffer {
  if (file.subarray(0, 8).toString() !== ENCRYPTED_MAGIC) throw new Error('archive is not encrypted')
  const salt = file.subarray(8, 24)
  const iv = file.subarray(24, 36)
  const tag = file.subarray(36, 52)
  const key = createHash('sha256').update(salt).update(passphrase).digest()
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(file.subarray(52)), decipher.final()])
}

function decode(file: Buffer, passphrase?: string): { zip: ZipInput[]; encrypted: boolean } {
  if (file.subarray(0, 8).toString() === ENCRYPTED_MAGIC) {
    if (!passphrase) throw new Error('archive is encrypted: passphrase required')
    return { zip: zipRead(decrypt(file, passphrase)), encrypted: true }
  }
  if (file.subarray(0, 7).toString() !== MAGIC) throw new Error('unknown archive format')
  return { zip: zipRead(file.subarray(MAGIC.length)), encrypted: false }
}

function manifestOf(zip: ZipInput[]): BackupManifest {
  const file = zip.find(entry => entry.name === 'manifest.json')
  if (!file) throw new Error('manifest.json is missing')
  const parsed = JSON.parse(file.data.toString('utf8')) as BackupManifest
  if (parsed.format !== 'llmmem' || parsed.formatVersion !== 1) throw new Error('unsupported manifest format')
  return parsed
}

function walk(root: string, prefix: string, skip: Set<string>): ZipInput[] {
  const out: ZipInput[] = []
  const visit = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (skip.has(full)) continue
      const info = statSync(full)
      if (info.isDirectory()) visit(full)
      else out.push({ name: `${prefix}/${relative(root, full).split('\\').join('/')}`, data: readFileSync(full) })
    }
  }
  if (existsSync(root)) visit(root)
  return out
}

function historyPath(backupsDir: string): string {
  return join(backupsDir, HISTORY)
}

function readHistory(backupsDir: string): Array<Record<string, unknown>> {
  const file = historyPath(backupsDir)
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line) as Record<string, unknown>)
}

function appendHistory(backupsDir: string, record: Record<string, unknown>): void {
  mkdirSync(backupsDir, { recursive: true })
  const line = `${JSON.stringify(record)}\n`
  const file = historyPath(backupsDir)
  writeFileSync(file, (existsSync(file) ? readFileSync(file, 'utf8') : '') + line, 'utf8')
}

function stamp(now: Date): string {
  return now.toISOString().replace(/[:.]/g, '-')
}

function snapshotDb(dbPath: string, target: string): void {
  mkdirSync(join(target, '..'), { recursive: true })
  if (!existsSync(dbPath)) throw new Error(`database not found: ${dbPath}`)
  const db = openDatabase(dbPath)
  try {
    db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`)
  } finally {
    db.close()
  }
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

/* ------------------------------------------------------------------ API --- */

export function createBackup(options: CreateOptions): BackupReport {
  mkdirSync(options.backupsDir, { recursive: true })
  const tmp = mkdtempSync(join(tmpdir(), 'llmmem-create-'))
  try {
    const dbFile = join(tmp, 'db', 'memory.db')
    snapshotDb(options.dbPath, dbFile)
    const skip = new Set([resolve(options.dbPath), resolve(options.backupsDir)])
    const files: ZipInput[] = [
      { name: 'db/memory.db', data: readFileSync(dbFile) },
      ...walk(options.storeDir, 'store', skip),
    ]
    const projects: BackupManifest['projects'] = []
    ;(options.projectDirs ?? []).forEach((dir, index) => {
      const archivePath = `project/${index}`
      files.push(...walk(dir, archivePath, skip))
      projects.push({ archivePath, originalPath: resolve(dir) })
    })
    const entries = files.map(file => ({ archivePath: file.name, sha256: sha256(file.data), size: file.data.length }))
    const manifest: BackupManifest = {
      format: 'llmmem',
      formatVersion: 1,
      createdAt: (options.now ?? new Date()).toISOString(),
      harness: options.harness,
      storeId: sha256(resolve(options.storeDir)).slice(0, 16),
      schemaVersion: CORE_SCHEMA_VERSION,
      db: 'db/memory.db',
      entries,
      projects,
    }
    const zip = zipWrite([{ name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8') }, ...files])
    const body = options.passphrase ? encrypt(zip, options.passphrase) : Buffer.concat([Buffer.from(MAGIC), zip])
    const name = `memory-${stamp(options.now ?? new Date())}.llmmem`
    const archive = join(options.backupsDir, name)
    const partial = `${archive}.partial`
    writeFileSync(partial, body)
    renameSync(partial, archive)
    appendHistory(options.backupsDir, {
      action: 'create',
      archive: name,
      at: manifest.createdAt,
      harness: manifest.harness,
      bytes: body.length,
      encrypted: Boolean(options.passphrase),
    })
    return { archive, bytes: body.length, manifest, encrypted: Boolean(options.passphrase) }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

export function verifyBackup(archive: string, passphrase?: string): VerifyReport {
  const errors: string[] = []
  let manifest: BackupManifest | null = null
  let encrypted = false
  try {
    if (!existsSync(archive)) return { ok: false, archive, encrypted: false, errors: ['archive not found'], manifest: null }
    const decoded = decode(readFileSync(archive), passphrase)
    encrypted = decoded.encrypted
    manifest = manifestOf(decoded.zip)
    if (manifest.schemaVersion > CORE_SCHEMA_VERSION) errors.push(`schema-mismatch: archive ${manifest.schemaVersion} > supported ${CORE_SCHEMA_VERSION}`)
    for (const entry of manifest.entries) {
      const file = decoded.zip.find(item => item.name === entry.archivePath)
      if (!file) {
        errors.push(`missing: ${entry.archivePath}`)
        continue
      }
      if (sha256(file.data) !== entry.sha256) errors.push(`checksum: ${entry.archivePath}`)
      if (file.data.length !== entry.size) errors.push(`size: ${entry.archivePath}`)
    }
    if (missingDb(manifest)) errors.push('db: archive has no database snapshot')
  } catch (error) {
    errors.push(String(error))
  }
  return { ok: errors.length === 0, archive, encrypted, errors, manifest }
}

function missingDb(manifest: BackupManifest): boolean {
  return !manifest.entries.some(entry => entry.archivePath === manifest.db)
}

export function listBackups(backupsDir: string, passphrase?: string): BackupRecord[] {
  if (!existsSync(backupsDir)) return []
  const records: BackupRecord[] = []
  for (const name of readdirSync(backupsDir)) {
    if (!name.endsWith('.llmmem')) continue
    const archive = join(backupsDir, name)
    try {
      const file = readFileSync(archive)
      const decoded = decode(file, passphrase)
      const manifest = manifestOf(decoded.zip)
      records.push({ archive, createdAt: manifest.createdAt, harness: manifest.harness, schemaVersion: manifest.schemaVersion, bytes: file.length, encrypted: decoded.encrypted })
    } catch {
      records.push({ archive, createdAt: '', harness: 'unknown', schemaVersion: 0, bytes: statSync(archive).size, encrypted: fileStartsWith(archive, ENCRYPTED_MAGIC) })
    }
  }
  return records.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

function fileStartsWith(file: string, prefix: string): boolean {
  return readFileSync(file).subarray(0, prefix.length).toString() === prefix
}

export function deleteBackup(archive: string, confirm: string | undefined, backupsDir?: string): boolean {
  if (confirm !== 'DELETE') throw new Error('delete requires confirm: "DELETE"')
  if (!existsSync(archive)) return false
  rmSync(archive, { force: true })
  appendHistory(backupsDir ?? dirname(archive), { action: 'delete', archive: resolve(archive), at: new Date().toISOString() })
  return true
}

function replaceDb(staged: string, dbPath: string): void {
  mkdirSync(join(dbPath, '..'), { recursive: true })
  for (const suffix of ['', '-wal', '-shm']) rmSync(dbPath + suffix, { force: true })
  copyFileSync(staged, dbPath)
}

function restoreFromArchive(
  archive: string,
  target: BackupTarget,
  passphrase?: string,
  rollbackPaths?: { projects: Array<{ archivePath: string; originalPath: string }> },
): { files: number; counts: { entries: number; active: number }; integrityCheck: string } {
  const decoded = decode(readFileSync(archive), passphrase)
  const manifest = manifestOf(decoded.zip)
  if (manifest.harness !== target.harness) throw new Error(`cross-harness restore is forbidden: archive ${manifest.harness}, target ${target.harness}`)
  const tmp = mkdtempSync(join(tmpdir(), 'llmmem-restore-'))
  try {
    const stagedDb = join(tmp, 'memory.db')
    const dbEntry = decoded.zip.find(entry => entry.name === manifest.db)
    if (!dbEntry) throw new Error('archive has no database snapshot')
    writeFileSync(stagedDb, dbEntry.data)
    replaceDb(stagedDb, target.dbPath)
    let files = 0
    for (const entry of decoded.zip) {
      if (!entry.name.startsWith('store/') && !entry.name.startsWith('project/')) continue
      const parts = entry.name.split('/')
      const relativeName = (entry.name.startsWith('store/') ? parts.slice(1) : parts.slice(2)).join('/')
      const root = entry.name.startsWith('store/') ? target.storeDir : projectRootFor(entry.name, manifest, rollbackPaths ?? { projects: manifest.projects })
      if (!root) continue
      const destination = join(root, relativeName)
      mkdirSync(join(destination, '..'), { recursive: true })
      writeFileSync(destination, entry.data)
      files += 1
    }
    const db = openDatabase(target.dbPath)
    try {
      ensureSchemaV2(db)
      ensureRevisionsTable(db)
    } finally {
      db.close()
    }
    const integrity = openDatabase(target.dbPath)
    try {
      const report = integrity.prepare('PRAGMA integrity_check').get<{ integrity_check: string }>()?.integrity_check ?? 'unknown'
      return { files, counts: counts(target.dbPath), integrityCheck: report }
    } finally {
      integrity.close()
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

function projectRootFor(
  archivePath: string,
  manifest: BackupManifest,
  target: { projects: Array<{ archivePath: string; originalPath: string }> },
): string | null {
  const prefix = archivePath.split('/').slice(0, 2).join('/')
  const fromArchive = manifest.projects.find(project => project.archivePath === prefix)
  if (!fromArchive) return null
  const mapped = target.projects.find(project => project.archivePath === prefix)
  return mapped?.originalPath ?? fromArchive.originalPath
}

export function restoreBackup(options: RestoreOptions & { _skipPreBackup?: boolean }): RestoreReport {
  if (options.confirm !== 'RESTORE') throw new Error('restore requires confirm: "RESTORE"')
  const verification = verifyBackup(options.archive, options.passphrase)
  if (!verification.ok) throw new Error(`archive failed verification: ${verification.errors.join('; ')}`)
  if (verification.manifest && verification.manifest.harness !== options.harness) {
    throw new Error(`cross-harness restore is forbidden: archive ${verification.manifest.harness}, target ${options.harness}`)
  }
  let preRestoreBackup: string | null = null
  const report: RestoreReport = {
    restored: false,
    archive: options.archive,
    preRestoreBackup: null,
    files: 0,
    counts: { entries: 0, active: 0 },
    integrityCheck: 'unknown',
    rolledBack: false,
  }
  if (!options._skipPreBackup && existsSync(options.dbPath)) {
    preRestoreBackup = createBackup({
      harness: options.harness,
      storeDir: options.storeDir,
      dbPath: options.dbPath,
      projectDirs: options.projectDirs ?? [],
      backupsDir: options.backupsDir,
      now: options.now ?? new Date(),
      ...(options.passphrase ? { passphrase: options.passphrase } : {}),
    }).archive
    report.preRestoreBackup = preRestoreBackup
  }
  const target: BackupTarget = {
    harness: options.harness,
    storeDir: options.storeDir,
    dbPath: options.dbPath,
    projectDirs: options.projectDirs ?? [],
  }
  try {
    const restored = restoreFromArchive(options.archive, target, options.passphrase, {
      projects: (options.projectDirs ?? []).map((dir, index) => ({ archivePath: `project/${index}`, originalPath: resolve(dir) })),
    })
    report.files = restored.files
    report.counts = restored.counts
    report.integrityCheck = restored.integrityCheck
    report.restored = true
    appendHistory(options.backupsDir, { action: 'restore', archive: resolve(options.archive), at: new Date().toISOString(), files: restored.files })
  } catch (error) {
    if (preRestoreBackup) {
      restoreFromArchive(preRestoreBackup, target, options.passphrase)
      report.rolledBack = true
    }
    throw error
  }
  return report
}

export function backupHistory(backupsDir: string): Array<Record<string, unknown>> {
  return readHistory(backupsDir)
}

export type { BackupManifest as Manifest }

/** ZIP helpers exposed for tests that need to craft malformed archives. */
export const __archive = { zipWrite, zipRead }


/**
 * Directory backups are written to: empty means `<store>/backups`, a relative
 * value is resolved against the store (never against the process cwd, which is
 * why archives used to land in an unexpected folder), absolute Windows/UNC and
 * Linux paths are kept as-is.
 */
export function resolveBackupDir(storeDir: string, backupDir: string | undefined): string {
  const value = (backupDir ?? '').trim()
  if (value.length === 0) return join(storeDir, 'backups')
  if (isAbsolute(value) || win32.isAbsolute(value)) return value
  return join(storeDir, value)
}
