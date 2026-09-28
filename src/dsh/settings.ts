/**
 * dsh settings integration: host half of the plugin configuration.
 *
 * The plugin ships its configuration as a Loader `Config` schema (see
 * `src/index.ts`): the values are held by the profile patch, edited through the
 * native configuration editor, and applied by cordis re-activating the plugin
 * fiber. This module owns the schema and the page policy that exposes it in the
 * settings UI; nothing here renders UI itself. Startup-only profile fields are
 * intentionally absent from this schema and live only in the plugin
 * composition config.
 *
 * @module dsh-llm-memory/dsh/settings
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only import: it activates the service's `Context.settings` declaration merging.
import type { SettingsForms } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'

import { DEFAULT_CONFIG, DEFAULT_SYSTEM_PROMPT } from '../core/config.js'

/** Settings namespace owned by this plugin (lowercase, hyphenated). */
export const SETTINGS_NAMESPACE = 'dsh-llm-memory'

/** Native Settings schema, containing only user-editable fields. */
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

/** Full plugin schema: native Settings fields plus startup-only profile fields. */
export const MemoryPluginConfigSchema = z.object({
  ...MemorySettingsSchema.dict,
  sessionStartGuide: z
    .boolean()
    .default(DEFAULT_CONFIG.sessionStartGuide)
    .description('Inject the short session-start guide; disable when a richer system prompt is always available.'),
})

/** Resolved value of the plugin settings namespace. */
export type MemorySettings = ReturnType<typeof MemorySettingsSchema>

/** Log a warning through the Cordis logger, falling back to the console. */
function warnSettings(ctx: Context, message: string): void {
  try {
    ctx.logger.warn(message)
  } catch {
    console.warn(`[dsh-llm-memory] ${message}`)
  }
}

/**
 * Register this plugin instance with the native configuration editor.
 *
 * Since dsh 0.1.7 a plugin's settings *are* its Loader config: {@link
 * MemorySettingsSchema} is exported as the plugin `Config`, the values live in
 * the profile patch, and cordis applies an edit by re-activating the fiber with
 * the new config — so there is no scope to watch here. What this function still
 * owns is the page policy: whether the editor may autogenerate a settings page
 * for this instance.
 *
 * @param ctx - context carrying the `settings` service.
 */
export function registerMemorySettings(ctx: Context): void {
  const forms: SettingsForms = ctx.settings
  try {
    const dispose = forms.configure({ auto: true })
    ctx.effect(() => dispose)
  } catch (error) {
    warnSettings(ctx, `Settings page for "${SETTINGS_NAMESPACE}" was not registered: ${String(error)}`)
  }
}
