/**
 * Configuration shared by the HTTP-panel harnesses (Kilo, OpenCode, MCP).
 *
 * DSH has its own schemastery settings, but the web harnesses all read a JSON
 * file with the same sections, so the service is configured by this shape.
 */
import type { RecallFormat, RecallScope } from './config.js'

/** How the memory block reaches the model: rebuilt per request or cached per session. */
export type PromptMode = 'dynamic' | 'frozen'

export interface HarnessMemoryConfig {
  /** Store override; empty means the harness layout root. */
  storageRoot: string
  /** Dynamic prompt (Kilo/OpenCode default) or a per-session frozen block. */
  promptMode: PromptMode
  recallLimit: number
  recallFormat: RecallFormat
  recallScope: RecallScope
  recallTextChars: number
  consolidateOnCompact: boolean
  crystallizeOnCompact: boolean
  /** Archive directory; empty means `<store>/backups`. */
  backupDir: string
  /** Append a short memory digest to completed assistant texts (opt-in). */
  textComplete?: boolean
}

export interface HarnessWebConfig {
  enabled: boolean
  host: string
  port: number
}

export interface HarnessEmbeddingConfig {
  provider: 'off' | 'local'
  model: string
  dim: number
  topK: number
  minScore: number
  chunkChars: number
  chunkOverlap: number
  prewarm: boolean
}

export interface HarnessConfig {
  enabled: boolean
  memory: HarnessMemoryConfig
  web: HarnessWebConfig
  embeddings: HarnessEmbeddingConfig
}
