import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { resolveKiloConfig } from '@llm-memory/adapter/kilo/config'
import { KiloService } from '@llm-memory/adapter/kilo/service'
import { startKiloWebServer, type KiloWebHandle } from '@llm-memory/adapter/kilo/web-server'

const dirs: string[] = []
let handle: KiloWebHandle | null = null
let service: KiloService | null = null

function makeService(): KiloService {
  const root = mkdtempSync(join(tmpdir(), 'kilo-legacy-server-'))
  dirs.push(root)
  const config = resolveKiloConfig({ memory: { storageRoot: root }, web: { enabled: false } })
  const created = new KiloService({ config })
  created.init()
  service = created
  return created
}

afterEach(async () => {
  await handle?.close()
  handle = null
  service?.close()
  service = null
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

async function start(): Promise<string> {
  const created = makeService()
  handle = await startKiloWebServer({
    service: created,
    config: resolveKiloConfig({ memory: { storageRoot: created.store.root }, web: { enabled: true } }),
    port: 0,
  })
  expect(handle.url).not.toBeNull()
  return handle.url as string
}

describe('kilo legacy panel API', () => {
  it('serves the project list, schema-driven settings and model status', async () => {
    const base = await start()
    const projects = await (await fetch(`${base}api/legacy/projects`)).json()
    expect(projects).toEqual({ ok: true, projects: [] })

    const snapshot = await (await fetch(`${base}api/legacy/settings/snapshot`)).json()
    expect(snapshot.ok).toBe(true)
    expect(snapshot.snapshot.groups.length).toBeGreaterThan(0)
    expect(snapshot.snapshot.actions.some((action: { id: string }) => action.id === 'backup.create')).toBe(true)

    const model = await (await fetch(`${base}api/legacy/model/status`)).json()
    expect(model.ok).toBe(true)
    expect(model.status).toHaveProperty('cached')
  })

  it('creates, lists, verifies and deletes a backup through the panel API', async () => {
    const base = await start()
    const created = await (await fetch(`${base}api/legacy/backups/create`, { method: 'POST' })).json()
    expect(created.ok).toBe(true)
    expect(created.report.archive).toMatch(/\.llmmem$/)

    const listed = await (await fetch(`${base}api/legacy/backups`)).json()
    expect(listed.backups).toHaveLength(1)
    const name = String(listed.backups[0].archive).split('/').pop()

    const verified = await (
      await fetch(`${base}api/legacy/backups/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      })
    ).json()
    expect(verified.report.ok).toBe(true)

    const deleted = await (
      await fetch(`${base}api/legacy/backups/delete`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, confirm: 'DELETE' }),
      })
    ).json()
    expect(deleted.deleted).toBe(true)
  })

  it('runs the import action and reports per-source numbers', async () => {
    const base = await start()
    const imported = await (await fetch(`${base}api/legacy/import`, { method: 'POST' })).json()
    expect(imported.ok).toBe(true)
    expect(Array.isArray(imported.reports)).toBe(true)
    for (const report of imported.reports) {
      expect(report).toHaveProperty('source')
      expect(report).toHaveProperty('imported')
      expect(report).toHaveProperty('skipped')
    }
  })
})
