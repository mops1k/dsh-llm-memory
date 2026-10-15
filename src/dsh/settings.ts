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

import { DEFAULT_CONFIG, DEFAULT_EMBEDDINGS, DEFAULT_SYSTEM_PROMPT } from '../core/config.js'

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
  recallTextChars: z
    .number()
    .min(0)
    .step(50)
    .default(DEFAULT_CONFIG.recallTextChars)
    .description(
      'Characters of one entry body returned in the default digest mode of llm_memory_recall (0 = titles and metadata only). Recall output is re-sent in every later request, so keep it small.',
    ),
  recallTotalChars: z
    .number()
    .min(500)
    .step(500)
    .default(DEFAULT_CONFIG.recallTotalChars)
    .description(
      'Hard character budget of a whole llm_memory_recall rendering in digest mode. Bounds the worst case when the query matches many long entries.',
    ),
  promptRulesLimit: z
    .number()
    .min(1)
    .step(1)
    .default(DEFAULT_CONFIG.promptRulesLimit)
    .description(
      'Maximum number of rules/preferences lines injected into the system prompt. Keep it small: the digest is part of every request.',
    ),
  rulesPromptScope: z
    .union([z.const('project'), z.const('all')])
    .default(DEFAULT_CONFIG.rulesPromptScope)
    .description(
      'Project reach of the rules/preferences digest: project keeps the user layer plus the current workspace, all keeps every project.',
    ),
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
  projectScanBudgetMs: z
    .number()
    .min(0)
    .step(100)
    .default(DEFAULT_CONFIG.projectScanBudgetMs)
    .description(
      'Time budget per storage directory for an index pass, in milliseconds (0 = no budget). A slow root (for example WSL /mnt/c) that exceeds it keeps its previous index rows until the next pass instead of blocking the host.',
    ),
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
  embeddings: z
    .object({
      provider: z
        .union([z.const('off'), z.const('local'), z.const('http')])
        // The core default is `off` so a bare engine never downloads a model;
        // the plugin enables the local provider out of the box.
        .default('local')
        .description(
          'Embedding source for semantic search: off (lexical FTS5 only), local (in-process multilingual ONNX model) or http (OpenAI-compatible endpoint).',
        ),
      model: z
        .string()
        .default(DEFAULT_EMBEDDINGS.model)
        .description(
          'Embedding model id: a transformers.js model for the local provider (Xenova/multilingual-e5-small by default), a model name for http.',
        ),
      dim: z
        .number()
        .min(64)
        .step(1)
        .default(DEFAULT_EMBEDDINGS.dim)
        .description('Vector length the model produces. Vectors of another length are re-embedded.'),
      backend: z
        .union([z.const('off'), z.const('js'), z.const('sqlite-vec')])
        .default(DEFAULT_EMBEDDINGS.backend)
        .description(
          'Where chunk vectors live: js (plain table, in-process cosine scan), sqlite-vec (vec0 KNN in SQL) or off. Falls back to js when the extension cannot load.',
        ),
      quantization: z
        .union([z.const('float'), z.const('int8'), z.const('bit')])
        .default(DEFAULT_EMBEDDINGS.quantization)
        .description(
          'Storage precision of the sqlite-vec table: float (full 32-bit), int8 (4x smaller) or bit (32x smaller, Hamming distance, needs a dimension divisible by 8). Ignored by the js backend.',
        ),
      topK: z
        .number()
        .min(5)
        .max(500)
        .step(5)
        .default(DEFAULT_EMBEDDINGS.topK)
        .description('Chunk hits the vector leg contributes before rank fusion with the FTS5 leg.'),
      minScore: z
        .number()
        .min(0)
        .max(1)
        .step(0.01)
        .default(DEFAULT_EMBEDDINGS.minScore)
        .description('Minimum cosine similarity for a vector hit to count (0 keeps every candidate; e5 cosine is compressed).'),
      batchSize: z
        .number()
        .min(1)
        .max(256)
        .step(1)
        .default(DEFAULT_EMBEDDINGS.batchSize)
        .description('Texts embedded per model call during indexing.'),
      chunkChars: z
        .number()
        .min(200)
        .max(8000)
        .step(50)
        .default(DEFAULT_EMBEDDINGS.chunkChars)
        .description('Target characters per chunk of an entry body.'),
      chunkOverlap: z
        .number()
        .min(0)
        .max(4000)
        .step(10)
        .default(DEFAULT_EMBEDDINGS.chunkOverlap)
        .description('Characters shared by neighbouring chunks (capped at half the chunk size).'),
      semanticEdgesPerEntry: z
        .number()
        .min(1)
        .max(20)
        .step(1)
        .default(DEFAULT_EMBEDDINGS.semanticEdgesPerEntry)
        .description(
          'Semantic neighbours kept per entry in the knowledge graph. The cut is relative (top-N per entry) because e5 cosine scores are compressed.',
        ),
      semanticMaxEdges: z
        .number()
        .min(10)
        .max(10000)
        .step(10)
        .default(DEFAULT_EMBEDDINGS.semanticMaxEdges)
        .description('Overall cap on semantic related edges in the graph.'),
      prewarm: z
        .boolean()
        .default(DEFAULT_EMBEDDINGS.prewarm)
        .description('Load the embedding model in the background at startup instead of on the first query.'),
    })
    .description('Vector (semantic) retrieval: embeddings, chunking and the vector index backend.'),
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
