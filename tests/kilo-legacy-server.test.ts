import { afterEach, describe, expect, it } from 'vitest'

import { cleanupRoot, trackResource } from './helpers'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
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
  const created = trackResource(new KiloService({ config }))
  created.init()
  service = created
  return created
}

afterEach(async () => {
  await handle?.close()
  handle = null
  service?.close()
  service = null
  for (const dir of dirs.splice(0)) cleanupRoot(dir)
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

  it('serves the universal UI snapshot with the panel screens', async () => {
    const base = await start()
    const snapshot = await (await fetch(`${base}api/legacy/ui/snapshot`)).json()
    expect(snapshot.version).toBeGreaterThan(0)
    const ids = snapshot.views.map((view: { id: string }) => view.id)
    for (const required of ['overview', 'items', 'editor', 'graph', 'map', 'recall', 'health', 'settings', 'backup', 'model']) {
      expect(ids).toContain(required)
    }
    const titles = snapshot.views.map((view: { title: string }) => view.title)
    expect(titles).toContain('Карта RAG')
    expect(titles).toContain('Бэкапы')
    expect(snapshot.actions.length).toBeGreaterThan(0)
  })

  it('serves the dashboard page and the Russian schema snapshots', async () => {
    const base = await start()
    const page = await fetch(base)
    expect(page.status).toBe(200)
    expect(page.headers.get('content-type')).toContain('text/html')
    const snapshot = await (await fetch(`${base}api/legacy/ui/snapshot`)).json()
    const titles = snapshot.views.map((view: { title: string }) => view.title)
    expect(titles).toContain('Карта RAG')
    expect(titles).toContain('Бэкапы')
    const settings = await (await fetch(`${base}api/legacy/settings/snapshot`)).json()
    expect(settings.snapshot.groups[0].title).toBe('Хранилище и проекты')
  })

  it('serves both panel locales for the language switcher', async () => {
    const base = await start()
    const english = await (await fetch(`${base}api/legacy/ui/snapshot?locale=en`)).json()
    expect(english.views.find((view: { id: string }) => view.id === 'items').title).toBe('Entries')
    const englishSettings = await (await fetch(`${base}api/legacy/settings/snapshot?locale=en`)).json()
    expect(englishSettings.snapshot.groups[0].title).toBe('Storage & projects')
  })

  it('counts projects from entries even without a project root registry', async () => {
    const service = makeService()
    service.save({ text: 'one', project: 'alpha', scope: 'project' })
    service.save({ text: 'two', project: 'beta', scope: 'project' })
    handle = await startKiloWebServer({
      service,
      config: resolveKiloConfig({ memory: { storageRoot: service.store.root }, web: { enabled: true } }),
      port: 0,
    })
    const status = await (await fetch(`${handle.url}api/legacy/status`)).json()
    expect(status.status.projects).toBe(2)
    const projects = await (await fetch(`${handle.url}api/legacy/projects`)).json()
    expect(projects.projects).toEqual(['alpha', 'beta'])
  })

  it('resolves a relative backupDir inside the store, not the process cwd', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kilo-backup-dir-'))
    dirs.push(root)
    const config = resolveKiloConfig({ memory: { storageRoot: root, backupDir: 'backups' }, web: { enabled: false } })
    const created = trackResource(new KiloService({ config }))
    created.init()
    service = created
    const report = created.backupCreate()
    expect(report.archive.startsWith(join(root, 'backups'))).toBe(true)
    expect(existsSync(report.archive)).toBe(true)
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

})
