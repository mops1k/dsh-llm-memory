/**
 * Scoped tool restriction for the lite agent preset.
 *
 * This module is mounted from an agent preset, never from the host profile:
 * `ctx.tools.restrict()` masks inherited global tools for that preset while
 * leaving the full plugin registration and WebUI/API surfaces untouched.
 *
 * @module dsh-llm-memory/tool-restrict
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

import { MEMORY_FULL_ONLY_TOOL_NAMES } from './dsh/tools.js'

/** Stable plugin name used in diagnostics and preset inventory. */
export const name = 'dsh-llm-memory-tool-restrict'

/** Required host service. */
export const inject = ['tools']

const FULL_ONLY_TOOL_SCHEMA = z.union([
  z.const('llm_memory_delete'),
  z.const('llm_memory_status'),
  z.const('llm_memory_lint'),
  z.const('llm_memory_heal'),
])

/** Scoped restriction configuration. */
export const Config = z.object({
  deny: z.array(FULL_ONLY_TOOL_SCHEMA).default([...MEMORY_FULL_ONLY_TOOL_NAMES]),
})

/** Resolved restriction configuration. */
export type Config = ReturnType<typeof Config>

/** Apply the restriction to the calling scoped agent/preset context. */
export function apply(ctx: Context, config: Config): void {
  ctx.tools.restrict({ deny: [...config.deny] })
}
