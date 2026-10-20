/**
 * Backup/restore/rollback on every harness (этап 11, ADR-005): the same archive
 * round-trips for Kilo, OpenCode, MCP and DSH, restore replaces the live store
 * and keeps a pre-restore backup, destructive steps need typed confirmation.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { MemoryEngine } from '@llm-memory/core/application/engine'
import { mergeConfig } from '@llm-memory/core/domain/config'
import { createBackup, restoreBackup, verifyBackup } from '@llm-memory/core/infrastructure/backup'
import { DEFAULT_KILO_CONFIG, resolveKiloConfig } from '@llm-memory/adapter/kilo/config'
import { KiloService } from '@llm-memory/adapter/kilo/service'
import { DEFAULT_OPENCODE_CONFIG, resolveOpenCodeConfig } from '@llm-memory/adapter/opencode/config'
import { OpenCodeService } from '@llm-memory/adapter/opencode/service'
import { DEFAULT_MCP_CONFIG, resolveMcpConfig } from '@llm-memory/adapter/mcp/config'
import { startMcpWebServer } from '@llm-memory/adapter/mcp/panel'
import { McpService } from '@llm-memory/adapter/mcp/service'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function sandbox(): { dir: string; home: string; repo: string } {
  const dir = mkdtempSync(join(tmpdir(), 'llm-backup-all-'))
  dirs.push(dir)
  const home = join(dir, 'home')
  const repo = join(dir, 'repo')
  mkdirSync(home, { recursive: true })
  mkdirSync(repo, { recursive: true })
  return { dir, home, repo }
}

describe('OpenCode backup', () => {
  it('creates, verifies and restores with a pre-restore backup', () => {
    const { dir, repo } = sandbox()
    const config = resolveOpenCodeConfig({
      memory: { ...DEFAULT_OPENCODE_CONFIG.memory, storageRoot: join(dir, 'oc') },
    })
    const service = new OpenCodeService({ config, projectRoot: repo, configDir: join(dir, 'oc-conf') })
    service.init()
    try {
      service.save({ text: 'before backup', title: 'safe' })
      const report = service.backupCreate()
      expect(statSync(report.archive).size).toBeGreaterThan(0)
      expect(verifyBackup(report.archive).ok).toBe(true)

      service.save({ text: 'after backup', title: 'extra' })
      expect(service.status().total).toBe(2)
      const restored = service.backupRestore(basename(report.archive), 'RESTORE')
      expect(restored.preRestoreBackup).toBeDefined()
      expect(existsSync(restored.preRestoreBackup!)).toBe(true)
      expect(service.status().total).toBe(1)
      expect(() => service.backupRestore(basename(report.archive), undefined)).toThrow(/RESTORE/)
      expect(() => service.backupDelete(basename(report.archive), 'yes')).toThrow(/DELETE/)
    } finally {
      service.close()
    }
  })
})

describe('MCP backup', () => {
  it('goes through the panel API with typed confirmations', async () => {
    const { dir, home, repo } = sandbox()
    const config = resolveMcpConfig({
      ...DEFAULT_MCP_CONFIG,
      memory: { ...DEFAULT_MCP_CONFIG.memory, storageRoot: join(dir, 'mcp') },
    })
    const service = new McpService({ config, clientId: 'backup', home, projectRoot: repo })
    service.init()
    const panel = await startMcpWebServer({ service, config, port: 0 })
    const url = panel.url!
    try {
      service.save({ text: 'mcp before backup', title: 'safe' })
      const created = (await (await fetch(new URL('api/legacy/backups/create', url), { method: 'POST' })).json()) as {
        report: { archive: string }
      }
      expect(verifyBackup(created.report.archive).ok).toBe(true)
      const list = (await (await fetch(new URL('api/legacy/backups', url))).json()) as { backups: unknown[] }
      expect(list.backups.length).toBe(1)

      service.save({ text: 'mcp after backup', title: 'extra' })
      const refused = await fetch(new URL('api/legacy/backups/restore', url), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: basename(created.report.archive), confirm: 'nope' }),
      })
      expect(refused.status).toBe(400)
      expect(service.status().total).toBe(2)

      const restored = await fetch(new URL('api/legacy/backups/restore', url), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: basename(created.report.archive), confirm: 'RESTORE' }),
      })
      expect(restored.status).toBe(200)
      expect(service.status().total).toBe(1)
    } finally {
      await panel.close()
      service.close()
    }
  })
})

describe('DSH backup', () => {
  it('restores into a fresh store and matches the entry count', async () => {
    const { dir } = sandbox()
    const root = join(dir, 'dsh')
    const config = mergeConfig({})
    const engine = new MemoryEngine({ storageRoot: root, project: 'demo', config })
    engine.save({ text: 'dsh backup fact', title: 'dsh fact' })
    const dbPath = engine.getStore().dbPath
    const storeDir = engine.getStore().root
    engine.close()

    const report = createBackup({ harness: 'dsh', storeDir, dbPath, projectDirs: [], backupsDir: join(root, 'backups') })
    expect(verifyBackup(report.archive).ok).toBe(true)

    const restoredRoot = join(dir, 'dsh-restored')
    const restored = restoreBackup({
      harness: 'dsh',
      storeDir: restoredRoot,
      dbPath: join(restoredRoot, 'db', 'memory.db'),
      projectDirs: [],
      backupsDir: join(dir, 'dsh-restored-backups'),
      archive: report.archive,
      confirm: 'RESTORE',
    })
    expect(restored.preRestoreBackup ?? null).toBeNull()

    const reopened = new MemoryEngine({ storageRoot: restoredRoot, project: 'demo', config })
    try {
      expect(reopened.statusReport().total).toBe(1)
      const recalled = await reopened.recall('dsh backup', { touch: false })
      expect(recalled.items.map(item => item.title)).toContain('dsh fact')
    } finally {
      reopened.close()
    }
  })
})

describe('Kilo backup', () => {
  it('round-trips through the service with the same guards', () => {
    const { dir, repo } = sandbox()
    const config = resolveKiloConfig({
      memory: { ...DEFAULT_KILO_CONFIG.memory, storageRoot: join(dir, 'kilo') },
    })
    const service = new KiloService({ config, projectRoot: repo, configDir: join(dir, 'kilo-conf') })
    service.init()
    try {
      service.save({ text: 'kilo before backup', title: 'safe' })
      const report = service.backupCreate()
      service.save({ text: 'kilo after backup', title: 'extra' })
      const restored = service.backupRestore(basename(report.archive), 'RESTORE')
      expect(restored.preRestoreBackup).toBeDefined()
      expect(service.status().total).toBe(1)
    } finally {
      service.close()
    }
  })
})
