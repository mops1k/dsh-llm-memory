import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { DEFAULT_KILO_CONFIG, resolveKiloConfig } from '@llm-memory/adapter/kilo/config'
import { createKiloRuntime } from '@llm-memory/adapter/kilo/runtime'
import { KiloService } from '@llm-memory/adapter/kilo/service'
import { startKiloWebServer } from '@llm-memory/adapter/kilo/web-server'

const roots: string[] = []
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function setup(promptMode: 'dynamic' | 'frozen' = 'dynamic', web = false) {
  const base = mkdtempSync(join(tmpdir(), 'llm-kilo-rt-'))
  roots.push(base)
  const config = resolveKiloConfig({
    memory: { ...DEFAULT_KILO_CONFIG.memory, storageRoot: join(base, 'store'), promptMode },
    web: { ...DEFAULT_KILO_CONFIG.web, enabled: web, port: 0 },
  })
  const service = new KiloService({ config })
  service.init()
  const runtime = createKiloRuntime({ service, config })
  return { service, runtime, config }
}

describe('kilo runtime', () => {
  it('registers tools as plain descriptors without the SDK', () => {
    const { runtime, service } = setup()
    expect(Object.keys(runtime.hooks.tool).sort()).toEqual(
      ['llm_memory_delete', 'llm_memory_forget', 'llm_memory_graph', 'llm_memory_lint', 'llm_memory_recall', 'llm_memory_save', 'llm_memory_status'],
    )
    expect(runtime.hooks['experimental.chat.system.transform']).toBeTypeOf('function')
    expect(runtime.hooks['experimental.session.compacting']).toBeTypeOf('function')
    service.close()
  })

  it('injects guidance and the rules digest into the system prompt', async () => {
    const { runtime, service } = setup()
    service.save({ text: 'Всегда коммитить после шага', kind: 'rules', scope: 'global', title: 'Правило коммитов' })
    const output = { system: ['base'] }
    await runtime.hooks['experimental.chat.system.transform']!({ sessionID: 's1' }, output)
    expect(output.system).toHaveLength(2)
    expect(output.system[1]).toContain('llm_memory_recall')
    expect(output.system[1]).toContain('Правило коммитов')
    service.close()
  })

  it('frozen mode keeps one block per session, dynamic rebuilds it', async () => {
    const frozen = setup('frozen')
    frozen.service.save({ text: 'frozen rule body', kind: 'rules', scope: 'global', title: 'Frozen rule' })
    const first = { system: ['base'] }
    await frozen.runtime.hooks['experimental.chat.system.transform']!({ sessionID: 's1' }, first)
    const second = { system: ['base'] }
    await frozen.runtime.hooks['experimental.chat.system.transform']!({ sessionID: 's1' }, second)
    expect(second.system[1]).toBe(first.system[1])
    expect(first.system[1]).toContain('### Правила')

    const dynamic = setup('dynamic')
    const d1 = { system: ['base'] }
    await dynamic.runtime.hooks['experimental.chat.system.transform']!({ sessionID: 's1' }, d1)
    const d2 = { system: ['base'] }
    await dynamic.runtime.hooks['experimental.chat.system.transform']!({ sessionID: 's1' }, d2)
    expect(d2.system[1]).toContain('llm_memory_save')
    frozen.service.close()
    dynamic.service.close()
  })

  it('compaction consolidates, crystallizes and adds memory lines', async () => {
    const { runtime, service } = setup()
    service.save({ text: 'rule body', kind: 'rules', scope: 'global', importance: 5 })
    const output = { context: ['ctx'] }
    await runtime.hooks['experimental.session.compacting']!({ sessionID: 's1' }, output)
    expect(output.context[1]).toMatch(/Память: всего 1/)
    expect(output.context[2]).toMatch(/Кристаллизация: .*raw/)
    expect(existsSync(join(service.layout.userRoot(), 'raw', 'crystallize-s1.md'))).toBe(true)
    service.close()
  })

  it('serves the panel API and page over HTTP', async () => {
    const { service, config } = setup('dynamic', true)
    const saved: unknown[] = []
    const handle = await startKiloWebServer({ service, config, port: 0, saveConfig: next => saved.push(next) })
    try {
      expect(handle.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/)
      const patched = await fetch(`${handle.url}api/settings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ operation: 'settings.set', input: { memory: { recallLimit: 7 } } }),
      }).then(response => response.json())
      expect(patched.memory.recallLimit).toBe(7)
      expect(saved).toHaveLength(1)
      const bundle = await fetch(`${handle.url}web.js`).then(response => response.text())
      expect(bundle.length).toBeGreaterThan(1000)
      expect(bundle).toContain('mount')
      const status = await fetch(`${handle.url}api/status`).then(response => response.json())
      expect(status).toMatchObject({ total: 0, active: 0 })
      const page = await fetch(handle.url!).then(response => response.text())
      expect(page).toContain('HttpUiHost')
      expect(page).toContain('/web.js')
      const settings = await fetch(`${handle.url}api/settings`).then(response => response.json())
      expect(settings.web.enabled).toBe(true)
    } finally {
      await handle.close()
      service.close()
    }
  })

  it('degrades gracefully when the port is busy', async () => {
    const { service, config } = setup('dynamic', true)
    const first = await startKiloWebServer({ service, config, port: 0 })
    const busyPort = Number(new URL(first.url!).port)
    const second = await startKiloWebServer({ service, config, port: busyPort })
    expect(second.url).toBeNull()
    expect(second.disabledReason).toContain(`port ${busyPort} is busy`)
    await first.close()
    service.close()
  })
})
