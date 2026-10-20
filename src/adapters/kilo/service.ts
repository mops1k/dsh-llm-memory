/**
 * Kilo adapter: the shared `MemoryService` bound to the Kilo layout, plus the
 * Kilo row mapping used by migrations and cutover.
 */
import {
  MemoryService,
  type MemoryServiceOptions,
  type MemoryServiceStatus,
  type RecallOptions,
  type RecallResult,
  type SaveInput,
} from '../../core/application/memory-service.js'
import type { MemoryEntry } from '../../core/domain/types.js'
import { entryFromKiloRow, entryToKiloRow } from '../../core/domain/mapping.js'
import { createKiloLayout, type LayoutPort } from '../../core/layout/index.js'
import type { RuntimeRunner } from '../../core/infrastructure/runtime-install.js'

import type { KiloMemoryConfig } from './config.js'

const KILO_PROJECT_DIR = '.kilo/memory'

/** Core settings the Kilo runtime does not apply yet (parity work in progress). */
const SETTINGS_UNSUPPORTED_IN_KILO: readonly string[] = [
  'projectRoots',
  'projectScanBudgetMs',
  'webPath',
  'recallTotalChars',
  'recallFormat',
  'recallScope',
  'recallAllowFormatOverride',
  'recallLiteralLookup',
  'promptRulesLimit',
  'rulesPromptScope',
  'sessionStartGuide',
  'systemPrompt',
  'lintOverlapMinCommonWords',
  'lintMaxPairs',
  'autonomous',
  'requireConfirmation',
  'embeddings.backend',
  'embeddings.quantization',
  'embeddings.batchSize',
  'embeddings.queryPrefix',
  'embeddings.passagePrefix',
  'embeddings.semanticEdgesPerEntry',
  'embeddings.semanticMaxEdges',
]

export interface KiloServiceOptions {
  config: KiloMemoryConfig
  /** Repository root of the current Kilo window. */
  projectRoot?: string
  layout?: LayoutPort
  /** Provider supplied by the host (tests); skips the embedding runtime. */
  embeddingProvider?: MemoryServiceOptions['embeddingProvider']
  /** Drive the embedding queue by hand instead of letting it run in the background. */
  manualEmbeddings?: boolean
  /** Kilo config directory the plugin resolves its runtime from. */
  configDir?: string
  /** Runner used to install the embedding runtime (tests). */
  runtimeRunner?: RuntimeRunner
}

export class KiloService extends MemoryService {
  constructor(options: KiloServiceOptions) {
    super({
      ...options,
      harness: 'kilo',
      layout: options.layout ?? createKiloLayout(),
      projectDir: KILO_PROJECT_DIR,
      origin: 'kilo',
      unsupportedSettings: SETTINGS_UNSUPPORTED_IN_KILO,
      uiLocale: 'ru',
    })
  }

  /** Compatibility helper for migrations: canonical rows of this store. */
  rows(): Record<string, unknown>[] {
    return this.store.list({ limit: 1_000_000 }).items.map(entryToKiloRow)
  }

  static fromRow(row: Record<string, unknown>): MemoryEntry {
    return entryFromKiloRow(row)
  }
}

export type { KiloMemoryConfig }
export type { SaveInput, RecallOptions, RecallResult }
export type KiloStatus = MemoryServiceStatus
