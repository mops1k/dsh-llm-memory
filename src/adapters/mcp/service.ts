/**
 * MCP adapter service: the shared `MemoryService` on its own per-client store.
 *
 * Store root: `~/.llm-memory/mcp/<client-id>` (or `--storage-root`), database
 * `<store>/_db/memory.db`, project pages `<store>/projects/<project>/<kind>/`
 * — never inside the repository (plan §15.6), so two MCP clients cannot mix
 * the memory of one project. Kilo, DSH and OpenCode stores are forbidden roots.
 *
 * @module dsh-llm-memory/adapters/mcp/service
 */
import { homedir } from 'node:os'
import { join } from 'node:path'

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

import { mcpForbiddenRoots, mcpStoreDbPath, resolveMcpStoreRoot, type McpConfig } from './config.js'

/** Core settings the MCP runtime does not apply (no hook, no panel parity yet). */
const SETTINGS_UNSUPPORTED_IN_MCP: readonly string[] = [
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

export interface McpServiceOptions {
  config: McpConfig
  /** Client id that owns the store (one client = one memory). */
  clientId: string
  /** Fake home for tests. */
  home?: string
  /** `--storage-root`; empty means the per-client default. */
  storageRoot?: string
  /** Project the server works for; defaults to the process cwd. */
  projectRoot?: string
  /** Explicit project key instead of the directory basename. */
  projectKey?: string
  layout?: LayoutPort
  /** Provider supplied by the host (tests); skips the embedding runtime. */
  embeddingProvider?: MemoryServiceOptions['embeddingProvider']
  /** Drive the embedding queue by hand instead of letting it run in the background. */
  manualEmbeddings?: boolean
}

export class McpService extends MemoryService {
  readonly clientId: string

  constructor(options: McpServiceOptions) {
    const home = options.home ?? homedir()
    const cwd = options.projectRoot ?? process.cwd()
    // `--storage-root` wins; a config file may carry the same value, so a client
    // built from config alone still lands in the store it names.
    const configuredRoot = (options.storageRoot ?? options.config.memory.storageRoot ?? '').trim()
    const storeRoot = resolveMcpStoreRoot({
      clientId: options.clientId,
      home,
      ...(configuredRoot.length > 0 ? { storageRoot: configuredRoot } : {}),
    })
    const layout = options.layout ?? createLayout('mcp', { home, cwd, clientId: options.clientId })
    super({
      config: options.config,
      storeRoot,
      harness: 'mcp',
      layout,
      projectDir: 'pages',
      origin: 'mcp',
      projectRoot: options.projectKey ?? cwd,
      dbPath: mcpStoreDbPath(storeRoot),
      projectPagesRoot: join(storeRoot, 'projects'),
      forbiddenRoots: mcpForbiddenRoots(home),
      unsupportedSettings: SETTINGS_UNSUPPORTED_IN_MCP,
      uiLocale: 'en',
      ...(options.embeddingProvider ? { embeddingProvider: options.embeddingProvider } : {}),
      ...(options.manualEmbeddings === true ? { manualEmbeddings: true } : {}),
    })
    this.clientId = options.clientId
  }
}

export type { McpConfig, SaveInput, RecallOptions, RecallResult }
export type McpStatus = MemoryServiceStatus
