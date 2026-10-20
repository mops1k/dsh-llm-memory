/**
 * OpenCode v2 plugin entry (`~/.config/opencode/plugins/llm-memory.js`).
 *
 * OpenCode 2.x replaced the v1 hooks object with a plugin definition:
 * `{ id, setup(ctx) }`, where `ctx` registers tools through `ctx.tool.transform`
 * and model-request hooks through `ctx.session.hook`. The live 2.1.1 host awaits
 * the tool result as a promise (the codemode bridge calls `.then` on it), so
 * `execute` is a plain async function and needs no Effect runtime.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { resolveOpenCodeConfig, type OpenCodeMemoryConfig } from './config.js'
import { createMemoryTools, type ToolArg } from '../../core/application/tools.js'
import { OpenCodeService } from './service.js'
import { startOpenCodeWebServer, type OpenCodeWebHandle } from './web-server.js'
import { OPENCODE_GUIDE } from './guide.js'
import type { MemoryService } from '../../core/application/memory-service.js'

/** Minimal v2 context: the domains this plugin uses. */
export interface OpenCodeV2Context {
  location: { directory: string; project?: { id?: string } }
  tool: {
    transform(callback: (editor: OpenCodeV2ToolEditor) => void): Promise<{ dispose(): Promise<void> }>
  }
  session: {
    hook(name: 'context' | 'compaction', callback: (input: OpenCodeV2SessionHook) => Promise<void> | void): Promise<{
      dispose(): Promise<void>
    }>
  }
}

export interface OpenCodeV2ToolEditor {
  add(tool: {
    name: string
    description: string
    input: Record<string, unknown>
    execute(input: Record<string, unknown>, context: unknown): unknown
  }): void
}

export interface OpenCodeV2SessionHook {
  sessionID: string
  system: Array<{ type: 'text'; text: string }>
}

type Registration = { dispose(): Promise<void> }

export interface OpenCodeV2PluginDeps {
  service: MemoryService
  config: OpenCodeMemoryConfig
  /** Optional panel start (host runs the plugin inside its own server). */
  startPanel?: () => Promise<OpenCodeWebHandle | null>
  guide?: string
}

/** JSON Schema of one tool argument (v2 tools accept JSON Schema directly). */
function jsonSchemaFor(arg: ToolArg): Record<string, unknown> {
  const schema: Record<string, unknown> =
    arg.type === 'array'
      ? { type: 'array', items: { type: 'string' } }
      : { type: arg.type }
  if (arg.enum) schema['enum'] = [...arg.enum]
  if (arg.description) schema['description'] = arg.description
  return schema
}

function inputSchema(args: Record<string, ToolArg>): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  const required: string[] = []
  for (const [key, arg] of Object.entries(args)) {
    properties[key] = jsonSchemaFor(arg)
    if (!arg.optional) required.push(key)
  }
  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
    additionalProperties: false,
  }
}

/** Build the memory digest injected into the system prompt. */
async function digest(service: MemoryService): Promise<string> {
    const rules = await service.recall('', { kind: 'rules', limit: 5, touch: false })
    const prefs = await service.recall('', { kind: 'preferences', limit: 3, touch: false })
    const items = [...rules.items, ...prefs.items]
    if (items.length === 0) return ''
    return `### Rules and preferences\n${items.map(item => `- [${item.kind}] ${item.title}`).join('\n')}`
}

export interface OpenCodeV2Plugin {
  id: string
  setup(context: OpenCodeV2Context): Promise<() => Promise<void>>
}

/**
 * Build the v2 plugin definition. Exported separately from the default so tests
 * drive it with a fake context.
 */
export function createOpenCodeV2Plugin(deps: OpenCodeV2PluginDeps): OpenCodeV2Plugin {
  const { service, config } = deps
  const guide = deps.guide ?? OPENCODE_GUIDE
  const registrations: Registration[] = []
  const frozen = new Map<string, string>()

  return {
    id: 'llm-memory',
    async setup(context) {
      // Tools: the same SDK-free descriptors as Kilo/OpenCode v1.
      const tools = createMemoryTools(service)
      const toolsRegistration = await context.tool.transform((editor) => {
        for (const [name, definition] of Object.entries(tools)) {
          editor.add({
            name,
            description: definition.description,
            input: inputSchema(definition.args),
            execute: async (input: Record<string, unknown>) => ({ content: await definition.execute(input) }),
          })
        }
      })
      registrations.push(toolsRegistration)

      // Inject the guide and the stable rules digest into every model request.
      const contextRegistration = await context.session.hook('context', async (request) => {
        const block = `${guide}\n${await digest(service)}`
        const text = config.memory.promptMode === 'frozen' ? (frozen.get(request.sessionID) ?? block) : block
        if (config.memory.promptMode === 'frozen' && !frozen.has(request.sessionID)) frozen.set(request.sessionID, text)
        request.system.push({ type: 'text', text })
      })
      registrations.push(contextRegistration)

      // Compaction: consolidate/crystallize and hand the summary to the prompt.
      const compactionRegistration = await context.session.hook('compaction', async (request) => {
        const lines: string[] = []
        if (config.memory.consolidateOnCompact) {
          const checked = service.consolidate()
          const status = service.status()
          lines.push(`Memory: ${status.total} entries, ${status.active} active, ${checked} checked.`)
        }
        if (config.memory.crystallizeOnCompact) {
          const { path } = service.crystallize(request.sessionID)
          if (path) lines.push(`Session digest: ${path}`)
        }
        if (lines.length > 0) request.system.push({ type: 'text', text: lines.join('\n') })
      })
      registrations.push(compactionRegistration)

      const panel = deps.startPanel ? await deps.startPanel() : null
      return async () => {
        await panel?.close()
        for (const registration of registrations.splice(0)) await registration.dispose()
        service.close()
      }
    },
  }
}

/** Config directory of the running host (`~/.config/opencode`). */
function configDir(): string {
  const override = (process.env['LLM_MEMORY_OPENCODE_DIR'] ?? '').trim()
  if (override.length > 0) return override
  return join(homedir(), '.config', 'opencode')
}

function loadConfig(): OpenCodeMemoryConfig {
  const preferred = join(configDir(), 'llm-memory.json')
  const legacy = join(configDir(), 'opencode-memory.json')
  const file = existsSync(preferred) ? preferred : existsSync(legacy) ? legacy : preferred
  try {
    return resolveOpenCodeConfig(JSON.parse(readFileSync(file, 'utf8')) as unknown)
  } catch {
    return resolveOpenCodeConfig({})
  }
}

const plugin = {
  id: 'llm-memory',
  async setup(context: OpenCodeV2Context): Promise<() => Promise<void>> {
    const config = loadConfig()
    if (!config.enabled) return async () => {}
    const directory = context.location.directory
    if (directory && !existsSync(directory)) return async () => {}
    const service = new OpenCodeService({ config, configDir: configDir(), projectRoot: directory })
    service.init()
    const definition = createOpenCodeV2Plugin({
      service,
      config,
      startPanel: async () =>
        config.web.enabled
          ? startOpenCodeWebServer({
              service,
              config,
              saveConfig: next => writeFileSync(join(configDir(), 'llm-memory.json'), JSON.stringify(next, null, 2), 'utf8'),
            })
          : null,
    })
    return definition.setup(context)
  },
}

export default plugin
