/**
 * Kilo runtime wiring: tools + hooks over KiloService. SDK-free by design —
 * the plugin entry injects the real `tool()` helper when it loads inside Kilo.
 */
import type { MemoryKind, MemoryTier } from '../../core/domain/types.js'
import { kiloMemoryTools, type KiloMemoryToolsSdk } from './tools.js'
import type { KiloService } from './service.js'
import type { KiloMemoryConfig } from './config.js'

type AnyRecord = Record<string, unknown>

export interface KiloHooks {
  tool: Record<string, unknown>
  'experimental.chat.system.transform'?: (input: { sessionID?: string }, output: { system: string[] }) => Promise<void>
  'experimental.session.compacting'?: (input: { sessionID: string }, output: { context: string[] }) => Promise<void>
  event?: (input: { event: { type: string } }) => Promise<void>
  dispose?: () => Promise<void>
}

export interface KiloRuntime {
  hooks: KiloHooks
  service: KiloService
}

import { KILO_GUIDE } from './guide.js'

function schemaFor(tool: KiloMemoryToolsSdk, arg: { type: string; description: string; optional?: boolean; enum?: readonly string[] }): AnyRecord {
  const schema = tool.schema
  let built: AnyRecord
  if (arg.enum) built = schema.enum([...arg.enum]) as AnyRecord
  else if (arg.type === 'string') built = schema.string() as AnyRecord
  else if (arg.type === 'number') built = schema.number() as AnyRecord
  else if (arg.type === 'boolean') built = schema.boolean() as AnyRecord
  else built = schema.array(schema.string()) as AnyRecord
  if (arg.optional && typeof built['optional'] === 'function') built = (built['optional'] as () => AnyRecord)()
  if (typeof built['describe'] === 'function') built = (built['describe'] as (text: string) => AnyRecord)(arg.description)
  return built
}

/** Build the Kilo hooks object (tools, prompt injection, compaction, dispose). */
export function createKiloRuntime(options: {
  service: KiloService
  config: KiloMemoryConfig
  sdkTool?: KiloMemoryToolsSdk
}): KiloRuntime {
  const { service, config, sdkTool } = options
  const descriptors = kiloMemoryTools(service)
  const tool: Record<string, unknown> = {}
  for (const [name, descriptor] of Object.entries(descriptors)) {
    if (sdkTool) {
      const args: Record<string, AnyRecord> = {}
      for (const [key, arg] of Object.entries(descriptor.args)) args[key] = schemaFor(sdkTool, arg)
      tool[name] = sdkTool({ description: descriptor.description, args, execute: descriptor.execute })
    } else {
      tool[name] = { description: descriptor.description, args: descriptor.args, execute: descriptor.execute }
    }
  }

  /** Frozen mode: cache the injected block per session (spike A7: base is stable). */
  const frozenBlocks = new Map<string, string>()

  async function digest(): Promise<string> {
    const rules = await service.recall('', { kind: 'rules', limit: 5, touch: false })
    const prefs = await service.recall('', { kind: 'preferences', limit: 3, touch: false })
    const items = [...rules.items, ...prefs.items]
    if (items.length === 0) return ''
    const lines = items.map(item => `- [${item.kind}] ${item.title}`)
    return `### Правила и предпочтения\n${lines.join('\n')}`
  }

  const hooks: KiloHooks = {
    tool,
    'experimental.chat.system.transform': async (input, output) => {
      const sessionID = input.sessionID ?? defaultSession
      const block = `${KILO_GUIDE}\n${await digest()}`
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
        lines.push(`Память: всего ${status.total}, активных ${status.active}, проверено ${checked}.`)
      }
      if (config.memory.crystallizeOnCompact) {
        const { path } = service.crystallize(input.sessionID ?? defaultSession)
        if (path) lines.push(`Кристаллизация: ${path}`)
      }
      if (lines.length > 0) output.context = [...(output.context ?? []), ...lines]
    },
    event: async ({ event }) => {
      if (event.type === 'session.created') {
        // New session: drop a stale frozen block (it belongs to the old session).
        for (const key of frozenBlocks.keys()) if (!key.startsWith('live-')) frozenBlocks.delete(key)
      }
    },
    dispose: async () => {
      service.close()
    },
  }
  return { hooks, service }
}

const defaultSession = 'default'

export type { MemoryKind, MemoryTier }
