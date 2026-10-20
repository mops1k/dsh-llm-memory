/**
 * OpenCode panel over the shared server: the schema-driven settings, the model
 * state and the RAG endpoints answer on the OpenCode port (8788 by default,
 * ephemeral in tests).
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { resolveOpenCodeConfig } from '@llm-memory/adapter/opencode/config'
import { OpenCodeService } from '@llm-memory/adapter/opencode/service'
import { startOpenCodeWebServer, type OpenCodeWebHandle } from '@llm-memory/adapter/opencode/web-server'

const dirs: string[] = []
let handle: OpenCodeWebHandle | null = null
let service: OpenCodeService | null = null

afterEach(async () => {
  await handle?.close()
  handle = null
  service?.close()
  service = null
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

async function start(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'opencode-panel-'))
  dirs.push(root)
  const config = resolveOpenCodeConfig({ memory: { storageRoot: root }, web: { enabled: true } })
  const created = new OpenCodeService({ config })
  created.init()
  service = created
  handle = await startOpenCodeWebServer({ service: created, config, port: 0 })
  expect(handle.url).not.toBeNull()
  return handle.url as string
}

describe('opencode legacy panel API', () => {
  it('serves the config, the schema snapshot and the model state', async () => {
    const base = await start()
    const projects = await (await fetch(`${base}api/legacy/projects`)).json()
    expect(projects).toEqual({ ok: true, projects: [] })

    const snapshot = await (await fetch(`${base}api/legacy/settings/snapshot`)).json()
    expect(snapshot.ok).toBe(true)
    expect(snapshot.snapshot.groups.length).toBeGreaterThan(0)
    expect(snapshot.snapshot.actions.some((action: { id: string }) => action.id === 'vectors.rebuild')).toBe(true)

    const model = await (await fetch(`${base}api/legacy/model/status`)).json()
    expect(model.ok).toBe(true)
    expect(model.status).toHaveProperty('cached')
    expect(model.status.runtime).toHaveProperty('present')

    const health = await (await fetch(`${base}api/legacy/vectors/health`)).json()
    expect(health.ok).toBe(true)
  })

  it('repairs the vector table over the panel API', async () => {
    const base = await start()
    const repaired = await (
      await fetch(`${base}api/legacy/vectors/repair`, { method: 'POST' })
    ).json()
    expect(repaired.ok).toBe(true)
    expect(repaired.report).toHaveProperty('checked')
    expect(repaired.report).toHaveProperty('orphansRemoved')
    expect(repaired.status).toBeDefined()
  })

  it('stores entries and answers the hybrid recall endpoint', async () => {
    const base = await start()
    const saved = await (
      await fetch(`${base}api/legacy/items`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'OpenCode panel fact about the memory store', scope: 'global' }),
      })
    ).json()
    expect(saved.ok).toBe(true)

    const recalled = await (await fetch(`${base}api/legacy/recall?q=memory%20store`)).json()
    expect(recalled.ok).toBe(true)
    expect(recalled.items[0].id).toBe(saved.item.id)
    expect(recalled.text).toContain('memory store')
  })
})
