import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { DEFAULT_KILO_CONFIG, resolveKiloConfig } from '@llm-memory/adapter/kilo/config'
import { KiloService } from '@llm-memory/adapter/kilo/service'
import { startKiloWebServer } from '@llm-memory/adapter/kilo/web-server'
import { llmMemoryBackupTool } from '@llm-memory/adapter/mcp/backup-tool'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

async function setup() {
  const base = mkdtempSync(join(tmpdir(), 'llm-kilo-bk-'))
  dirs.push(base)
  const config = resolveKiloConfig({
    memory: { ...DEFAULT_KILO_CONFIG.memory, storageRoot: join(base, 'store') },
    web: { ...DEFAULT_KILO_CONFIG.web, enabled: true, port: 0 },
  })
  const service = new KiloService({ config })
  service.init()
  service.save({ text: 'backup fact one', scope: 'global' })
  service.save({ text: 'backup fact two', scope: 'global' })
  const handle = await startKiloWebServer({ service, config, port: 0 })
  return { service, config, handle, base }
}

async function call(url: string, operation: string, input?: unknown): Promise<Response> {
  const payload = (input ?? {}) as { archive?: string; name?: string; confirm?: string }
  const name = payload.name ?? (payload.archive ? basename(payload.archive) : undefined)
  const route = { 'backup.create': 'create', 'backup.verify': 'verify', 'backup.restore': 'restore', 'backup.delete': 'delete' }[operation]
  return fetch(`${url}api/legacy/backups/${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...(name ? { name } : {}), ...(payload.confirm ? { confirm: payload.confirm } : {}) }),
  })
}

describe('kilo backup API', () => {
  it('creates, lists and verifies backups through the shared service', async () => {
    const { service, handle } = await setup()
    try {
      const target = service.backupTarget()
      expect(target.backupsDir).toBe(join(service.store.root, 'backups'))

      const created = (await call(handle.url!, 'backup.create').then(response => response.json())) as {
        report: { archive: string; manifest: { harness: string } }
      }
      expect(existsSync(created.report.archive)).toBe(true)
      expect(created.report.manifest.harness).toBe('kilo')

      const listed = (await fetch(`${handle.url}api/legacy/backups`).then(response => response.json())) as {
        backups: Array<Record<string, unknown>>
      }
      expect(listed.backups).toHaveLength(1)
      expect(String(listed.backups[0]!['archive'])).toMatch(/memory-.*\.llmmem$/)
      expect(listed.backups[0]!['createdAt']).toBeTruthy()
      expect(listed.backups[0]!['encrypted']).toBe(false)

      const verified = (await call(handle.url!, 'backup.verify', { archive: created.report.archive }).then(response => response.json())) as { ok: boolean }
      expect(verified.ok).toBe(true)

      const restored = (await call(handle.url!, 'backup.restore', { archive: created.report.archive, confirm: 'RESTORE' }).then(response => response.json())) as {
        report: { restored: boolean; counts: { entries: number } }
      }
      expect(restored.report.restored).toBe(true)
      expect(restored.report.counts.entries).toBe(2)
      expect(((await fetch(`${handle.url}api/legacy/backups`).then(response => response.json())) as { backups: unknown[] }).backups).toHaveLength(2)
    } finally {
      await handle.close()
      service.close()
    }
  })

  it('refuses delete without the typed confirmation', async () => {
    const { service, handle } = await setup()
    try {
      const created = (await call(handle.url!, 'backup.create').then(response => response.json())) as { report: { archive: string } }
      const denied = await call(handle.url!, 'backup.delete', { archive: created.report.archive, confirm: 'yes' })
      expect(denied.status).toBe(400)
      expect(existsSync(created.report.archive)).toBe(true)
      const accepted = (await call(handle.url!, 'backup.delete', { archive: created.report.archive, confirm: 'DELETE' }).then(response => response.json())) as { deleted: boolean }
      expect(accepted.deleted).toBe(true)
      expect(existsSync(created.report.archive)).toBe(false)
    } finally {
      await handle.close()
      service.close()
    }
  })

  it('exposes create/list/verify through llm_memory_backup and blocks restore', async () => {
    const { service } = await setup()
    try {
      const tool = llmMemoryBackupTool(() => ({ harness: 'kilo', ...service.backupTarget() }))
      const created = JSON.parse(await tool.execute({ operation: 'create' })) as { ok: boolean; archive: string }
      expect(created.ok).toBe(true)
      const listed = JSON.parse(await tool.execute({ operation: 'list' })) as { backups: unknown[] }
      expect(listed.backups).toHaveLength(1)
      const verified = JSON.parse(await tool.execute({ operation: 'verify', archive: created.archive })) as { ok: boolean }
      expect(verified.ok).toBe(true)
      const blocked = JSON.parse(await tool.execute({ operation: 'restore' })) as { ok: boolean; error: string }
      expect(blocked.ok).toBe(false)
      expect(blocked.error).toContain('user-only')
    } finally {
      service.close()
    }
  })
})
