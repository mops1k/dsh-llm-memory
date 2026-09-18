import { existsSync, readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { CommandDefinition, CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { PromptSection } from '@deepseek-ai/dsh-system-prompt'

import { DEFAULT_SYSTEM_PROMPT, mergeConfig } from '../src/core/config'
import type { MemoryEngine } from '../src/core/engine'
import {
  contentText,
  digestBlock,
  digestFileName,
  MemoryDigest,
  MEMORY_GUIDE,
  registerMemoryContext,
} from '../src/dsh/context'
import { cleanupRoot, makeTempRoot } from './helpers'

interface ContextHarness {
  ctx: Context
  sections: PromptSection[]
  listeners: Array<{ event: string; callback: (...args: never[]) => void }>
  commands: CommandDefinition[]
}

function makeContextHarness(): ContextHarness {
  const sections: PromptSection[] = []
  const listeners: Array<{ event: string; callback: (...args: never[]) => void }> = []
  const commands: CommandDefinition[] = []
  const commandChild = {
    commands: {
      register(definition: CommandDefinition): () => void {
        commands.push(definition)
        return () => {}
      },
    },
  }
  const ctx = {
    systemPrompt: {
      section(section: PromptSection): () => void {
        sections.push(section)
        return () => {}
      },
    },
    on(event: string, callback: (...args: never[]) => void): () => void {
      listeners.push({ event, callback })
      return () => {}
    },
    effect(callback: () => (() => void) | void): () => void {
      const disposer = callback()
      return typeof disposer === 'function' ? disposer : () => {}
    },
    inject(deps: readonly string[], callback: (child: unknown) => void): () => void {
      if (deps.includes('commands')) callback(commandChild)
      return () => {}
    },
    logger: { warn: (): void => {} },
  } as unknown as Context
  return { ctx, sections, listeners, commands }
}

function makeEngine(root: string): MemoryEngine {
  return {
    root,
    rulesForPrompt: vi.fn(() => 'Long-term memory: rules and preferences (respect these).'),
    statusReport: vi.fn(() => ({
      root,
      dbPath: `${root}/_db/memory.db`,
      dbSizeBytes: 0,
      total: 2,
      active: 1,
      byStatus: {},
      byScope: {},
      byKind: {},
      byProject: {},
    })),
    getStore: vi.fn(() => ({})),
  } as unknown as MemoryEngine
}

function sectionText(section: PromptSection): string {
  return typeof section.text === 'function' ? section.text({} as never) : section.text
}

describe('system prompt section', () => {
  it('contains the autonomy and forget rules in English', () => {
    const { ctx, sections } = makeContextHarness()
    registerMemoryContext(ctx, makeEngine('/tmp/memory'), mergeConfig({}))

    expect(sections).toHaveLength(1)
    const text = sectionText(sections[0] as PromptSection)

    expect(text).toContain('llm_memory_save')
    expect(text).toContain('supersedes')
    expect(text).toContain('Never ask the user for confirmation')
    expect(text).toContain('forget')
    expect(text).toContain('immutable')
    expect(text).toContain('Long-term memory: rules and preferences')
    expect(/[А-Яа-яЁё]/u.test(text)).toBe(false)
  })

  it('serves the configured prompt and follows live config changes', () => {
    const { ctx, sections } = makeContextHarness()
    const config = mergeConfig({ systemPrompt: 'Custom guidance.' })
    registerMemoryContext(ctx, makeEngine('/tmp/memory'), config)

    const section = sections[0] as PromptSection
    expect(sectionText(section)).toContain('Custom guidance.')

    config.systemPrompt = 'Updated guidance.'
    expect(sectionText(section)).toContain('Updated guidance.')
  })

  it('ships autonomy and forget rules in the default prompt', () => {
    expect(DEFAULT_SYSTEM_PROMPT).toContain('Never ask the user for confirmation')
    expect(DEFAULT_SYSTEM_PROMPT).toContain('supersedes')
    expect(DEFAULT_SYSTEM_PROMPT).toContain('llm_memory_forget')
    expect(MEMORY_GUIDE).toContain('llm_memory_save')
    expect(MEMORY_GUIDE).toContain('supersede or forget')
  })
})

describe('session digest helpers', () => {
  let root: string

  afterEach(() => {
    if (root) cleanupRoot(root)
  })

  it('extracts only visible text blocks', () => {
    expect(
      contentText([
        { type: 'text', text: 'hello' },
        { type: 'reasoning', text: 'hidden' },
        { type: 'text', text: 'world' },
      ] as never),
    ).toBe('hello\nworld')
    expect(contentText([] as never)).toBe('')
  })

  it('renders a deterministic digest block and file name', () => {
    expect(digestBlock({ role: 'user', time: 0, text: 'hi' })).toBe(
      '## user (1970-01-01T00:00:00.000Z)\n\nhi\n',
    )
    expect(digestFileName('sess/../x y')).toBe('sess-..-x-y.md')
    expect(digestFileName('')).toBe('session.md')
  })

  it('accumulates messages and flushes them atomically', () => {
    root = makeTempRoot()
    const digest = new MemoryDigest(root)

    digest.append('s1', 'user', 1000, 'first question')
    digest.append('s1', 'assistant', 2000, 'first answer')
    digest.append('s1', 'user', 3000, '   ')

    const content = digest.content('s1')
    expect(content).toContain('first question')
    expect(content).toContain('first answer')
    expect(content).not.toContain('   ')

    expect(digest.flush('s1')).toBe(true)
    const target = digest.path('s1')
    expect(existsSync(target)).toBe(true)
    expect(readFileSync(target, 'utf8')).toContain('first answer')

    expect(digest.flush('missing')).toBe(false)
    expect(digest.flushAll()).toBeUndefined()
  })

  it('captures session events and flushes on compaction', () => {
    root = makeTempRoot()
    const { ctx, listeners } = makeContextHarness()
    registerMemoryContext(ctx, makeEngine(root), mergeConfig({}))

    const sessionEvent = listeners.find((entry) => entry.event === 'session/event')
    expect(sessionEvent).toBeDefined()

    const userEvent = {
      type: 'user/message',
      seq: 0,
      time: 1000,
      data: { id: 'm1', role: 'user', content: [{ type: 'text', text: 'remember this' }], source: { kind: 'user' } },
    }
    const assistantEvent = {
      type: 'assistant/message',
      seq: 1,
      time: 2000,
      data: {
        turn: 1,
        step: 1,
        message: {
          id: 'm2',
          role: 'assistant',
          content: [{ type: 'text', text: 'noted' }],
          source: { kind: 'model', provider: 'test', model: 'test' },
        },
      },
    }
    const compactionEvent = {
      type: 'compaction/start',
      seq: 2,
      time: 3000,
      data: { compactionId: 'c1', turn: null },
    }

    const session = { id: 's-test' } as unknown as Session
    sessionEvent?.callback(session as never, userEvent as never)
    sessionEvent?.callback(session as never, assistantEvent as never)
    sessionEvent?.callback(session as never, compactionEvent as never)

    const target = new MemoryDigest(root).path('s-test')
    expect(existsSync(target)).toBe(true)
    const stored = readFileSync(target, 'utf8')
    expect(stored).toContain('remember this')
    expect(stored).toContain('noted')
  })

  it('ignores injected plugin context', () => {
    root = makeTempRoot()
    const { ctx, listeners } = makeContextHarness()
    registerMemoryContext(ctx, makeEngine(root), mergeConfig({}))

    const sessionEvent = listeners.find((entry) => entry.event === 'session/event')
    const injected = {
      type: 'user/message',
      seq: 0,
      time: 1000,
      data: {
        id: 'm1',
        role: 'user',
        content: [{ type: 'text', text: 'file changed' }],
        source: { kind: 'plugin', plugin: 'other' },
      },
    }
    sessionEvent?.callback({ id: 's2' } as never, injected as never)

    expect(existsSync(new MemoryDigest(root).path('s2'))).toBe(false)
  })
})

describe('memory human command', () => {
  it('registers a status/import/export command and reports status', () => {
    const { ctx, commands } = makeContextHarness()
    registerMemoryContext(ctx, makeEngine('/tmp/memory'), mergeConfig({}))

    expect(commands).toHaveLength(1)
    const definition = commands[0] as CommandDefinition
    expect(definition.name).toBe('memory')

    const status = definition.handler({ rawInput: 'status' } as unknown as CommandInvocation) as CommandResult
    expect(status).toMatchObject({ kind: 'success' })
    if (status.kind === 'success') expect(status.text).toContain('2 entries')

    const unknown = definition.handler({ rawInput: 'bogus' } as unknown as CommandInvocation) as CommandResult
    expect(unknown).toMatchObject({ kind: 'error' })

    // Isolate the export target so the command never writes to the real ~/.dsh.
    const previousDshHome = process.env['DSH_HOME']
    const exportHome = makeTempRoot('dsh-context-export-')
    process.env['DSH_HOME'] = exportHome
    try {
      const exported = definition.handler({ rawInput: 'export' } as unknown as CommandInvocation) as CommandResult
      expect(exported).toMatchObject({ kind: 'success' })
    } finally {
      if (previousDshHome === undefined) delete process.env['DSH_HOME']
      else process.env['DSH_HOME'] = previousDshHome
      cleanupRoot(exportHome)
    }
  })

  it('injects the memory guide when a session starts', () => {
    const { ctx, listeners } = makeContextHarness()
    registerMemoryContext(ctx, makeEngine('/tmp/memory'), mergeConfig({}))

    const start = listeners.find((entry) => entry.event === 'agent/session-start')
    expect(start).toBeDefined()

    const injected: unknown[] = []
    const agent = { inject: (message: unknown) => injected.push(message) }
    start?.callback({ agent } as never)

    expect(injected).toHaveLength(1)
    const message = injected[0] as { content: Array<{ text: string }>; source: { plugin: string } }
    expect(message.source.plugin).toBe('dsh-llm-memory')
    expect(message.content[0]?.text).toContain('llm_memory_recall')
  })
})
