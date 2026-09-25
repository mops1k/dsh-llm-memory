/**
 * dsh-llm-memory — layered long-term memory plugin for DeepSeek Harness.
 *
 * The plugin wires host capabilities: model-facing memory tools, system-prompt
 * guidance, durable session digests, the `memory` human command, HTTP routes
 * for the shell WebUI, and dsh settings. Storage and domain logic live in
 * `src/core`.
 *
 * @module dsh-llm-memory
 */
import type { Context } from '@deepseek-ai/cordis'

import { mergeConfig } from './core/config.js'
import { registerMemoryContext } from './dsh/context.js'
import { createMemoryRuntime } from './dsh/engine.js'
import { MemoryPluginConfigSchema, registerMemorySettings } from './dsh/settings.js'
import { registerMemoryTools } from './dsh/tools.js'
import { registerMemoryWeb, resolveWorkspaceProjectRoot } from './dsh/web.js'

/** Stable plugin name used in logs and as the settings/config namespace. */
export const name = 'dsh-llm-memory'

/** Services this plugin requires before `apply` is called. */
export const inject = ['tools']

/**
 * Plugin configuration schema (schemastery). It extends the native settings
 * schema with startup-only fields that the settings UI deliberately omits.
 */
export const Config = MemoryPluginConfigSchema

/** Resolved plugin configuration. */
export type Config = ReturnType<typeof Config>

/**
 * Activate the plugin: build the memory runtime and register every host
 * capability. Optional services are wired through `ctx.inject` so the plugin
 * also works in headless profiles.
 */
export function apply(ctx: Context, config: Config): void {
  const resolved = mergeConfig(config)
  const runtime = createMemoryRuntime(resolved, {
    resolveProjectRoot: (key) => resolveWorkspaceProjectRoot(ctx, key),
  })
  ctx.effect(() => () => runtime.close())

  registerMemoryTools(ctx, runtime.engine, resolved)

  ctx.inject(['systemPrompt'], (promptCtx) =>
    registerMemoryContext(promptCtx, runtime.engine, resolved),
  )
  ctx.inject(['webServer'], (webCtx) => registerMemoryWeb(webCtx, runtime.engine, resolved))
  ctx.inject(['settings'], (settingsCtx) =>
    registerMemorySettings(settingsCtx, runtime.engine, resolved),
  )
}
