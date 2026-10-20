/**
 * OpenCode runtime: the hooks the plugin registers, built on the shared service.
 *
 * Hook names and signatures follow `@opencode-ai/plugin` 1.18.x:
 * `experimental.chat.system.transform`, `experimental.session.compacting`,
 * `experimental.text.complete`, `event`, `dispose`.
 */
import type { OpenCodeService } from './service.js'
import type { OpenCodeMemoryConfig } from './config.js'
import { openCodeMemoryTools, type OpenCodeToolsSdk } from './tools.js'
import { OPENCODE_GUIDE } from './guide.js'

/** Hooks object shape (the fields of `@opencode-ai/plugin`'s `Hooks` we use). */
export interface OpenCodeHooks {
  tool?: Record<string, unknown>
  event?: (input: { event: { type: string; properties?: unknown } }) => Promise<void>
  'experimental.chat.system.transform'?: (
    input: { sessionID?: string; model?: unknown },
    output: { system: string[] },
  ) => Promise<void>
  'experimental.session.compacting'?: (
    input: { sessionID: string },
    output: { context: string[]; prompt?: string },
  ) => Promise<void>
  'experimental.text.complete'?: (
    input: { sessionID: string; messageID: string; partID: string },
    output: { text: string },
  ) => Promise<void>
  dispose?: () => Promise<void>
}

export interface OpenCodeRuntimeOptions {
  service: OpenCodeService
  config: OpenCodeMemoryConfig
  /** Tool helper of the host SDK; without it descriptors stay plain (tests). */
  sdkTool?: OpenCodeToolsSdk
  guide?: string
}

/** Per-session frozen prompt blocks (`promptMode: "frozen"`). */
const frozenBlocks = new Map<string, string>()

export function createOpenCodeRuntime(options: OpenCodeRuntimeOptions): { hooks: OpenCodeHooks } {
  const { service, config } = options
  const guide = options.guide ?? OPENCODE_GUIDE

  /** Rules and preferences digest: the stable part of the injected block. */
  async function digest(): Promise<string> {
    const rules = await service.recall('', { kind: 'rules', limit: 5, touch: false })
    const prefs = await service.recall('', { kind: 'preferences', limit: 3, touch: false })
    const items = [...rules.items, ...prefs.items]
    if (items.length === 0) return ''
    const lines = items.map(item => `- [${item.kind}] ${item.title}`)
    return `### Rules and preferences\n${lines.join('\n')}`
  }

  const hooks: OpenCodeHooks = {
    tool: openCodeMemoryTools(service, options.sdkTool ?? fallbackToolHelper),
    'experimental.chat.system.transform': async (input, output) => {
      const sessionID = input.sessionID ?? 'default'
      const block = `${guide}\n${await digest()}`
      if (config.memory.promptMode === 'frozen') {
        const cached = frozenBlocks.get(sessionID)
        const text = cached ?? block
        if (!cached) frozenBlocks.set(sessionID, text)
        output.system = [...(output.system ?? []), text]
        return
      }
      output.system = [...(output.system ?? []), block]
    },
    'experimental.session.compacting': async (input, output) => {
      const lines: string[] = []
      if (config.memory.consolidateOnCompact) {
        const checked = service.consolidate()
        const status = service.status()
        lines.push(`Memory: ${status.total} entries, ${status.active} active, ${checked} checked.`)
      }
      if (config.memory.crystallizeOnCompact) {
        const { path } = service.crystallize(input.sessionID)
        if (path) lines.push(`Session digest: ${path}`)
      }
      if (lines.length > 0) output.context = [...(output.context ?? []), ...lines]
    },
    'experimental.text.complete': async (_input, output) => {
      // Opt-in: appending to every answer costs tokens and is easy to make noisy.
      if (config.memory.textComplete !== true) return
      const status = service.status()
      output.text = `${output.text}\n\n_memory: ${status.total} entries (${status.active} active)_`
    },
    event: async ({ event }) => {
      if (event.type === 'session.created') {
        // A new session drops a stale frozen block: it belongs to the old one.
        for (const key of frozenBlocks.keys()) if (!key.startsWith('live-')) frozenBlocks.delete(key)
      }
    },
    dispose: async () => {
      service.close()
    },
  }
  return { hooks }
}

/**
 * Plain descriptor fallback used by tests and hosts without the SDK helper.
 *
 * The shape mirrors the shared descriptor: description, args and execute, which
 * is what a tool definition is; the real OpenCode run receives SDK `tool()`
 * definitions instead.
 */
const fallbackToolHelper = ((definition: {
  description: string
  args: Record<string, unknown>
  execute: (args: Record<string, unknown>) => Promise<string>
}) => definition) as unknown as OpenCodeToolsSdk
fallbackToolHelper.schema = {
  string: () => schema() as unknown as ReturnType<OpenCodeToolsSdk['schema']['string']>,
  number: () => schema() as unknown as ReturnType<OpenCodeToolsSdk['schema']['number']>,
  boolean: () => schema() as unknown as ReturnType<OpenCodeToolsSdk['schema']['boolean']>,
  array: () => schema() as unknown as ReturnType<OpenCodeToolsSdk['schema']['array']>,
  enum: () => schema() as unknown as ReturnType<OpenCodeToolsSdk['schema']['enum']>,
}

function schema(): { optional(): ReturnType<typeof schema>; describe(text: string): ReturnType<typeof schema> } {
  const value = {
    optional: () => value,
    describe: () => value,
  }
  return value
}
