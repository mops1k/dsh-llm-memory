import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { DEFAULT_KILO_CONFIG, resolveKiloConfig } from '@llm-memory/adapter/kilo/config'
import { KILO_TOOL_NAMES, kiloMemoryTools } from '@llm-memory/adapter/kilo/tools'
import { KiloService } from '@llm-memory/adapter/kilo/service'

const roots: string[] = []
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function service(configPatch: Partial<typeof DEFAULT_KILO_CONFIG.memory> = {}): { svc: KiloService; root: string; repo: string } {
  const base = mkdtempSync(join(tmpdir(), 'llm-kilo-'))
  roots.push(base)
  const root = join(base, 'store')
  const repo = join(base, 'repo')
  mkdirSync(repo, { recursive: true })
  const config = resolveKiloConfig({
    memory: { ...DEFAULT_KILO_CONFIG.memory, storageRoot: root, ...configPatch },
  })
  const svc = new KiloService({ config, projectRoot: repo })
  svc.init()
  return { svc, root, repo }
}

describe('kilo adapter service', () => {
  it('saves entries as pages and returns them from recall', async () => {
    const { svc, root } = service()
    const saved = svc.save({ text: 'Правило: коммит после каждого шага', kind: 'rules', scope: 'global' })
    expect(saved.id).toMatch(/^m_/)
    expect(existsSync(join(root, '_user'))).toBe(true)
    const recalled = await svc.recall('коммит')
    expect(recalled.items[0]?.id).toBe(saved.id)
    expect(recalled.text).toContain('коммит после каждого шага')
    svc.close()
  })

  it('supports project scope, formats and reinforcement', async () => {
    const { svc, repo } = service()
    const entry = svc.save({ text: 'Project fact about pnpm builds', scope: 'project', importance: 4 })
    expect(existsSync(join(repo, '.kilo', 'memory'))).toBe(true)
    const first = await svc.recall('pnpm')
    expect(first.items[0]?.accessCount).toBe(1)
    expect(first.items[0]?.lastAccess).toBeTruthy()
    const second = await svc.recall('pnpm')
    expect(second.items[0]?.accessCount).toBe(2)
    const json = await svc.recall('pnpm', { format: 'json' })
    expect(JSON.parse(json.text)[0].id).toBe(entry.id)
    const table = await svc.recall('pnpm', { format: 'table' })
    expect(table.text).toContain('| kind | title | excerpt |')
    svc.close()
  })

  it('forget is soft, delete is hard, status and lint work', async () => {
    const { svc } = service()
    const a = svc.save({ text: 'first entry body', scope: 'global' })
    const b = svc.save({ text: 'second entry body', scope: 'global' })
    expect(svc.forget(a.id)).toBe(true)
    expect((await svc.recall('first')).items).toHaveLength(0)
    expect(svc.delete(b.id)).toBe(true)
    const status = svc.status()
    expect(status.total).toBe(1)
    expect(status.byScope).toMatchObject({ user: 1 })
    expect(svc.lint().issues).toEqual([])
    expect(svc.graph().entities).toHaveLength(1) // the forged entry stays in the graph
    svc.close()
  })

  it('exposes exactly the canonical llm_memory_* tools', () => {
    const { svc } = service()
    const tools = kiloMemoryTools(svc)
    expect(Object.keys(tools).sort()).toEqual([...KILO_TOOL_NAMES].sort())
    expect(Object.keys(tools).every(name => name.startsWith('llm_memory_'))).toBe(true)
    expect(Object.keys(tools).some(name => name.startsWith('memory_'))).toBe(false)
    svc.close()
  })

  it('tools execute against the service', async () => {
    const { svc } = service()
    const tools = kiloMemoryTools(svc)
    const saved = await tools.llm_memory_save!.execute({ text: 'Инструмент пишет в память', kind: 'facts' })
    expect(saved).toMatch(/Сохранено: m_/)
    const status = await tools.llm_memory_status!.execute({})
    expect(status).toContain('Всего: 1')
    const recall = await tools.llm_memory_recall!.execute({ query: 'память' })
    expect(recall).toContain('Инструмент пишет')
    const missing = await tools.llm_memory_forget!.execute({ id: 'm_missing' })
    expect(missing).toContain('Не найдено')
    svc.close()
  })

  it('resolves config with Kilo defaults and keeps unknown keys', () => {
    const config = resolveKiloConfig({ memory: { promptMode: 'frozen' }, web: { port: 9000 }, extra: true })
    expect(config.memory.promptMode).toBe('frozen')
    expect(config.memory.recallScope).toBe('all')
    expect(config.web.port).toBe(9000)
    expect(config.web.host).toBe('127.0.0.1')
  })
})
