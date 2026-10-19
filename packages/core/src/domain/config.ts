/**
 * Engine configuration for the dsh-llm-memory core.
 *
 * This is a plain TypeScript configuration object (no schema dependency) so the
 * core stays platform-independent. The dsh layer maps its own settings schema on
 * top of {@link MemoryConfig}; this module only provides defaults and a tolerant
 * merge helper.
 */
import type { EmbeddingProviderMode, MemoryScope, VectorBackend, VectorQuantization } from './types.js'

/** Recall scope accepted by the engine. */
export type RecallScope = MemoryScope | 'all'

/**
 * Output formats of `recall`. They live here rather than in the engine so the
 * settings schema, the engine and the HTTP layer can share one list.
 */
export type RecallFormat = 'markdown' | 'table' | 'timeline' | 'json'

/**
 * Project reach of the rules/preferences digest injected into the system prompt:
 * `project` keeps the cross-project user layer plus the calling session's
 * project, `all` keeps every project (the pre-0.1.2 behaviour).
 */
export type RulesPromptScope = 'project' | 'all'

/**
 * Source used by the "export rules to dsh AGENTS.md" action:
 * `bundled-en` reads the English translation shipped in `rules/en/`,
 * `kilo-verbatim` reads the original Kilo rule files found on this machine.
 */
export type RulesSourceMode = 'bundled-en' | 'kilo-verbatim'

/**
 * Vector (semantic) retrieval settings: where embeddings come from, how entry
 * bodies are chunked and which backend stores the vectors.
 *
 * The defaults target one local multilingual model (`Xenova/multilingual-e5-small`,
 * 384 dimensions, quantized) so Russian and English pages of the same store are
 * embedded by one model and no API is required. The e5 family expects the
 * `query:` / `passage:` prefixes, which is why both are configurable.
 */
export interface EmbeddingConfig {
  /**
   * Embedding source; `off` keeps lexical FTS5 search only.
   *
   * The core default is `off`: a bare `MemoryEngine` (tests, embedders) must not
   * download a model. The dsh settings schema defaults to `local`, so the plugin
   * ships with semantic search enabled.
   */
  provider: EmbeddingProviderMode
  /** Model identifier passed to the provider (and stored next to every vector). */
  model: string
  /** Vector length of that model. */
  dim: number
  /** Prefix added to a search query before embedding. */
  queryPrefix: string
  /** Prefix added to a stored chunk before embedding. */
  passagePrefix: string
  /** Texts embedded per provider call. */
  batchSize: number
  /** Chunk hits requested from the vector leg before rank fusion. */
  topK: number
  /** Minimum cosine similarity for a vector hit to count (0 = keep all). */
  minScore: number
  /** Target characters per chunk. */
  chunkChars: number
  /** Characters of overlap between neighbouring chunks. */
  chunkOverlap: number
  /** Storage of the vectors: in-process scan, sqlite-vec or off. */
  backend: VectorBackend
  /** Storage precision of the sqlite-vec table; ignored by the in-process
   * backend, which always keeps float32 vectors in `memory_vectors`.
   */
  quantization: VectorQuantization
  /**
   * Semantic neighbours kept per entry in the knowledge graph. The cut is
   * relative (top-N per entry) because e5 cosine is compressed; see
   * `semanticPairs`.
   */
  semanticEdgesPerEntry: number
  /** Overall cap on semantic `related` edges, so the graph stays readable. */
  semanticMaxEdges: number
  /** Load the model in the background at startup instead of on first query. */
  prewarm: boolean
}

/** Built-in embedding defaults (the dsh layer enables the local provider). */
export const DEFAULT_EMBEDDINGS: EmbeddingConfig = {
  provider: 'off',
  model: 'Xenova/multilingual-e5-small',
  dim: 384,
  queryPrefix: 'query: ',
  passagePrefix: 'passage: ',
  batchSize: 16,
  topK: 50,
  minScore: 0,
  chunkChars: 800,
  chunkOverlap: 120,
  backend: 'js',
  quantization: 'float',
  semanticEdgesPerEntry: 3,
  semanticMaxEdges: 300,
  prewarm: true,
}

/** Resolved configuration of the memory engine. */
export interface MemoryConfig {
  /** Explicit storage root; falls back to `$DSH_HOME/llm-memory` or `~/.dsh/llm-memory`. */
  storageRoot: string | undefined
  /** Default number of entries returned by `recall`. */
  recallLimit: number
  /**
   * Character budget of one entry body in the default `digest` recall
   * rendering. A longer body is cut and marked; `detail: "full"` returns it
   * whole.
   */
  recallTextChars: number
  /**
   * Hard character budget of a whole recall rendering, whatever the per-entry
   * budget. A tool result is re-sent in every later request of the session, so
   * an unbounded dump is paid for many times over.
   */
  recallTotalChars: number
  /**
   * Format `recall` renders with when the caller does not ask for one. The agent
   * usually omits it, so this is what the model actually sees in its context.
   */
  recallFormat: RecallFormat
  /**
   * Whether the agent may pick another format per call. `false` pins recall to
   * {@link recallFormat}: useful when a readable digest matters more than the
   * agent's convenience, and the tool description says so, so the model does not
   * waste calls asking for something else.
   */
  recallAllowFormatOverride: boolean
  /**
   * Treat a literal-looking query (one to three tokens of error codes, versions,
   * file names, ids) as a lookup: the lexical leg decides the order when it
   * matched, instead of the vector leg demoting the exact hit. Measured to close
   * a 18 pp hit@1 gap on such queries without touching semantic ones.
   */
  recallLiteralLookup: boolean
  /**
   * Maximum number of rules/preferences lines injected into the system prompt
   * by `rulesForPrompt` (the digest is rebuilt on every prompt assembly).
   */
  promptRulesLimit: number
  /** Project reach of that digest. */
  rulesPromptScope: RulesPromptScope
  /**
   * Default scope used by `recall`. `project` means the calling session's
   * project plus the cross-project user layer; `all` searches every project.
   */
  recallScope: RecallScope
  /** Minimum number of significant common words for a lint overlap pair. */
  lintOverlapMinCommonWords: number
  /** Maximum number of overlap pairs reported by lint (0 = unlimited). */
  lintMaxPairs: number
  /** Whether the assistant may manage memory without asking the user. */
  autonomous: boolean
  /** Whether destructive memory operations must be confirmed by the user. */
  requireConfirmation: boolean
  /** System-prompt guidance injected into the model context. */
  systemPrompt: string
  /** Explicit project key -> absolute root map (highest-priority root override). */
  projectRoots: Record<string, string>
  /** Explicit import root directories (Kilo / mnemon / dsh-memory stores). */
  importRoots: string[]
  /**
   * Per-base-directory time budget of an index pass, in milliseconds
   * (0 = no budget).
   *
   * A directory that exceeds the budget is left with its previous index rows
   * for this pass (its pages are listed but not re-read). This bounds the worst
   * case on slow mounts: on a WSL host a single `/mnt/c` project root can cost
   * seconds per pass, which would otherwise block the host thread.
   */
  projectScanBudgetMs: number
  /** Whether import roots are auto-detected (Windows / WSL / Linux). */
  importAutoDetect: boolean
  /** Source of the rules exported to `$DSH_HOME/AGENTS.md`. */
  rulesSource: RulesSourceMode
  /** Vector (semantic) retrieval settings. */
  embeddings: EmbeddingConfig
  /** HTTP path of the standalone memory web UI. */
  webPath: string
  /** Directory for manual `.llmmem` backups; empty means `<storageRoot>/backups`. */
  backupDir: string
  /** Inject the short guide at session start when no richer system section is available. */
  sessionStartGuide: boolean
}

/**
 * Default system-prompt guidance. It tells the model how to use long-term
 * memory autonomously: save durable knowledge immediately, keep it accurate by
 * superseding or forgetting outdated entries, and never wait for confirmation.
 */
export const DEFAULT_SYSTEM_PROMPT = [
  'You have long-term memory tools. Use them proactively and autonomously.',
  '',
  'Tool usage:',
  '- llm_memory_recall: before answering questions about user preferences, past decisions, project facts or earlier work, search memory first.',
  '- llm_memory_save: save durable knowledge immediately after learning it; do not wait for the user to ask.',
  '- llm_memory_forget: mark outdated knowledge forgotten so it stops appearing in recall.',
  '- Use maintenance tools, when exposed, only for an explicit storage health or irreversible-cleanup request.',
  '- Prefer `llm_memory_forget` for outdated entries; permanent deletion is a last resort.',
  '',
  'When to save:',
  '- Save after each milestone: confirmed project facts, chosen decisions with their reasoning, user preferences and rules, architecture details and non-obvious constraints.',
  '- Prefer concise, self-contained entries with concrete facts over vague summaries.',
  '- Choose kind, scope, tier (normal, important, immutable) and importance (1-5) yourself.',
  '- Set tier important for knowledge that must survive, and immutable for rules that must never be weakened.',
  '',
  'Autonomy:',
  '- Never ask the user for confirmation before saving, retiering, forgetting, superseding or deleting memories.',
  '- Make the change on your own and report what you changed.',
  '',
  'Forget outdated memories:',
  '- When the user changes a decision, approach or preference, the previous memory becomes outdated.',
  '- Save the new entry with `supersedes` referencing the old id, or call llm_memory_forget on the old entry.',
  '- Never keep contradictory active entries: supersede or forget the old entry in the same turn you record the change.',
].join('\n')

/** Built-in configuration defaults. */
export const DEFAULT_CONFIG: MemoryConfig = {
  storageRoot: undefined,
  recallLimit: 10,
  recallTextChars: 400,
  recallTotalChars: 12000,
  recallFormat: 'markdown',
  recallAllowFormatOverride: true,
  recallLiteralLookup: true,
  promptRulesLimit: 6,
  rulesPromptScope: 'project',
  recallScope: 'project',
  lintOverlapMinCommonWords: 8,
  lintMaxPairs: 200,
  autonomous: true,
  requireConfirmation: false,
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  projectRoots: {},
  importRoots: [],
  importAutoDetect: true,
  projectScanBudgetMs: 0,
  rulesSource: 'bundled-en',
  embeddings: { ...DEFAULT_EMBEDDINGS },
  webPath: '/llm-memory',
  backupDir: '',
  sessionStartGuide: true,
}

function asNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  const rounded = Math.round(n)
  if (rounded < min) return min
  if (rounded > max) return max
  return rounded
}

function asOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function asScope(value: unknown, fallback: RecallScope): RecallScope {
  return value === 'project' || value === 'user' || value === 'all' ? value : fallback
}

function asRecallFormat(value: unknown, fallback: RecallFormat): RecallFormat {
  return value === 'markdown' || value === 'table' || value === 'timeline' || value === 'json' ? value : fallback
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const trimmed = item.trim()
    if (trimmed.length > 0 && !out.includes(trimmed)) out.push(trimmed)
  }
  return out
}

function asProjectRoots(value: unknown): Record<string, string> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, string> = {}
  for (const [key, root] of Object.entries(value as Record<string, unknown>)) {
    const trimmedKey = key.trim()
    if (trimmedKey.length === 0) continue
    if (typeof root !== 'string') continue
    const trimmedRoot = root.trim()
    if (trimmedRoot.length === 0) continue
    out[trimmedKey] = trimmedRoot
  }
  return out
}

function asWebPath(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  if (trimmed.length === 0) return fallback
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`
}

function asRulesSource(value: unknown, fallback: RulesSourceMode): RulesSourceMode {
  return value === 'bundled-en' || value === 'kilo-verbatim' ? value : fallback
}

function asRulesPromptScope(value: unknown, fallback: RulesPromptScope): RulesPromptScope {
  return value === 'project' || value === 'all' ? value : fallback
}

function asEmbeddingProvider(value: unknown, fallback: EmbeddingProviderMode): EmbeddingProviderMode {
  return value === 'off' || value === 'local' || value === 'http' ? value : fallback
}

function asVectorBackend(value: unknown, fallback: VectorBackend): VectorBackend {
  return value === 'off' || value === 'js' || value === 'sqlite-vec' ? value : fallback
}

function asQuantization(value: unknown, fallback: VectorQuantization): VectorQuantization {
  return value === 'float' || value === 'int8' || value === 'bit' ? value : fallback
}

function asFloat(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  if (n < min) return min
  if (n > max) return max
  return n
}

/**
 * Validate the nested embedding section. A missing or malformed value falls
 * back to the defaults field by field, so a partial profile patch stays usable.
 */
function asEmbeddings(value: unknown, fallback: EmbeddingConfig): EmbeddingConfig {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return { ...fallback }
  const src = value as Record<string, unknown>
  const chunkChars = asNumber(src['chunkChars'], fallback.chunkChars, 200, 8000)
  // An overlap at or above the chunk size would never advance the chunker.
  const chunkOverlap = Math.min(asNumber(src['chunkOverlap'], fallback.chunkOverlap, 0, 4000), Math.floor(chunkChars / 2))
  return {
    provider: asEmbeddingProvider(src['provider'], fallback.provider),
    model: asOptionalString(src['model']) ?? fallback.model,
    dim: asNumber(src['dim'], fallback.dim, 64, 4096),
    queryPrefix: typeof src['queryPrefix'] === 'string' ? src['queryPrefix'] : fallback.queryPrefix,
    passagePrefix: typeof src['passagePrefix'] === 'string' ? src['passagePrefix'] : fallback.passagePrefix,
    batchSize: asNumber(src['batchSize'], fallback.batchSize, 1, 256),
    topK: asNumber(src['topK'], fallback.topK, 1, 1000),
    minScore: asFloat(src['minScore'], fallback.minScore, 0, 1),
    chunkChars,
    chunkOverlap,
    backend: asVectorBackend(src['backend'], fallback.backend),
    quantization: asQuantization(src['quantization'], fallback.quantization),
    semanticEdgesPerEntry: asNumber(src['semanticEdgesPerEntry'], fallback.semanticEdgesPerEntry, 1, 20),
    semanticMaxEdges: asNumber(src['semanticMaxEdges'], fallback.semanticMaxEdges, 10, 10000),
    prewarm: typeof src['prewarm'] === 'boolean' ? src['prewarm'] : fallback.prewarm,
  }
}

/**
 * Merge a partial configuration over {@link DEFAULT_CONFIG}, validating values
 * and falling back to the default whenever a value is missing or invalid.
 */
export function mergeConfig(partial?: Partial<MemoryConfig> | null): MemoryConfig {
  const src: Partial<MemoryConfig> = partial ?? {}
  return {
    storageRoot: src.storageRoot === undefined ? DEFAULT_CONFIG.storageRoot : asOptionalString(src.storageRoot),
    recallLimit: asNumber(src.recallLimit, DEFAULT_CONFIG.recallLimit, 1, 1000),
    recallTextChars: asNumber(src.recallTextChars, DEFAULT_CONFIG.recallTextChars, 0, 100000),
    recallTotalChars: asNumber(src.recallTotalChars, DEFAULT_CONFIG.recallTotalChars, 500, 1000000),
    recallFormat: asRecallFormat(src.recallFormat, DEFAULT_CONFIG.recallFormat),
    recallAllowFormatOverride:
      typeof src.recallAllowFormatOverride === 'boolean'
        ? src.recallAllowFormatOverride
        : DEFAULT_CONFIG.recallAllowFormatOverride,
    recallLiteralLookup:
      typeof src.recallLiteralLookup === 'boolean' ? src.recallLiteralLookup : DEFAULT_CONFIG.recallLiteralLookup,
    promptRulesLimit: asNumber(src.promptRulesLimit, DEFAULT_CONFIG.promptRulesLimit, 1, 1000),
    rulesPromptScope: asRulesPromptScope(src.rulesPromptScope, DEFAULT_CONFIG.rulesPromptScope),
    recallScope: asScope(src.recallScope, DEFAULT_CONFIG.recallScope),
    lintOverlapMinCommonWords: asNumber(
      src.lintOverlapMinCommonWords,
      DEFAULT_CONFIG.lintOverlapMinCommonWords,
      1,
      1000,
    ),
    lintMaxPairs: asNumber(src.lintMaxPairs, DEFAULT_CONFIG.lintMaxPairs, 0, 100000),
    autonomous: typeof src.autonomous === 'boolean' ? src.autonomous : DEFAULT_CONFIG.autonomous,
    requireConfirmation:
      typeof src.requireConfirmation === 'boolean' ? src.requireConfirmation : DEFAULT_CONFIG.requireConfirmation,
    systemPrompt:
      typeof src.systemPrompt === 'string' && src.systemPrompt.trim().length > 0
        ? src.systemPrompt
        : DEFAULT_CONFIG.systemPrompt,
    projectRoots: src.projectRoots === undefined ? { ...DEFAULT_CONFIG.projectRoots } : asProjectRoots(src.projectRoots),
    importRoots:
      src.importRoots === undefined ? [...DEFAULT_CONFIG.importRoots] : asStringArray(src.importRoots),
    importAutoDetect:
      typeof src.importAutoDetect === 'boolean' ? src.importAutoDetect : DEFAULT_CONFIG.importAutoDetect,
    projectScanBudgetMs: asNumber(
      src.projectScanBudgetMs,
      DEFAULT_CONFIG.projectScanBudgetMs,
      0,
      600000,
    ),
    rulesSource: asRulesSource(src.rulesSource, DEFAULT_CONFIG.rulesSource),
    embeddings: asEmbeddings(src.embeddings, DEFAULT_CONFIG.embeddings),
    webPath: src.webPath === undefined ? DEFAULT_CONFIG.webPath : asWebPath(src.webPath, DEFAULT_CONFIG.webPath),
    backupDir: typeof src.backupDir === 'string' ? src.backupDir.trim() : DEFAULT_CONFIG.backupDir,
    sessionStartGuide:
      typeof src.sessionStartGuide === 'boolean' ? src.sessionStartGuide : DEFAULT_CONFIG.sessionStartGuide,
  }
}
