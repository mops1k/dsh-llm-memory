import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, describe, expect, it } from 'vitest'

import {
  __archive,
  backupHistory,
  createBackup,
  deleteBackup,
  listBackups,
  restoreBackup,
  verifyBackup,
} from '@llm-memory/core/infrastructure/backup'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

interface Sandbox {
  root: string
  storeDir: string
  dbPath: string
  backupsDir: string
  projectDir: string
}

function sandbox(): Sandbox {
  const root = mkdtempSync(join(tmpdir(), 'llmmem-backup-'))
  dirs.push(root)
  const storeDir = join(root, 'store')
  const dbPath = join(storeDir, '_db', 'memory.db')
  mkdirSync(join(storeDir, '_db'), { recursive: true })
  mkdirSync(join(storeDir, 'pages', 'facts'), { recursive: true })
  mkdirSync(join(storeDir, 'raw'), { recursive: true })
  mkdirSync(join(storeDir, 'config'), { recursive: true })
  writeFileSync(join(storeDir, 'pages', 'facts', 'one.md'), '---\nid: m_1\n---\nfact\n')
  writeFileSync(join(storeDir, 'raw', 'crystallize-s1.md'), '# digest\n')
  writeFileSync(join(storeDir, 'config', 'kilo-memory.json'), '{"memory":{}}')
  copyFileSync(join(import.meta.dirname, 'fixtures', 'kilo', 'memory.db'), dbPath)
  const projectDir = join(root, 'repo', '.kilo', 'memory', 'pages', 'facts')
  mkdirSync(projectDir, { recursive: true })
  writeFileSync(join(projectDir, 'project.md'), '---\nid: m_2\n---\nproject fact\n')
  return { root, storeDir, dbPath, backupsDir: join(root, 'backups'), projectDir: join(root, 'repo', '.kilo', 'memory') }
}

function create(box: Sandbox, extra: { passphrase?: string; harness?: 'kilo' | 'dsh' } = {}) {
  return createBackup({
    harness: extra.harness ?? 'kilo',
    storeDir: box.storeDir,
    dbPath: box.dbPath,
    projectDirs: [box.projectDir],
    backupsDir: box.backupsDir,
    ...(extra.passphrase ? { passphrase: extra.passphrase } : {}),
    now: new Date('2026-10-19T12:00:00Z'),
  })
}

function wipedTarget(box: Sandbox, harness: 'kilo' | 'dsh' = 'kilo'): Sandbox {
  const storeDir = join(box.root, 'target-store')
  mkdirSync(join(storeDir, '_db'), { recursive: true })
  mkdirSync(join(storeDir, 'pages'), { recursive: true })
  copyFileSync(join(import.meta.dirname, 'fixtures', 'kilo', 'memory.db'), join(storeDir, '_db', 'memory.db'))
  const projectDir = join(box.root, 'target-repo', '.kilo', 'memory')
  mkdirSync(projectDir, { recursive: true })
  return { ...box, harness, storeDir, dbPath: join(storeDir, '_db', 'memory.db'), projectDir }
}

describe('backup create/verify/list', () => {
  it('writes a verifiable archive with manifest, db and pages', () => {
    const box = sandbox()
    const report = create(box)
    expect(existsSync(report.archive)).toBe(true)
    expect(report.manifest.harness).toBe('kilo')
    const verification = verifyBackup(report.archive)
    expect(verification.ok).toBe(true)
    expect(verification.errors).toEqual([])
    expect(verification.manifest?.entries.some(entry => entry.archivePath === 'db/memory.db')).toBe(true)
    expect(verification.manifest?.entries.some(entry => entry.archivePath === 'store/pages/facts/one.md')).toBe(true)
    expect(verification.manifest?.projects[0]?.originalPath).toBe(box.projectDir)
    const listed = listBackups(box.backupsDir)
    expect(listed).toHaveLength(1)
    expect(listed[0]?.encrypted).toBe(false)
    expect(backupHistory(box.backupsDir)).toHaveLength(1)
  })

  it('rejects corrupted archives and missing manifests', () => {
    const box = sandbox()
    const report = create(box)
    const corrupted = join(box.backupsDir, 'corrupted.llmmem')
    writeFileSync(corrupted, readFileSync(report.archive).subarray(0, 100))
    expect(verifyBackup(corrupted).ok).toBe(false)
    const tampered = join(box.backupsDir, 'tampered.llmmem')
    const entries = __archive.zipRead(readFileSync(report.archive).subarray(7))
    entries[1] = { name: entries[1]!.name, data: Buffer.from('tampered') }
    writeFileSync(tampered, Buffer.concat([Buffer.from('LLMMEM1'), __archive.zipWrite(entries)]))
    const verification = verifyBackup(tampered)
    expect(verification.ok).toBe(false)
    expect(verification.errors.some(error => error.startsWith('checksum'))).toBe(true)
  })

  it('fails verification when the archive schema is newer than supported', () => {
    const box = sandbox()
    const report = create(box)
    const entries = __archive.zipRead(readFileSync(report.archive).subarray(7))
    const manifest = JSON.parse(entries.find(entry => entry.name === 'manifest.json')!.data.toString('utf8'))
    manifest.schemaVersion = 99
    const rewritten = entries.map(entry =>
      entry.name === 'manifest.json' ? { name: entry.name, data: Buffer.from(JSON.stringify(manifest)) } : entry,
    )
    const archive = join(box.backupsDir, 'future.llmmem')
    writeFileSync(archive, Buffer.concat([Buffer.from('LLMMEM1'), __archive.zipWrite(rewritten)]))
    const verification = verifyBackup(archive)
    expect(verification.ok).toBe(false)
    expect(verification.errors.some(error => error.includes('schema-mismatch'))).toBe(true)
  })

  it('round-trips through encryption', () => {
    const box = sandbox()
    const report = create(box, { passphrase: 'secret' })
    expect(report.encrypted).toBe(true)
    expect(verifyBackup(report.archive, 'secret').ok).toBe(true)
    expect(verifyBackup(report.archive).ok).toBe(false)
    const listed = listBackups(box.backupsDir, 'secret')
    expect(listed[0]?.encrypted).toBe(true)
    expect(verifyBackup(report.archive, 'wrong').ok).toBe(false)
  })
})

describe('backup restore/delete', () => {
  it('restores db and pages into a target of the same harness', () => {
    const box = sandbox()
    const report = create(box)
    const target = wipedTarget(box)
    const restored = restoreBackup({
      archive: report.archive,
      confirm: 'RESTORE',
      harness: 'kilo',
      storeDir: target.storeDir,
      dbPath: target.dbPath,
      projectDirs: [target.projectDir],
      backupsDir: box.backupsDir,
      now: new Date('2026-10-19T13:00:00Z'),
    })
    expect(restored.restored).toBe(true)
    expect(restored.counts).toEqual({ entries: 24, active: 20 })
    expect(restored.integrityCheck).toBe('ok')
    expect(readFileSync(join(target.storeDir, 'pages', 'facts', 'one.md'), 'utf8')).toContain('fact')
    expect(readFileSync(join(target.projectDir, 'pages', 'facts', 'project.md'), 'utf8')).toContain('project fact')
    expect(existsSync(`${target.dbPath}-wal`)).toBe(false)
    expect(restored.preRestoreBackup).not.toBeNull()
    expect(listBackups(box.backupsDir)).toHaveLength(2)
  })

  it('refuses cross-harness restore and requires the RESTORE confirmation', () => {
    const box = sandbox()
    const report = create(box)
    const target = wipedTarget(box)
    expect(() =>
      restoreBackup({
        archive: report.archive,
        confirm: 'RESTORE',
        harness: 'dsh',
        storeDir: target.storeDir,
        dbPath: target.dbPath,
        backupsDir: box.backupsDir,
      }),
    ).toThrow(/cross-harness/)
    expect(() =>
      restoreBackup({
        archive: report.archive,
        confirm: 'yes',
        harness: 'kilo',
        storeDir: target.storeDir,
        dbPath: target.dbPath,
        backupsDir: box.backupsDir,
      }),
    ).toThrow(/confirm/)
  })

  it('rolls back from the pre-restore backup when the archive is damaged mid-way', () => {
    const box = sandbox()
    const report = create(box)
    const entries = __archive.zipRead(readFileSync(report.archive).subarray(7))
    // Valid manifest and checksums, but the database bytes are not a database.
    const broken = entries.map(entry =>
      entry.name === 'db/memory.db' ? { name: entry.name, data: Buffer.from('not a database') } : entry,
    )
    const manifest = JSON.parse(entries.find(entry => entry.name === 'manifest.json')!.data.toString('utf8'))
    const dbEntry = manifest.entries.find((entry: { archivePath: string }) => entry.archivePath === 'db/memory.db')
    dbEntry.sha256 = '0000'
    const patched = broken.map(entry =>
      entry.name === 'manifest.json' ? { name: entry.name, data: Buffer.from(JSON.stringify(manifest)) } : entry,
    )
    const archive = join(box.backupsDir, 'broken-db.llmmem')
    writeFileSync(archive, Buffer.concat([Buffer.from('LLMMEM1'), __archive.zipWrite(patched)]))
    const target = wipedTarget(box)
    expect(() =>
      restoreBackup({
        archive,
        confirm: 'RESTORE',
        harness: 'kilo',
        storeDir: target.storeDir,
        dbPath: target.dbPath,
        backupsDir: box.backupsDir,
      }),
    ).toThrow(/verification|database/)
    const check = new DatabaseSync(target.dbPath, { readOnly: true })
    expect(check.prepare('SELECT COUNT(*) AS n FROM memories').get()).toEqual({ n: 24 })
    check.close()
  })

  it('deletes only with DELETE and never auto-prunes', () => {
    const box = sandbox()
    const report = create(box)
    expect(() => deleteBackup(report.archive, 'yes', box.backupsDir)).toThrow(/DELETE/)
    expect(listBackups(box.backupsDir)).toHaveLength(1)
    expect(deleteBackup(report.archive, 'DELETE', box.backupsDir)).toBe(true)
    expect(listBackups(box.backupsDir)).toHaveLength(0)
    expect(backupHistory(box.backupsDir).some(record => record['action'] === 'delete')).toBe(true)
  })
})
