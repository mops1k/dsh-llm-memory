import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { createMemoryRuntime } from '../src/dsh/engine'
import { createDshBridge } from '../src/dsh/ui-bridge'
import { createKiloLayout, createDshLayout } from '@llm-memory/core/layout/index'
import { storesAreSeparate } from '../packages/testkit/src/index'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'llm-dsh-bridge-'))
  dirs.push(root)
  const runtime = createMemoryRuntime({ storageRoot: join(root, 'store') })
  const bridge = createDshBridge({ engine: runtime.engine, storageRoot: join(root, 'store') })
  return { runtime, bridge, root }
}

describe('DSH UI bridge', () => {
  it('serves status, save, recall and graph through DshUiHost', async () => {
    const { runtime, bridge } = setup()
    try {
      await bridge.request('save', { text: 'DSH bridge fact', scope: 'user' })
      const items = (await bridge.request('list')) as unknown[]
      expect(items).toHaveLength(1)
      const recall = (await bridge.host.request('recall', { query: 'bridge' })) as { items: unknown[] }
      expect(recall.items.length).toBeGreaterThan(0)
      const status = (await bridge.request('status')) as { total: number }
      expect(status.total).toBe(1)
      const graph = (await bridge.request('graph')) as { entities: unknown[] }
      expect(graph.entities).toHaveLength(1)
      expect((await bridge.request('lint')) as { issues: unknown[] }).toBeTruthy()
      expect(await bridge.request('health')).toBeTruthy()
      const settings = (await bridge.request('settings.get')) as { backupDir: string }
      expect(settings.backupDir).toBe('')
    } finally {
      runtime.close()
    }
  })

  it('creates, verifies and restores DSH backups through the bridge', async () => {
    const { runtime, bridge } = setup()
    try {
      await bridge.request('save', { text: 'backup me', scope: 'user' })
      const created = (await bridge.request('backup.create')) as { name: string }
      expect(created.name).toMatch(/\.llmmem$/)
      const listed = (await bridge.request('backup.list')) as Array<Record<string, unknown>>
      expect(listed).toHaveLength(1)
      const verified = (await bridge.request('backup.verify', { archive: (listed[0] as { archive: string }).archive })) as { ok: boolean }
      expect(verified.ok).toBe(true)
      const restored = (await bridge.request('backup.restore', { archive: (listed[0] as { archive: string }).archive, confirm: 'RESTORE' })) as { restored: boolean }
      expect(restored.restored).toBe(true)
      await expect(bridge.request('backup.delete', { archive: 'x', confirm: 'yes' })).rejects.toThrow(/DELETE/)
    } finally {
      runtime.close()
    }
  })

  it('keeps DSH and Kilo stores separate', () => {
    const { root } = { root: mkdtempSync(join(tmpdir(), 'llm-iso-')) }
    dirs.push(root)
    expect(storesAreSeparate(createDshLayout({ home: root, cwd: root }), createKiloLayout({ home: root, cwd: root }))).toBe(true)
  })
})
