/**
 * Engine configuration for the dsh-llm-memory core.
 *
 * This is a plain TypeScript configuration object (no schema dependency) so the
 * core stays platform-independent. The dsh layer maps its own settings schema on
 * top of {@link MemoryConfig}; this module only provides defaults and a tolerant
 * merge helper.
 */
import type { MemoryScope } from './types.js'

/** Recall scope accepted by the engine. */
export type RecallScope = MemoryScope | 'all'

/**
 * Source used by the "export rules to dsh AGENTS.md" action:
 * `bundled-en` reads the English translation shipped in `rules/en/`,
 * `kilo-verbatim` reads the original Kilo rule files found on this machine.
 */
export type RulesSourceMode = 'bundled-en' | 'kilo-verbatim'

/** Resolved configuration of the memory engine. */
export interface MemoryConfig {
  /** Explicit storage root; falls back to `$DSH_HOME/llm-memory` or `~/.dsh/llm-memory`. */
  storageRoot: string | undefined
  /** Default number of entries returned by `recall`. */
  recallLimit: number
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
  /** Whether import roots are auto-detected (Windows / WSL / Linux). */
  importAutoDetect: boolean
  /** Source of the rules exported to `$DSH_HOME/AGENTS.md`. */
  rulesSource: RulesSourceMode
  /** HTTP path of the standalone memory web UI. */
  webPath: string
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
  '- llm_memory_delete: erase an entry permanently; use it only when forgetting is not enough.',
  '- llm_memory_status / llm_memory_lint: inspect storage health and clean up overlaps or broken links.',
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
  recallScope: 'project',
  lintOverlapMinCommonWords: 8,
  lintMaxPairs: 200,
  autonomous: true,
  requireConfirmation: false,
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  projectRoots: {},
  importRoots: [],
  importAutoDetect: true,
  rulesSource: 'bundled-en',
  webPath: '/llm-memory',
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

/**
 * Merge a partial configuration over {@link DEFAULT_CONFIG}, validating values
 * and falling back to the default whenever a value is missing or invalid.
 */
export function mergeConfig(partial?: Partial<MemoryConfig> | null): MemoryConfig {
  const src: Partial<MemoryConfig> = partial ?? {}
  return {
    storageRoot: src.storageRoot === undefined ? DEFAULT_CONFIG.storageRoot : asOptionalString(src.storageRoot),
    recallLimit: asNumber(src.recallLimit, DEFAULT_CONFIG.recallLimit, 1, 1000),
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
    rulesSource: asRulesSource(src.rulesSource, DEFAULT_CONFIG.rulesSource),
    webPath: src.webPath === undefined ? DEFAULT_CONFIG.webPath : asWebPath(src.webPath, DEFAULT_CONFIG.webPath),
  }
}
