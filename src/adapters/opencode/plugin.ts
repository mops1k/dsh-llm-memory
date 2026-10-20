/**
 * OpenCode plugin entry: `~/.config/opencode/plugins/llm-memory.js`.
 *
 * The bundle is a single ESM file; the host SDK (`@opencode-ai/plugin`) and the
 * optional embedding runtime are resolved at runtime from the config directory,
 * so the plugin survives host upgrades and keeps weights outside the bundle.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { resolveOpenCodeConfig, type OpenCodeMemoryConfig } from './config.js'
import { createOpenCodeRuntime } from './runtime.js'
import { OpenCodeService } from './service.js'
import { startOpenCodeWebServer, type OpenCodeWebHandle } from './web-server.js'
import type { OpenCodeToolsSdk } from './tools.js'

export interface OpenCodePluginContext {
  directory?: string
  worktree?: string
}

/** Config directory of the running host (`~/.config/opencode`). */
export function openCodeConfigDir(): string {
  const override = (process.env['LLM_MEMORY_OPENCODE_DIR'] ?? '').trim()
  if (override.length > 0) return override
  return join(homedir(), '.config', 'opencode')
}

/** Universal name first; `opencode-memory.json` stays a read fallback. */
export function resolveConfigFile(dir: string): string {
  const preferred = join(dir, 'llm-memory.json')
  if (existsSync(preferred)) return preferred
  const legacy = join(dir, 'opencode-memory.json')
  return existsSync(legacy) ? legacy : preferred
}

export function loadConfigFrom(file: string): OpenCodeMemoryConfig {
  try {
    return resolveOpenCodeConfig(JSON.parse(readFileSync(file, 'utf8')) as unknown)
  } catch {
    return resolveOpenCodeConfig({})
  }
}

/** OpenCode reports `worktree: "/"` for WSL projects; the real root is `directory`. */
export function resolveProjectRoot(context: OpenCodePluginContext): string | undefined {
  const directory = context.directory?.trim()
  const worktree = context.worktree?.trim()
  if (worktree && worktree !== '/' && worktree !== '\\') return worktree
  if (directory && directory.length > 0) return directory
  return undefined
}

async function loadToolHelper(): Promise<OpenCodeToolsSdk | undefined> {
  try {
    const specifier = '@opencode-ai/plugin'
    const mod = (await import(/* @vite-ignore */ specifier)) as { tool?: unknown }
    if (typeof mod.tool === 'function') return mod.tool as OpenCodeToolsSdk
  } catch {
    // Running outside the host (tests): descriptors stay plain.
  }
  return undefined
}

const server = async (context: OpenCodePluginContext = {}) => {
  const config = loadConfigFrom(resolveConfigFile(openCodeConfigDir()))
  const projectRoot = resolveProjectRoot(context)
  if (!config.enabled) return { tool: {}, dispose: async () => {} }
  if (projectRoot && !existsSync(projectRoot)) return { tool: {}, dispose: async () => {} }

  const service = new OpenCodeService({
    config,
    configDir: openCodeConfigDir(),
    ...(projectRoot ? { projectRoot } : {}),
  })
  service.init()
  const sdkTool = await loadToolHelper()
  const runtime = createOpenCodeRuntime({ service, config, ...(sdkTool ? { sdkTool } : {}) })
  let web: OpenCodeWebHandle | null = null
  if (config.web.enabled) {
    web = await startOpenCodeWebServer({
      service,
      config,
      saveConfig: next => writeFileSync(join(openCodeConfigDir(), 'llm-memory.json'), JSON.stringify(next, null, 2), 'utf8'),
    })
  }
  return {
    ...runtime.hooks,
    dispose: async () => {
      await web?.close()
      await runtime.hooks.dispose?.()
    },
  }
}

export default { id: 'llm-memory', server }
