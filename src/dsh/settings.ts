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

import { DEFAULT_CONFIG, DEFAULT_EMBEDDINGS, DEFAULT_SYSTEM_PROMPT, type MemoryConfig } from '../core/config.js'

/** Settings namespace owned by this plugin (lowercase, hyphenated). */
export const SETTINGS_NAMESPACE = 'dsh-llm-memory'

/** Native Settings schema, containing only user-editable fields. */
export const MemorySettingsSchema = z.object({
  storageRoot: z
    .string()
    .default(DEFAULT_CONFIG.storageRoot ?? '')
    .volatile()
    .description('Memory root directory. Empty uses $DSH_HOME/llm-memory (default ~/.dsh/llm-memory).'),
  recallLimit: z
    .number()
    .min(1)
    .step(1)
    .default(DEFAULT_CONFIG.recallLimit)
    .volatile()
    .description('Maximum number of entries returned by llm_memory_recall.'),
  recallTextChars: z
    .number()
    .min(0)
    .step(50)
    .default(DEFAULT_CONFIG.recallTextChars)
    .volatile()
    .description(
      'Characters of one entry body returned in the default digest mode of llm_memory_recall (0 = titles and metadata only). Recall output is re-sent in every later request, so keep it small.',
    ),
  recallTotalChars: z
    .number()
    .min(500)
    .step(500)
    .default(DEFAULT_CONFIG.recallTotalChars)
    .volatile()
    .description(
      'Hard character budget of a whole llm_memory_recall rendering in digest mode. Bounds the worst case when the query matches many long entries.',
    ),
  recallFormat: z
    .union([z.const('markdown'), z.const('table'), z.const('timeline'), z.const('json')])
    .default(DEFAULT_CONFIG.recallFormat)
    .volatile()
    .description(
      'Format llm_memory_recall returns when the agent does not ask for one. markdown reads best in context; json is for parsing; table and timeline are compact overviews.',
    ),
  recallAllowFormatOverride: z
    .boolean()
    .default(DEFAULT_CONFIG.recallAllowFormatOverride)
    .volatile()
    .description(
      'Let the agent pick another format per call (json to parse, table to skim). Off pins recall to the format above; the tool description tells the model, so it stops asking.',
    ),
  promptRulesLimit: z
    .number()
    .min(1)
    .step(1)
    .default(DEFAULT_CONFIG.promptRulesLimit)
    .volatile()
    .description(
      'Maximum number of rules/preferences lines injected into the system prompt. Keep it small: the digest is part of every request.',
    ),
  rulesPromptScope: z
    .union([z.const('project'), z.const('all')])
    .default(DEFAULT_CONFIG.rulesPromptScope)
    .volatile()
    .description(
      'Project reach of the rules/preferences digest: project keeps the user layer plus the current workspace, all keeps every project.',
    ),
  autonomous: z
    .boolean()
    .default(DEFAULT_CONFIG.autonomous)
    .volatile()
    .description('Let the agent save, retier, forget and delete memories without asking the user.'),
  requireConfirmation: z
    .boolean()
    .default(DEFAULT_CONFIG.requireConfirmation)
    .volatile()
    .description('Ask the user before irreversible memory operations (disabled by default).'),
  systemPrompt: z
    .string()
    .default(DEFAULT_SYSTEM_PROMPT)
    .volatile()
    .description('System-prompt guidance injected for the agent. Editable in settings.'),
  importRoots: z
    .array(z.string())
    .default([])
    .volatile()
    .description('Extra directories searched for memory of other plugins (kilo-memory, dsh-mnemon, dsh-memory).'),
  projectScanBudgetMs: z
    .number()
    .min(0)
    .step(100)
    .default(DEFAULT_CONFIG.projectScanBudgetMs)
    .volatile()
    .description(
      'Time budget per storage directory for an index pass, in milliseconds (0 = no budget). A slow root (for example WSL /mnt/c) that exceeds it keeps its previous index rows until the next pass instead of blocking the host.',
    ),
  importAutoDetect: z
    .boolean()
    .default(DEFAULT_CONFIG.importAutoDetect)
    .volatile()
    .description('Auto-detect source roots on Windows, WSL and Linux filesystems.'),
  rulesSource: z
    .union([z.const('bundled-en'), z.const('kilo-verbatim')])
    .default(DEFAULT_CONFIG.rulesSource)
    .volatile()
    .description(
      'Source of the rules exported to $DSH_HOME/AGENTS.md: the bundled English translation (bundled-en) or the verbatim Kilo files (kilo-verbatim).',
    ),
  lintOverlapMinCommonWords: z
    .number()
    .min(1)
    .step(1)
    .default(DEFAULT_CONFIG.lintOverlapMinCommonWords)
    .volatile()
    .description('Minimum shared significant words before two memories are reported as overlapping.'),
  lintMaxPairs: z
    .number()
    .min(0)
    .step(1)
    .default(DEFAULT_CONFIG.lintMaxPairs)
    .volatile()
    .description('Maximum number of memory pairs checked for overlaps (0 means unlimited).'),
  embeddingsProvider: z
    .union([z.const('off'), z.const('local'), z.const('http')])
    // The core default is `off` so a bare engine never downloads a model;
    // the plugin enables the local provider out of the box.
    .default('local')
    .volatile()
    .description(
      'Vector search, embedding source: off (lexical FTS5 only), local (in-process multilingual ONNX model) or http (reserved; not implemented yet, falls back to lexical search).',
    ),
  embeddingsModel: z
    .string()
    .default(DEFAULT_EMBEDDINGS.model)
    .volatile()
    .description(
      'Vector search, embedding model id: a transformers.js model for the local provider (Xenova/multilingual-e5-small by default), a model name for http.',
    ),
  embeddingsDim: z
    .number()
    .min(64)
    .step(1)
    .default(DEFAULT_EMBEDDINGS.dim)
    .volatile()
    .description(
      'Vector search: vector length the model produces. Vectors of another length are re-embedded.',
    ),
  embeddingsBackend: z
    .union([z.const('off'), z.const('js'), z.const('sqlite-vec')])
    .default(DEFAULT_EMBEDDINGS.backend)
    .volatile()
    .description(
      'Vector search, where chunk vectors live: js (plain table, in-process cosine scan), sqlite-vec (vec0 KNN in SQL) or off. Falls back to js when the extension cannot load.',
    ),
  embeddingsQuantization: z
    .union([z.const('float'), z.const('int8'), z.const('bit')])
    .default(DEFAULT_EMBEDDINGS.quantization)
    .volatile()
    .description(
      'Vector search, storage precision of the sqlite-vec table: float (full 32-bit), int8 (4x smaller) or bit (32x smaller, Hamming distance, needs a dimension divisible by 8). Ignored by the js backend.',
    ),
  embeddingsTopK: z
    .number()
    .min(5)
    .max(500)
    .step(5)
    .default(DEFAULT_EMBEDDINGS.topK)
    .volatile()
    .description(
      'Vector search: chunk hits the vector leg contributes before rank fusion with the FTS5 leg.',
    ),
  embeddingsMinScore: z
    .number()
    .min(0)
    .max(1)
    .step(0.01)
    .default(DEFAULT_EMBEDDINGS.minScore)
    .volatile()
    .description(
      'Vector search: minimum cosine similarity for a vector hit to count (0 keeps every candidate; e5 cosine is compressed).',
    ),
  embeddingsBatchSize: z
    .number()
    .min(1)
    .max(256)
    .step(1)
    .default(DEFAULT_EMBEDDINGS.batchSize)
    .volatile()
    .description('Vector search: texts embedded per model call during indexing.'),
  embeddingsChunkChars: z
    .number()
    .min(200)
    .max(8000)
    .step(50)
    .default(DEFAULT_EMBEDDINGS.chunkChars)
    .volatile()
    .description('Vector search: target characters per chunk of an entry body.'),
  embeddingsChunkOverlap: z
    .number()
    .min(0)
    .max(4000)
    .step(10)
    .default(DEFAULT_EMBEDDINGS.chunkOverlap)
    .volatile()
    .description(
      'Vector search: characters shared by neighbouring chunks (capped at half the chunk size).',
    ),
  embeddingsSemanticEdgesPerEntry: z
    .number()
    .min(1)
    .max(20)
    .step(1)
    .default(DEFAULT_EMBEDDINGS.semanticEdgesPerEntry)
    .volatile()
    .description(
      'Vector search: semantic neighbours kept per entry in the knowledge graph. The cut is relative (top-N per entry) because e5 cosine scores are compressed.',
    ),
  embeddingsSemanticMaxEdges: z
    .number()
    .min(10)
    .max(10000)
    .step(10)
    .default(DEFAULT_EMBEDDINGS.semanticMaxEdges)
    .volatile()
    .description('Vector search: overall cap on semantic related edges in the graph.'),
  embeddingsPrewarm: z
    .boolean()
    .default(DEFAULT_EMBEDDINGS.prewarm)
    .volatile()
    .description(
      'Vector search: load the embedding model in the background at startup instead of on the first query.',
    ),
  webPath: z
    .string()
    .default(DEFAULT_CONFIG.webPath)
    .volatile()
    .description('Base HTTP path for the plugin WebUI and API.'),
})

/** Full plugin schema: native Settings fields plus startup-only profile fields. */
export const MemoryPluginConfigSchema = z.object({
  ...MemorySettingsSchema.dict,
  sessionStartGuide: z
    .boolean()
    .default(DEFAULT_CONFIG.sessionStartGuide)
    .volatile()
    .description('Inject the short session-start guide; disable when a richer system prompt is always available.'),
})

/** Resolved value of the plugin settings namespace. */
export type MemorySettings = ReturnType<typeof MemorySettingsSchema>

/** A Cordis volatile config value: a reactive wrapper exposing the value via `get()`. */
export interface VolatileValue<T = unknown> {
  get(): T
}

/** Plain data behind a volatile wrapper, applied recursively. */
export type Unwrapped<T> = T extends VolatileValue<infer V>
  ? Unwrapped<V>
  : T extends object
    ? { [K in keyof T]: Unwrapped<T[K]> }
    : T

/** Whether a resolved config value is a Cordis volatile wrapper. */
function isVolatileValue(value: unknown): value is VolatileValue {
  return (
    typeof value === 'object' && value !== null && typeof (value as VolatileValue).get === 'function'
  )
}

/**
 * Unwrap Cordis volatile wrappers out of a resolved plugin config.
 *
 * dsh's Settings UI exposes a field only when its schema is declared
 * `.volatile()` (see {@link MemorySettingsSchema}), and cordis then delivers
 * those values as reactive wrappers: `config.recallLimit` is an object with
 * `get()`, not a number. The core expects plain data, so the plugin unwraps once
 * at its boundary — the same `.get()` read `dsh-bash-local` performs.
 *
 * @param value - Resolved config (or any nested part of it).
 * @returns The same structure with every volatile wrapper replaced by its value.
 */
export function unwrapSettings<T>(value: T): Unwrapped<T> {
  if (isVolatileValue(value)) return unwrapSettings(value.get()) as Unwrapped<T>
  if (Array.isArray(value)) return value.map((item) => unwrapSettings(item)) as Unwrapped<T>
  if (typeof value === 'object' && value !== null) {
    const plain: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value)) plain[key] = unwrapSettings(child)
    return plain as Unwrapped<T>
  }
  return value as Unwrapped<T>
}

/** Flat Settings field name → key of the core `embeddings` group. */
const EMBEDDING_SETTING_KEYS = {
  embeddingsProvider: 'provider',
  embeddingsModel: 'model',
  embeddingsDim: 'dim',
  embeddingsBackend: 'backend',
  embeddingsQuantization: 'quantization',
  embeddingsTopK: 'topK',
  embeddingsMinScore: 'minScore',
  embeddingsBatchSize: 'batchSize',
  embeddingsChunkChars: 'chunkChars',
  embeddingsChunkOverlap: 'chunkOverlap',
  embeddingsSemanticEdgesPerEntry: 'semanticEdgesPerEntry',
  embeddingsSemanticMaxEdges: 'semanticMaxEdges',
  embeddingsPrewarm: 'prewarm',
} as const

/**
 * Fold the flat Settings fields back into the core configuration shape.
 *
 * dsh's Settings UI renders schema *leaves* only: a nested `embeddings` group is
 * never drawn (verified in the running GUI, 2026-10-15 — the other fields showed
 * up after the fields were made volatile, the group did not), so the schema keeps
 * those fields flat and this function rebuilds the `embeddings` object the core
 * expects.
 *
 * @param settings - Resolved and unwrapped plugin settings.
 * @returns Core configuration input with a nested `embeddings` group.
 */
export function toMemoryConfig(settings: Partial<MemorySettings>): Partial<MemoryConfig> {
  const rest: Record<string, unknown> = {}
  const embeddings: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(settings as Record<string, unknown>)) {
    const coreKey = (EMBEDDING_SETTING_KEYS as Record<string, string>)[key]
    if (coreKey === undefined) rest[key] = value
    else embeddings[coreKey] = value
  }
  return (
    Object.keys(embeddings).length === 0 ? rest : { ...rest, embeddings }
  ) as Partial<MemoryConfig>
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
