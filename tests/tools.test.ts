import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'

import { mergeConfig } from '../src/core/config'
import type { HealReport, LintReport, StatusReport } from '../src/core/engine'
import type { MemoryEngine } from '../src/core/engine'
import type { MemoryEntry } from '../src/core/types'
import { createMemoryRuntime } from '../src/dsh/engine'
import { registerMemoryTools } from '../src/dsh/tools'
import { cleanupRoot, makeTempRoot } from './helpers'

const TOOL_NAMES = [
  'llm_memory_recall',
  'llm_memory_save',
  'llm_memory_forget',
  'llm_memory_delete',
  'llm_memory_status',
  'llm_memory_lint',
  'llm_memory_heal',
]

const ENTRY: MemoryEntry = {
  id: 'm_0123456789ab',
  scope: 'project',
  project: 'demo',
  kind: 'facts',
  tier: 'normal',
  status: 'active',
  title: 'Build toolchain',
  text: 'The project builds with pnpm and Node 24.',
  tags: ['build'],
  keywords: 'build pnpm node',
  importance: 3,
  supersedes: [],
  supersededBy: [],
  related: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  confidence: 0.7,
}

const STATUS_REPORT: StatusReport = {
  root: '/tmp/memory',
  dbPath: '/tmp/memory/_db/memory.db',
  dbSizeBytes: 4096,
  total: 1,
  active: 1,
  byStatus: { active: 1 },
  byScope: { project: 1 },
  byKind: { facts: 1 },
  byProject: { demo: 1 },
}

const LINT_REPORT: LintReport = {
  totalCount: 1,
  activeCount: 1,
  brokenLinks: [{ id: ENTRY.id, title: ENTRY.title, field: 'related', missingId: 'm_missing' }],
  overlaps: [],
  overlapsHidden: 0,
  stale: [],
  staleDays: 180,
}

const HEAL_REPORT: HealReport = {
  removedLinks: 1,
  addedBacklinks: 2,
  reindexed: 3,
  brokenBefore: 1,
  brokenAfter: 0,
}

interface Harness {
  ctx: Context
  tools: ToolDefinition[]
  warnings: string[]
}

function makeHarness(existing: string[] = []): Harness {
  const tools: ToolDefinition[] = []
  const warnings: string[] = []
  const registry = new Map<string, ToolDefinition>()
  for (const name of existing) registry.set(name, { name } as unknown as ToolDefinition)
  const ctx = {
    tools: {
      register(definition: ToolDefinition): () => void {
        if (registry.has(definition.name)) throw new Error(`duplicate tool name: ${definition.name}`)
        registry.set(definition.name, definition)
        tools.push(definition)
        return () => {}
      },
      get(name: string): ToolDefinition | undefined {
        return registry.get(name)
      },
    },
    logger: {
      warn(message: unknown, ...rest: unknown[]): void {
        warnings.push([message, ...rest].map((value) => String(value)).join(' '))
      },
    },
  } as unknown as Context
  return { ctx, tools, warnings }
}

function makeEngine() {
  return {
    recall: vi.fn(() => ({ items: [ENTRY], text: '### Build toolchain', format: 'markdown' as const })),
    save: vi.fn(() => ENTRY),
    forget: vi.fn(() => ({ ok: true, message: 'Memory entry marked as forgotten.', entry: ENTRY })),
    delete: vi.fn(() => true),
    statusReport: vi.fn(() => STATUS_REPORT),
    lintReport: vi.fn(() => LINT_REPORT),
    heal: vi.fn(() => HEAL_REPORT),
  }
}

function tool(tools: ToolDefinition[], name: string): ToolDefinition {
  const found = tools.find((definition) => definition.name === name)
  if (!found) throw new Error(`tool not registered: ${name}`)
  return found
}

function expectValidOutput(definition: ToolDefinition, value: unknown): void {
  expect(validateJsonSchemaValue(definition.output.schema, value, '')).toEqual([])
}

describe('registerMemoryTools', () => {
  it('registers exactly the seven memory tools with valid schemas', () => {
    const { ctx, tools } = makeHarness()
    registerMemoryTools(ctx, makeEngine() as unknown as MemoryEngine, mergeConfig({}))

    expect(tools).toHaveLength(7)
    expect(tools.map((definition) => definition.name).sort()).toEqual([...TOOL_NAMES].sort())

    for (const definition of tools) {
      expect(definition.description.length).toBeGreaterThan(0)
      expect(definition.parameters.type).toBe('object')
      expect(definition.output.schema.type).toBe('object')
      expect(definition.output.schema.additionalProperties).toBe(false)
      expect(typeof definition.output.render).toBe('function')
      expect(typeof definition.execute).toBe('function')
    }
  })

  it('skips a tool whose name is already taken and warns instead of throwing', () => {
    const { ctx, tools, warnings } = makeHarness(['llm_memory_recall'])
    expect(() =>
      registerMemoryTools(ctx, makeEngine() as unknown as MemoryEngine, mergeConfig({})),
    ).not.toThrow()

    expect(tools).toHaveLength(6)
    expect(tools.map((definition) => definition.name)).not.toContain('llm_memory_recall')
    expect(warnings.join('\n')).toContain('llm_memory_recall')
  })

  it('renders every tool without throwing', () => {
    const { ctx, tools } = makeHarness()
    registerMemoryTools(ctx, makeEngine() as unknown as MemoryEngine, mergeConfig({}))

    const cases: Array<[string, unknown, unknown]> = [
      ['llm_memory_recall', { query: 'build' }, { text: '### Build toolchain' }],
      ['llm_memory_recall', { query: 'missing' }, { text: '' }],
      ['llm_memory_save', { title: 'T', text: 'B' }, { id: ENTRY.id, title: 'T', kind: 'facts', scope: 'project' }],
      ['llm_memory_forget', { id: ENTRY.id }, { message: 'Memory entry marked as forgotten.' }],
      ['llm_memory_delete', { id: ENTRY.id }, { id: ENTRY.id, deleted: true }],
      [
        'llm_memory_status',
        {},
        {
          root: STATUS_REPORT.root,
          dbPath: STATUS_REPORT.dbPath,
          dbSizeBytes: STATUS_REPORT.dbSizeBytes,
          total: 1,
          active: 1,
          byStatus: STATUS_REPORT.byStatus,
          byScope: STATUS_REPORT.byScope,
          byKind: STATUS_REPORT.byKind,
          byProject: STATUS_REPORT.byProject,
        },
      ],
      [
        'llm_memory_lint',
        {},
        {
          totalCount: 1,
          activeCount: 1,
          overlapsHidden: 0,
          staleDays: 180,
          brokenLinks: LINT_REPORT.brokenLinks,
          overlaps: LINT_REPORT.overlaps,
          stale: LINT_REPORT.stale,
        },
      ],
      [
        'llm_memory_heal',
        {},
        {
          removedLinks: 1,
          addedBacklinks: 2,
          reindexed: 3,
          brokenBefore: 1,
          brokenAfter: 0,
        },
      ],
    ]

    for (const [name, args, value] of cases) {
      const blocks = tool(tools, name).output.render(args as never, value as never)
      expect(Array.isArray(blocks)).toBe(true)
      expect(blocks.length).toBeGreaterThan(0)
      expect(blocks[0]?.type).toBe('text')
    }
  })

  it('memory_recall calls engine.recall and returns schema-valid output', async () => {
    const engine = makeEngine()
    const { ctx, tools } = makeHarness()
    registerMemoryTools(ctx, engine as unknown as MemoryEngine, mergeConfig({ recallLimit: 5 }))
    const definition = tool(tools, 'llm_memory_recall')

    const value = await definition.execute({ query: 'build', kind: 'facts', limit: 3 }, {} as never)

    expect(engine.recall).toHaveBeenCalledTimes(1)
    expect(engine.recall).toHaveBeenCalledWith('build', { kind: 'facts', limit: 3 })
    expect(value).toMatchObject({ format: 'markdown', count: 1, text: '### Build toolchain' })
    expectValidOutput(definition, value)
  })

  it('memory_save calls engine.save and returns schema-valid output', async () => {
    const engine = makeEngine()
    const { ctx, tools } = makeHarness()
    registerMemoryTools(ctx, engine as unknown as MemoryEngine, mergeConfig({}))
    const definition = tool(tools, 'llm_memory_save')

    const value = await definition.execute(
      { title: 'New fact', text: 'Body text.', kind: 'facts', importance: 4, tags: ['x'] },
      {} as never,
    )

    expect(engine.save).toHaveBeenCalledTimes(1)
    expect(engine.save.mock.calls[0]?.[0]).toMatchObject({
      title: 'New fact',
      text: 'Body text.',
      kind: 'facts',
      importance: 4,
      tags: ['x'],
    })
    expectValidOutput(definition, value)
  })

  it('memory_save rejects an out-of-range importance', async () => {
    const { ctx, tools } = makeHarness()
    registerMemoryTools(ctx, makeEngine() as unknown as MemoryEngine, mergeConfig({}))
    const definition = tool(tools, 'llm_memory_save')

    await expect(
      definition.execute({ title: 'T', text: 'B', importance: 9 }, {} as never),
    ).rejects.toThrow('importance must be an integer between 1 and 5')
  })

  it('memory_forget calls engine.forget and returns schema-valid output', async () => {
    const engine = makeEngine()
    const { ctx, tools } = makeHarness()
    registerMemoryTools(ctx, engine as unknown as MemoryEngine, mergeConfig({}))
    const definition = tool(tools, 'llm_memory_forget')

    const value = await definition.execute({ id: ENTRY.id }, {} as never)

    expect(engine.forget).toHaveBeenCalledWith(ENTRY.id)
    expect(value).toMatchObject({ id: ENTRY.id, status: 'active' })
    expectValidOutput(definition, value)
  })

  it('memory_forget throws for an unknown entry', async () => {
    const engine = makeEngine()
    engine.forget.mockReturnValue({ ok: false, message: 'Memory entry not found: m_missing' } as never)
    const { ctx, tools } = makeHarness()
    registerMemoryTools(ctx, engine as unknown as MemoryEngine, mergeConfig({}))
    const definition = tool(tools, 'llm_memory_forget')

    await expect(definition.execute({ id: 'm_missing' }, {} as never)).rejects.toThrow(
      'Memory entry not found: m_missing',
    )
  })

  it('memory_delete calls engine.delete and throws when nothing was deleted', async () => {
    const engine = makeEngine()
    const { ctx, tools } = makeHarness()
    registerMemoryTools(ctx, engine as unknown as MemoryEngine, mergeConfig({}))
    const definition = tool(tools, 'llm_memory_delete')

    const value = await definition.execute({ id: ENTRY.id }, {} as never)
    expect(engine.delete).toHaveBeenCalledWith(ENTRY.id)
    expect(value).toMatchObject({ id: ENTRY.id, deleted: true })
    expectValidOutput(definition, value)

    engine.delete.mockReturnValue(false as never)
    await expect(definition.execute({ id: 'm_missing' }, {} as never)).rejects.toThrow('Memory entry not found: m_missing')
  })

  it('memory_status returns schema-valid storage statistics', async () => {
    const engine = makeEngine()
    const { ctx, tools } = makeHarness()
    registerMemoryTools(ctx, engine as unknown as MemoryEngine, mergeConfig({}))
    const definition = tool(tools, 'llm_memory_status')

    const value = await definition.execute({}, {} as never)

    expect(engine.statusReport).toHaveBeenCalledTimes(1)
    expect(value).toMatchObject({ total: 1, active: 1, root: STATUS_REPORT.root })
    expectValidOutput(definition, value)
  })

  it('memory_lint returns a schema-valid health report', async () => {
    const engine = makeEngine()
    const { ctx, tools } = makeHarness()
    registerMemoryTools(ctx, engine as unknown as MemoryEngine, mergeConfig({}))
    const definition = tool(tools, 'llm_memory_lint')

    const value = await definition.execute({}, {} as never)

    expect(engine.lintReport).toHaveBeenCalledTimes(1)
    expect(value).toMatchObject({ totalCount: 1, activeCount: 1 })
    expectValidOutput(definition, value)
  })

  it('memory_heal calls engine.heal and returns a schema-valid report', async () => {
    const engine = makeEngine()
    const { ctx, tools } = makeHarness()
    registerMemoryTools(ctx, engine as unknown as MemoryEngine, mergeConfig({}))
    const definition = tool(tools, 'llm_memory_heal')

    const value = await definition.execute({}, {} as never)

    expect(engine.heal).toHaveBeenCalledTimes(1)
    expect(value).toMatchObject({ removedLinks: 1, addedBacklinks: 2, reindexed: 3, brokenAfter: 0 })
    expectValidOutput(definition, value)
  })
})

describe('createMemoryRuntime', () => {
  let root: string

  afterEach(() => {
    if (root) cleanupRoot(root)
  })

  it('creates a store, supports save/recall and closes without throwing', () => {
    root = makeTempRoot()
    const runtime = createMemoryRuntime(mergeConfig({ storageRoot: root }))

    const saved = runtime.engine.save({ text: 'Runtime fact about queues.', title: 'Runtime fact' })
    expect(runtime.engine.get(saved.id)?.title).toBe('Runtime fact')

    const recalled = runtime.engine.recall('runtime fact')
    expect(recalled.items.map((item) => item.id)).toContain(saved.id)
    expect(runtime.engine.dbPath.startsWith(root)).toBe(true)

    expect(() => runtime.close()).not.toThrow()
  })
})
