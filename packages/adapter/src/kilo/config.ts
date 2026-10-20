/**
 * Kilo adapter configuration (`~/.config/kilo/kilo-memory.json`), reduced to
 * the fields the adapter needs. Defaults keep Kilo behaviour: dynamic prompt,
 * global+project recall, panel on 127.0.0.1:8787.
 */
export type PromptMode = 'dynamic' | 'frozen'
export type RecallFormat = 'markdown' | 'table' | 'timeline' | 'json'
export type RecallScope = 'global' | 'project' | 'all'

export interface KiloMemoryConfig {
  enabled: boolean
  /** Language of the panel UI (`en` is the default, like the rest of the kit). */
  uiLocale: 'en' | 'ru'
  memory: {
    storageRoot: string
    promptMode: PromptMode
    recallLimit: number
    recallFormat: RecallFormat
    recallScope: RecallScope
    recallTextChars: number
    /** Kilo consolidation/reinforcement behaviour stays on by default. */
    consolidateOnCompact: boolean
    crystallizeOnCompact: boolean
    /** Archive directory; empty means `<store>/backups`. */
    backupDir: string
  }
  web: {
    enabled: boolean
    host: string
    port: number
  }
  /** Vector RAG settings (provider off by default until stage 9 vectors land). */
  embeddings: {
    provider: 'off' | 'local'
    model: string
    dim: number
    topK: number
    minScore: number
    chunkChars: number
    chunkOverlap: number
    prewarm: boolean
  }
}

export const DEFAULT_KILO_CONFIG: KiloMemoryConfig = {
  enabled: true,
  uiLocale: 'en',
  memory: {
    storageRoot: '',
    promptMode: 'dynamic',
    recallLimit: 10,
    recallFormat: 'markdown',
    recallScope: 'all',
    recallTextChars: 600,
    consolidateOnCompact: true,
    crystallizeOnCompact: true,
    backupDir: '',
  },
  web: { enabled: true, host: '127.0.0.1', port: 8787 },
  embeddings: {
    provider: 'off',
    model: 'Xenova/multilingual-e5-small',
    dim: 384,
    topK: 8,
    minScore: 0.2,
    chunkChars: 800,
    chunkOverlap: 120,
    prewarm: false,
  },
}

function mergeSection<T extends object>(base: T, raw: unknown): T {
  if (raw === null || typeof raw !== 'object') return base
  const merged: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value !== undefined) merged[key] = value
  }
  return merged as T
}

/** Deep-merge a stored config over the defaults; unknown keys are kept. */
export function resolveKiloConfig(raw: unknown): KiloMemoryConfig {
  if (raw === null || typeof raw !== 'object') return structuredClone(DEFAULT_KILO_CONFIG)
  const input = raw as Partial<KiloMemoryConfig>
  return {
    ...DEFAULT_KILO_CONFIG,
    ...input,
    uiLocale: input.uiLocale === 'ru' ? 'ru' : 'en',
    memory: mergeSection(DEFAULT_KILO_CONFIG.memory, input.memory),
    web: mergeSection(DEFAULT_KILO_CONFIG.web, input.web),
    embeddings: mergeSection(DEFAULT_KILO_CONFIG.embeddings, input.embeddings),
  }
}
