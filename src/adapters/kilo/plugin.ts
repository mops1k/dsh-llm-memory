/**
 * Kilo plugin entry (`~/.config/kilo/plugin/kilo-memory.ts` bundle). Loads the
 * Kilo SDK dynamically so the adapter stays testable outside Kilo.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { DEFAULT_KILO_CONFIG, resolveKiloConfig, type KiloMemoryConfig } from './config.js'
import { createKiloRuntime } from './runtime.js'
import type { KiloMemoryToolsSdk } from './tools.js'
import { KiloService } from './service.js'
import { startKiloWebServer, type KiloWebHandle } from './web-server.js'

export interface KiloPluginContext {
  directory?: string
  worktree?: string
}

/** Universal name first; the pre-unification `kilo-memory.json` stays a read fallback. */
export function resolveConfigFile(dir: string): string {
  const preferred = join(dir, 'llm-memory.json')
  if (existsSync(preferred)) return preferred
  const legacy = join(dir, 'kilo-memory.json')
  return existsSync(legacy) ? legacy : preferred
}

const configDir = (): string => join(homedir(), '.config', 'kilo')
const configPath = (): string => resolveConfigFile(configDir())
const configWritePath = (): string => join(configDir(), 'llm-memory.json')

export function loadConfigFrom(file: string): KiloMemoryConfig {
  try {
    const raw = readFileSync(file, 'utf8')
    return resolveKiloConfig(JSON.parse(raw) as unknown)
  } catch {
    return structuredClone(DEFAULT_KILO_CONFIG)
  }
}

function loadConfig(): KiloMemoryConfig {
  return loadConfigFrom(configPath())
}

/** Kilo passes `worktree: "/"` for WSL projects; the real root is `directory`. */
export function resolveProjectRoot(context: KiloPluginContext): string | undefined {
  const directory = context.directory?.trim()
  const worktree = context.worktree?.trim()
  if (worktree && worktree !== '/' && worktree !== '\\') return worktree
  if (directory && directory.length > 0) return directory
  return undefined
}

async function loadToolHelper(): Promise<KiloMemoryToolsSdk | undefined> {
  try {
    const specifier = '@kilocode/plugin/tool'
    const mod = (await import(/* @vite-ignore */ specifier)) as { tool?: (definition: Record<string, unknown>) => unknown }
    if (typeof mod.tool === 'function') return mod.tool as unknown as KiloMemoryToolsSdk
  } catch {
    // Running outside Kilo (tests, DSH): fall back to plain descriptors.
  }
  return undefined
}

const server = async (context: KiloPluginContext = {}) => {
  const config = loadConfig()
  const projectRoot = resolveProjectRoot(context)
  if (!config.enabled) {
    return { tool: {}, dispose: async () => {} }
  }
  if (projectRoot && !existsSync(projectRoot)) {
    return { tool: {}, dispose: async () => {} }
  }
  const service = new KiloService({ config, ...(projectRoot ? { projectRoot } : {}) })
  service.init()
  const sdkTool = await loadToolHelper()
  const runtime = createKiloRuntime({ service, config, ...(sdkTool ? { sdkTool } : {}) })
  let web: KiloWebHandle | null = null
  if (config.web.enabled) {
    web = await startKiloWebServer({
      service,
      config,
      saveConfig: next => writeFileSync(configWritePath(), JSON.stringify(next, null, 2), 'utf8'),
    })
  }
  return {
    tool: runtime.hooks.tool,
    'experimental.chat.system.transform': runtime.hooks['experimental.chat.system.transform'],
    'experimental.session.compacting': runtime.hooks['experimental.session.compacting'],
    event: runtime.hooks.event,
    dispose: async () => {
      await web?.close()
      service.close()
    },
  }
}

export default { id: 'kilo-memory', server }
