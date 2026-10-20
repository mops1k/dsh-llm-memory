/**
 * Kilo adapter configuration (`~/.config/kilo/llm-memory.json`).
 *
 * The shape is shared with the other HTTP-panel harnesses (`HarnessConfig` in
 * the core domain); Kilo supplies only its defaults: dynamic prompt,
 * global+project recall, panel on 127.0.0.1:8787.
 */
import type { HarnessConfig } from '../../core/domain/harness-config.js'

export type {
  HarnessConfig,
  HarnessEmbeddingConfig,
  HarnessMemoryConfig,
  HarnessWebConfig,
  PromptMode,
} from '../../core/domain/harness-config.js'

export type KiloMemoryConfig = HarnessConfig

export const DEFAULT_KILO_CONFIG: KiloMemoryConfig = {
  enabled: true,
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
    memory: mergeSection(DEFAULT_KILO_CONFIG.memory, input.memory),
    web: mergeSection(DEFAULT_KILO_CONFIG.web, input.web),
    embeddings: mergeSection(DEFAULT_KILO_CONFIG.embeddings, input.embeddings),
  }
}
