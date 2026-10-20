/**
 * OpenCode adapter: the shared MemoryService on the OpenCode layout, its tools,
 * hooks and the plugin entry. The host SDK is stubbed — the live host check runs
 * separately with `opencode run` (scripts/e2e-opencode.ts).
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { DEFAULT_OPENCODE_CONFIG, resolveOpenCodeConfig } from '@llm-memory/adapter/opencode/config'
import { OpenCodeService } from '@llm-memory/adapter/opencode/service'
import { openCodeMemoryTools, OPENCODE_TOOL_NAMES, type OpenCodeToolsSdk } from '@llm-memory/adapter/opencode/tools'
import { createOpenCodeRuntime } from '@llm-memory/adapter/opencode/runtime'
import openCodePlugin from '@llm-memory/adapter/opencode/plugin'
import { createIsolation, IsolationViolation } from '@llm-memory/core/isolation/index'
import { createLayout } from '@llm-memory/core/layout/index'
import { assertLayoutContract, storesAreSeparate } from '@llm-memory/testkit'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  delete process.env['LLM_MEMORY_OPENCODE_DIR']
})

function base(): { home: string; repo: string } {
  const dir = mkdtempSync(join(tmpdir(), 'llm-opencode-'))
  dirs.push(dir)
  return { home: join(dir, 'home'), repo: join(dir, 'repo') }
}

function makeService(options: { home: string; repo: string } = base()): OpenCodeService {
  const service = new OpenCodeService({
    config: resolveOpenCodeConfig({ memory: { storageRoot: '' } }),
    projectRoot: options.repo,
    layout: createLayout('opencode', { home: options.home, cwd: options.repo }),
    manualEmbeddings: true,
  })
  service.init()
  return service
}

/** Recording stand-in for the host `tool()` helper and its zod factory. */
function recordingSdk(): { sdk: OpenCodeToolsSdk; calls: string[]; definitions: Record<string, unknown> } {
  const calls: string[] = []
  const definitions: Record<string, unknown> = {}
  const schema = (name: string) => {
    calls.push(name)
    const value = {
      optional: () => {
        calls.push('optional')
        return value
      },
      describe: (text: string) => {
        calls.push(`describe:${text}`)
        return value
      },
    }
    return value
  }
  const tool = ((definition: Record<string, unknown>) => {
    const name = Object.keys(definitions).length
    definitions[String(name)] = definition
    return definition
  }) as unknown as OpenCodeToolsSdk
  tool.schema = {
    string: () => schema('string') as never,
    number: () => schema('number') as never,
    boolean: () => schema('boolean') as never,
    array: () => schema('array') as never,
    enum: (values: string[]) => {
      calls.push(`enum:${values.join('|')}`)
      return schema('enum') as never
    },
  }
  return { sdk: tool, calls, definitions }
}

describe('opencode config', () => {
  it('defaults to the opencode panel port and vectors off', () => {
    expect(DEFAULT_OPENCODE_CONFIG.web.port).toBe(8788)
    expect(DEFAULT_OPENCODE_CONFIG.embeddings.provider).toBe('off')
    expect(resolveOpenCodeConfig({ web: { port: 9999 } }).web.port).toBe(9999)
    expect(resolveOpenCodeConfig({ web: { port: 9999 } }).memory.promptMode).toBe('dynamic')
  })
})

describe('opencode service', () => {
  it('satisfies the layout contract and keeps its own store', () => {
    const { home, repo } = base()
    const layout = createLayout('opencode', { home, cwd: repo })
    assertLayoutContract(layout)
    const service = makeService({ home, repo })
    expect(service.store.root).toBe(layout.userRoot())
    expect(service.store.dbPath).toBe(join(service.store.root, 'db', 'memory.db'))
    service.close()
  })

  it('writes project pages under .opencode/memory and stamps its origin', async () => {
    const { home, repo } = base()
    const service = makeService({ home, repo })
    const entry = service.save({ text: 'OpenCode project fact', scope: 'project' })
    expect(entry.origin).toBe('opencode')
    expect(existsSync(join(repo, '.opencode', 'memory'))).toBe(true)
    expect((await service.recall('project fact')).items[0]?.id).toBe(entry.id)
    service.close()
  })

  it('never touches a foreign root', () => {
    const { home, repo } = base()
    const service = makeService({ home, repo })
    const iso = createIsolation({
      identity: { harness: 'opencode', instanceId: 'opencode-test', storeId: 'opencode' },
      storeRoot: service.store.root,
      forbiddenRoots: [join(home, '.config', 'kilo', 'memory')],
    })
    expect(() => iso.assertNoForeignPaths()).not.toThrow()
    const overlap = createIsolation({
      identity: { harness: 'opencode', instanceId: 'opencode-test', storeId: 'opencode' },
      storeRoot: service.store.root,
      forbiddenRoots: [join(service.store.root, 'pages')],
    })
    expect(() => overlap.assertNoForeignPaths()).toThrow(IsolationViolation)
    expect(storesAreSeparate(
      createLayout('opencode', { home, cwd: repo }),
      createLayout('kilo', { home, cwd: repo }),
    )).toBe(true)
    service.close()
  })
})

describe('opencode tools', () => {
  it('exposes the canonical names with host schemas', async () => {
    const { home, repo } = base()
    const service = makeService({ home, repo })
    const { sdk, calls, definitions } = recordingSdk()
    const tools = openCodeMemoryTools(service, sdk)
    expect(Object.keys(tools).sort()).toEqual([...OPENCODE_TOOL_NAMES].sort())
    expect(calls).toContain('string')
    expect(calls).toContain('optional')
    expect(calls.some(call => call.startsWith('describe:'))).toBe(true)

    const saved = service.save({ text: 'Tool output should mention this fact.' })
    const definitionsList = Object.values(definitions) as Array<{ description: string; execute: (args: Record<string, unknown>) => Promise<string> }>
    const recall = definitionsList.find(definition => definition.description.includes('Search long-term memory'))
    expect(recall).toBeTruthy()
    const text = await recall!.execute({ query: 'mention this fact' })
    expect(text).toContain(saved.id)
    service.close()
  })
})

describe('opencode hooks', () => {
  it('injects the guide and the rules digest, and keeps frozen blocks per session', async () => {
    const { home, repo } = base()
    const service = makeService({ home, repo })
    service.save({ text: 'Rule: always verify', kind: 'rules', scope: 'global' })
    const runtime = createOpenCodeRuntime({
      service,
      config: resolveOpenCodeConfig({ memory: { storageRoot: '', promptMode: 'frozen' } }),
      guide: 'GUIDE',
    })
    const first = { system: [] as string[] }
    await runtime.hooks['experimental.chat.system.transform']!({ sessionID: 's1' }, first)
    expect(first.system.join('\n')).toContain('GUIDE')
    expect(first.system.join('\n')).toContain('always verify')

    service.save({ text: 'Rule: added later', kind: 'rules', scope: 'global' })
    const second = { system: [] as string[] }
    await runtime.hooks['experimental.chat.system.transform']!({ sessionID: 's1' }, second)
    expect(second.system.join('\n')).not.toContain('added later')

    const other = { system: [] as string[] }
    await runtime.hooks['experimental.chat.system.transform']!({ sessionID: 's2' }, other)
    expect(other.system.join('\n')).toContain('added later')
    service.close()
  })

  it('consolidates and crystallizes on compaction, and leaves text.complete opt-in', async () => {
    const { home, repo } = base()
    const service = makeService({ home, repo })
    service.save({ text: 'Entry to compact', scope: 'global' })
    const disabled = createOpenCodeRuntime({
      service,
      config: resolveOpenCodeConfig({ memory: { storageRoot: '', textComplete: false } }),
    })
    const output = { text: 'answer' }
    await disabled.hooks['experimental.text.complete']!({ sessionID: 's', messageID: 'm', partID: 'p' }, output)
    expect(output.text).toBe('answer')

    const compacting = { context: [] as string[] }
    await disabled.hooks['experimental.session.compacting']!({ sessionID: 'sess-1' }, compacting)
    expect(compacting.context.join('\n')).toContain('Memory:')

    const enabled = createOpenCodeRuntime({
      service,
      config: resolveOpenCodeConfig({ memory: { storageRoot: '', textComplete: true } }),
    })
    const withDigest = { text: 'answer' }
    await enabled.hooks['experimental.text.complete']!({ sessionID: 's', messageID: 'm', partID: 'p' }, withDigest)
    expect(withDigest.text).toContain('_memory:')
    service.close()
  })
})

describe('opencode plugin entry', () => {
  it('loads the config, registers tools and disposes the service', async () => {
    const { home, repo } = base()
    const configDir = join(home, '.config', 'opencode')
    const store = join(home, '.config', 'opencode', 'memory')
    rmSync(configDir, { recursive: true, force: true })
    rmSync(store, { recursive: true, force: true })
    mkdirSync(configDir, { recursive: true })
    mkdirSync(repo, { recursive: true })
    writeFileSync(
      join(configDir, 'llm-memory.json'),
      JSON.stringify({ memory: { storageRoot: store }, web: { enabled: false } }),
    )
    process.env['LLM_MEMORY_OPENCODE_DIR'] = configDir

    const hooks = await openCodePlugin.server({ directory: repo, worktree: repo })
    expect(Object.keys(hooks.tool ?? {}).sort()).toEqual([...OPENCODE_TOOL_NAMES].sort())
    expect(typeof hooks['experimental.chat.system.transform']).toBe('function')
    expect(typeof hooks.event).toBe('function')
    await hooks.dispose?.()
  })
})
