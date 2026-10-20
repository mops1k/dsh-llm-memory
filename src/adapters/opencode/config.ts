/**
 * OpenCode adapter configuration (`~/.config/opencode/llm-memory.json`).
 *
 * Same sections as the Kilo panel (`HarnessConfig` in the core domain), OpenCode
 * defaults: dynamic prompt, global+project recall, panel on 127.0.0.1:8788.
 */
import type { HarnessConfig } from '../../core/domain/harness-config.js'

export type OpenCodeMemoryConfig = HarnessConfig

export const DEFAULT_OPENCODE_CONFIG: OpenCodeMemoryConfig = {
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
    textComplete: false,
  },
  web: { enabled: true, host: '127.0.0.1', port: 8788 },
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
export function resolveOpenCodeConfig(raw: unknown): OpenCodeMemoryConfig {
  if (raw === null || typeof raw !== 'object') return structuredClone(DEFAULT_OPENCODE_CONFIG)
  const input = raw as Partial<OpenCodeMemoryConfig>
  return {
    ...DEFAULT_OPENCODE_CONFIG,
    ...input,
    memory: mergeSection(DEFAULT_OPENCODE_CONFIG.memory, input.memory),
    web: mergeSection(DEFAULT_OPENCODE_CONFIG.web, input.web),
    embeddings: mergeSection(DEFAULT_OPENCODE_CONFIG.embeddings, input.embeddings),
  }
}
