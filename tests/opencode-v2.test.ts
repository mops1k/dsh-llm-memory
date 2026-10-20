/**
 * OpenCode v2 plugin: tools registered through `ctx.tool.transform`, system
 * prompt and compaction through `ctx.session.hook`, all on the shared service.
 * The host Effect runtime is stubbed — the live host check uses the real one.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { cleanupRoot, trackResource } from './helpers'

import { resolveOpenCodeConfig } from '@llm-memory/adapter/opencode/config'
import { OpenCodeService } from '@llm-memory/adapter/opencode/service'
import { createOpenCodeV2Plugin, type OpenCodeV2Context } from '@llm-memory/adapter/opencode/plugin-v2'
import { createLayout } from '@llm-memory/core/layout/index'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) cleanupRoot(dir)
})

interface Recorded {
  tools: Array<{ name: string; description: string; input: Record<string, unknown>; execute(input: Record<string, unknown>): unknown }>
  hooks: Record<string, (input: { sessionID: string; system: Array<{ type: 'text'; text: string }> }) => Promise<void> | void>
  disposed: number
}

function fakeContext(repo: string): { context: OpenCodeV2Context; recorded: Recorded } {
  const recorded: Recorded = { tools: [], hooks: {}, disposed: 0 }
  const registration = { dispose: async () => { recorded.disposed += 1 } }
  const context: OpenCodeV2Context = {
    location: { directory: repo, project: { id: 'p' } },
    tool: {
      async transform(callback) {
        callback({ add: tool => recorded.tools.push(tool) })
        return registration
      },
    },
    session: {
      async hook(name, callback) {
        recorded.hooks[name] = callback
        return registration
      },
    },
  }
  return { context, recorded }
}

function makeService(directory: string): OpenCodeService {
  const home = join(directory, 'home')
  const repo = join(directory, 'repo')
  mkdirSync(repo, { recursive: true })
  const service = trackResource(new OpenCodeService({
    config: resolveOpenCodeConfig({ memory: { storageRoot: join(directory, 'store') } }),
    projectRoot: repo,
    layout: createLayout('opencode', { home, cwd: repo }),
    manualEmbeddings: true,
  }))
  service.init()
  return service
}

describe('opencode v2 plugin', () => {
  it('registers the canonical tools with JSON Schema inputs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'opencode-v2-'))
    dirs.push(dir)
    const repo = join(dir, 'repo')
    const service = makeService(dir)
    const { context, recorded } = fakeContext(repo)
    const plugin = createOpenCodeV2Plugin({ service, config: resolveOpenCodeConfig({}), guide: 'GUIDE' })
    expect(plugin.id).toBe('llm-memory')

    const cleanup = await plugin.setup(context)
    expect(recorded.tools.map(tool => tool.name).sort()).toEqual([
      'llm_memory_delete',
      'llm_memory_forget',
      'llm_memory_graph',
      'llm_memory_lint',
      'llm_memory_recall',
      'llm_memory_save',
      'llm_memory_status',
    ])
    const save = recorded.tools.find(tool => tool.name === 'llm_memory_save')!
    expect(save.input['type']).toBe('object')
    expect(save.input['required']).toEqual(['text'])

    service.save({ text: 'v2 tool fact about indexes', scope: 'global' })
    const recall = recorded.tools.find(tool => tool.name === 'llm_memory_recall')!
    const result = (await recall.execute({ query: 'indexes' })) as { content: string }
    expect(result.content).toContain('v2 tool fact')

    await cleanup()
    expect(recorded.disposed).toBe(3)
  })

  it('injects the guide into model requests and memory lines into compaction', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'opencode-v2-'))
    dirs.push(dir)
    const repo = join(dir, 'repo')
    const service = makeService(dir)
    service.save({ text: 'Rule: verify everything', kind: 'rules', scope: 'global' })
    const { context, recorded } = fakeContext(repo)
    const plugin = createOpenCodeV2Plugin({ service, config: resolveOpenCodeConfig({}), guide: 'GUIDE' })
    await plugin.setup(context)

    const request = { sessionID: 's1', system: [] as Array<{ type: 'text'; text: string }> }
    await recorded.hooks['context']!(request)
    expect(request.system[0]?.type).toBe('text')
    expect(request.system[0]?.text).toContain('GUIDE')
    expect(request.system[0]?.text).toContain('verify everything')

    const compaction = { sessionID: 's1', system: [] as Array<{ type: 'text'; text: string }> }
    await recorded.hooks['compaction']!(compaction)
    expect(compaction.system[0]?.text).toContain('Memory:')
  })
})
