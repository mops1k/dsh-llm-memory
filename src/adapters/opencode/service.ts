/**
 * OpenCode adapter: the shared `MemoryService` bound to the OpenCode layout.
 *
 * Store: `~/.config/opencode/memory` (or `<repo>/.opencode/memory` for pages),
 * database `<store>/db/memory.db`, model cache `<store>/_models`.
 */
import {
  MemoryService,
  type MemoryServiceOptions,
  type MemoryServiceStatus,
  type RecallOptions,
  type RecallResult,
  type SaveInput,
} from '../../core/application/memory-service.js'
import { createLayout } from '../../core/layout/index.js'
import type { LayoutPort } from '../../core/layout/index.js'
import type { RuntimeRunner } from '../../core/infrastructure/runtime-install.js'

import type { OpenCodeMemoryConfig } from './config.js'

const OPENCODE_PROJECT_DIR = '.opencode/memory'

/** Core settings the OpenCode runtime does not apply yet (parity work in progress). */
const SETTINGS_UNSUPPORTED_IN_OPENCODE: readonly string[] = [
  'projectRoots',
  'projectScanBudgetMs',
  'webPath',
  'recallTotalChars',
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

export interface OpenCodeServiceOptions {
  config: OpenCodeMemoryConfig
  /** Repository root of the current OpenCode session. */
  projectRoot?: string
  layout?: LayoutPort
  /** Provider supplied by the host (tests); skips the embedding runtime. */
  embeddingProvider?: MemoryServiceOptions['embeddingProvider']
  /** Drive the embedding queue by hand instead of letting it run in the background. */
  manualEmbeddings?: boolean
  /** OpenCode config directory the plugin resolves its runtime from. */
  configDir?: string
  /** Runner used to install the embedding runtime (tests). */
  runtimeRunner?: RuntimeRunner
}

export class OpenCodeService extends MemoryService {
  constructor(options: OpenCodeServiceOptions) {
    super({
      ...options,
      harness: 'opencode',
      layout: options.layout ?? createLayout('opencode'),
      projectDir: OPENCODE_PROJECT_DIR,
      origin: 'opencode',
      unsupportedSettings: SETTINGS_UNSUPPORTED_IN_OPENCODE,
      uiLocale: 'en',
    })
  }
}

export type { OpenCodeMemoryConfig, SaveInput, RecallOptions, RecallResult }
export type OpenCodeStatus = MemoryServiceStatus
