/**
 * dsh settings integration: host half of the plugin configuration.
 *
 * The namespace is registered with the native settings provider so that every
 * field (including the editable system prompt) is exposed to a configuration
 * UI, persisted by the provider and hot-reloaded into the running plugin. The
 * settings card itself is a separate client-side plugin keyed by this
 * namespace; nothing here renders UI.
 *
 * @module dsh-llm-memory/dsh/settings
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'

import { DEFAULT_CONFIG, DEFAULT_SYSTEM_PROMPT, mergeConfig, type MemoryConfig } from '../core/config.js'
import type { MemoryEngine } from '../core/engine.js'

/** Settings namespace owned by this plugin (lowercase, hyphenated). */
export const SETTINGS_NAMESPACE = 'dsh-llm-memory'

/** Configuration schema shared by the plugin entry and the settings namespace. */
export const MemorySettingsSchema = z.object({
  storageRoot: z
    .string()
    .default(DEFAULT_CONFIG.storageRoot ?? '')
    .description('Memory root directory. Empty uses $DSH_HOME/llm-memory (default ~/.dsh/llm-memory).'),
  recallLimit: z
    .number()
    .min(1)
    .step(1)
    .default(DEFAULT_CONFIG.recallLimit)
    .description('Maximum number of entries returned by llm_memory_recall.'),
  autonomous: z
    .boolean()
    .default(DEFAULT_CONFIG.autonomous)
    .description('Let the agent save, retier, forget and delete memories without asking the user.'),
  requireConfirmation: z
    .boolean()
    .default(DEFAULT_CONFIG.requireConfirmation)
    .description('Ask the user before irreversible memory operations (disabled by default).'),
  systemPrompt: z
    .string()
    .default(DEFAULT_SYSTEM_PROMPT)
    .description('System-prompt guidance injected for the agent. Editable in settings.'),
  importRoots: z
    .array(z.string())
    .default([])
    .description('Extra directories searched for memory of other plugins (kilo-memory, dsh-mnemon, dsh-memory).'),
  importAutoDetect: z
    .boolean()
    .default(DEFAULT_CONFIG.importAutoDetect)
    .description('Auto-detect source roots on Windows, WSL and Linux filesystems.'),
  rulesSource: z
    .union([z.const('bundled-en'), z.const('kilo-verbatim')])
    .default(DEFAULT_CONFIG.rulesSource)
    .description(
      'Source of the rules exported to $DSH_HOME/AGENTS.md: the bundled English translation (bundled-en) or the verbatim Kilo files (kilo-verbatim).',
    ),
  lintOverlapMinCommonWords: z
    .number()
    .min(1)
    .step(1)
    .default(DEFAULT_CONFIG.lintOverlapMinCommonWords)
    .description('Minimum shared significant words before two memories are reported as overlapping.'),
  lintMaxPairs: z
    .number()
    .min(0)
    .step(1)
    .default(DEFAULT_CONFIG.lintMaxPairs)
    .description('Maximum number of memory pairs checked for overlaps (0 means unlimited).'),
  webPath: z
    .string()
    .default(DEFAULT_CONFIG.webPath)
    .description('Base HTTP path for the plugin WebUI and API.'),
})

/** Resolved value of the plugin settings namespace. */
export type MemorySettings = ReturnType<typeof MemorySettingsSchema>

/** Project the resolved engine config onto the settings shape. */
function toSettings(config: MemoryConfig): MemorySettings {
  return {
    storageRoot: config.storageRoot ?? '',
    recallLimit: config.recallLimit,
    autonomous: config.autonomous,
    requireConfirmation: config.requireConfirmation,
    systemPrompt: config.systemPrompt,
    importRoots: [...config.importRoots],
    importAutoDetect: config.importAutoDetect,
    rulesSource: config.rulesSource,
    lintOverlapMinCommonWords: config.lintOverlapMinCommonWords,
    lintMaxPairs: config.lintMaxPairs,
    webPath: config.webPath,
  }
}

/** Merge a settings value over the current config, preserving `recallScope`. */
function fromSettings(next: MemorySettings, current: MemoryConfig): MemoryConfig {
  return mergeConfig({
    storageRoot: next.storageRoot,
    recallLimit: next.recallLimit,
    recallScope: current.recallScope,
    lintOverlapMinCommonWords: next.lintOverlapMinCommonWords,
    lintMaxPairs: next.lintMaxPairs,
    autonomous: next.autonomous,
    requireConfirmation: next.requireConfirmation,
    systemPrompt: next.systemPrompt,
    importRoots: next.importRoots,
    importAutoDetect: next.importAutoDetect,
    rulesSource: next.rulesSource,
    webPath: next.webPath,
  })
}

/**
 * Copy resolved values into a live config object that the tools, the system
 * prompt provider and the engine read on every call, so a settings change
 * takes effect without a restart. `storageRoot` is applied for reporting only:
 * the SQLite store already owns its directory, so a root change needs a
 * plugin restart (warned about by the caller).
 */
function applyConfig(target: MemoryConfig, next: MemoryConfig): void {
  target.recallLimit = next.recallLimit
  target.lintOverlapMinCommonWords = next.lintOverlapMinCommonWords
  target.lintMaxPairs = next.lintMaxPairs
  target.autonomous = next.autonomous
  target.requireConfirmation = next.requireConfirmation
  target.systemPrompt = next.systemPrompt
  target.importRoots = [...next.importRoots]
  target.importAutoDetect = next.importAutoDetect
  target.rulesSource = next.rulesSource
  target.webPath = next.webPath
}

/** Log a warning through the Cordis logger, falling back to the console. */
function warnSettings(ctx: Context, message: string): void {
  try {
    ctx.logger.warn(message)
  } catch {
    console.warn(`[dsh-llm-memory] ${message}`)
  }
}

/**
 * Register the plugin settings namespace (host half) and hot-reload changes
 * into the live configuration objects.
 *
 * @param ctx - context carrying the `settings` service.
 * @param engine - live engine whose own config backs recall/lint.
 * @param config - shared resolved config read by the tools and prompt section.
 */
export function registerMemorySettings(ctx: Context, engine: MemoryEngine, config: MemoryConfig): void {
  let scope: SettingsScope<MemorySettings>
  try {
    scope = ctx.settings.register(SETTINGS_NAMESPACE, MemorySettingsSchema, {
      base: toSettings(config),
      applies: 'live',
    })
  } catch (error) {
    warnSettings(ctx, `Settings namespace "${SETTINGS_NAMESPACE}" was not registered: ${String(error)}`)
    return
  }

  const apply = (next: MemorySettings): void => {
    const merged = fromSettings(next, config)
    if (merged.storageRoot !== config.storageRoot) {
      warnSettings(
        ctx,
        'storageRoot changed: the memory store keeps its current directory until the plugin restarts.',
      )
    }
    applyConfig(config, merged)
    applyConfig(engine.config, merged)
  }

  try {
    scope.watch((next) => apply(next))
  } catch (error) {
    warnSettings(ctx, `Settings watcher for "${SETTINGS_NAMESPACE}" was not installed: ${String(error)}`)
  }

  apply(scope.get())
}
