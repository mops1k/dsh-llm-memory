import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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
  return fetch(`${url}api/backup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ operation, input }),
  })
}

describe('kilo backup API', () => {
  it('creates, lists and verifies backups through the shared service', async () => {
    const { service, handle } = await setup()
    try {
      const target = service.backupTarget()
      expect(target.backupsDir).toBe(join(service.store.root, 'backups'))

      const created = (await call(handle.url!, 'backup.create').then(response => response.json())) as {
        archive: string
        manifest: { harness: string }
      }
      expect(existsSync(created.archive)).toBe(true)
      expect(created.manifest.harness).toBe('kilo')

      const listed = (await fetch(`${handle.url}api/backup`).then(response => response.json())) as Array<Record<string, unknown>>
      expect(listed).toHaveLength(1)
      expect(listed[0]).toMatchObject({ includesVectors: false, encrypted: false })
      expect(listed[0]!['name']).toMatch(/^memory-.*\.llmmem$/)

      const verified = (await call(handle.url!, 'backup.verify', { archive: created.archive }).then(response => response.json())) as { ok: boolean }
      expect(verified.ok).toBe(true)

      const restored = (await call(handle.url!, 'backup.restore', { archive: created.archive, confirm: 'RESTORE' }).then(response => response.json())) as {
        restored: boolean
        counts: { entries: number }
      }
      expect(restored.restored).toBe(true)
      expect(restored.counts.entries).toBe(2)
      expect(await fetch(`${handle.url}api/backup`).then(response => response.json())).toHaveLength(2)
    } finally {
      await handle.close()
      service.close()
    }
  })

  it('refuses delete without the typed confirmation', async () => {
    const { service, handle } = await setup()
    try {
      const created = (await call(handle.url!, 'backup.create').then(response => response.json())) as { archive: string }
      const denied = await call(handle.url!, 'backup.delete', { archive: created.archive, confirm: 'yes' })
      expect(denied.status).toBe(400)
      expect(existsSync(created.archive)).toBe(true)
      const accepted = (await call(handle.url!, 'backup.delete', { archive: created.archive, confirm: 'DELETE' }).then(response => response.json())) as { deleted: boolean }
      expect(accepted.deleted).toBe(true)
      expect(existsSync(created.archive)).toBe(false)
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
