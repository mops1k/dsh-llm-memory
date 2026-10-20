/**
 * MCP adapter configuration and store resolution.
 *
 * One MCP client id = one store under `~/.llm-memory/mcp/<client-id>`; the
 * config file lives inside that store (`config.json`), so a client can be moved
 * together with its memory. The store must never point at Kilo, DSH or OpenCode
 * (ADR-002/007) — that is checked before the database is opened.
 *
 * @module dsh-llm-memory/adapters/mcp/config
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { assertLocalPath, sanitizeProjectKey, StorePathError } from '../../core/layout/index.js'
import { createLayout } from '../../core/layout/index.js'
import { resolveStorageRoot } from '../../core/layout/paths.js'
import { createIsolation } from '../../core/isolation/contract.js'
import type { HarnessConfig } from '../../core/domain/harness-config.js'

/** Conservative message limits of the MCP surface (plan §15.7). */
export interface McpLimits {
  /** Ceiling for one JSON-RPC request body. */
  maxRequestBytes: number
  /** Ceiling for the text of one saved entry. */
  maxEntryBytes: number
  /** Ceiling for one rendered tool result. */
  maxResponseBytes: number
}

/** Transport and store settings of the MCP server, persisted with the config. */
export interface McpServerConfig {
  /** Client id that owns the store; empty means "take it from the CLI/env". */
  clientId: string
  transport: 'stdio' | 'http'
  host: string
  port: number
  /** Bearer token for HTTP; empty means the CLI/env must provide one. */
  token: string
  /** `llm_memory_delete` in HTTP; stdio always allows it. */
  allowDelete: boolean
  /** Bind beyond loopback; off by default (plan §15.7). */
  allowExternalBind: boolean
  limits: McpLimits
}

export interface McpConfig extends HarnessConfig {
  mcp: McpServerConfig
}

export const DEFAULT_MCP_LIMITS: McpLimits = {
  maxRequestBytes: 256 * 1024,
  maxEntryBytes: 1024 * 1024,
  maxResponseBytes: 2 * 1024 * 1024,
}

export const DEFAULT_MCP_CONFIG: McpConfig = {
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
  web: { enabled: true, host: '127.0.0.1', port: 8789 },
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
  mcp: {
    clientId: '',
    transport: 'stdio',
    host: '127.0.0.1',
    port: 8790,
    token: '',
    allowDelete: false,
    allowExternalBind: false,
    limits: { ...DEFAULT_MCP_LIMITS },
  },
}

function mergeSection<T extends object>(base: T, raw: unknown): T {
  if (raw === null || typeof raw !== 'object') return { ...base }
  const merged: Record<string, unknown> = { ...(base as unknown as Record<string, unknown>) }
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value !== undefined) merged[key] = value
  }
  return merged as T
}

/** Deep-merge a stored config over the defaults; unknown keys are kept. */
export function resolveMcpConfig(raw: unknown): McpConfig {
  if (raw === null || typeof raw !== 'object') return structuredClone(DEFAULT_MCP_CONFIG)
  const input = raw as Partial<McpConfig>
  const base = structuredClone(DEFAULT_MCP_CONFIG)
  const mcp = mergeSection(base.mcp, input.mcp)
  return {
    ...base,
    ...input,
    memory: mergeSection(base.memory, input.memory),
    web: mergeSection(base.web, input.web),
    embeddings: mergeSection(base.embeddings, input.embeddings),
    mcp: { ...mcp, limits: mergeSection(base.mcp.limits, (input.mcp as Partial<McpServerConfig> | undefined)?.limits) },
  }
}

/** Roots the MCP store must never touch: the native harness stores. */
export function mcpForbiddenRoots(home: string = homedir()): string[] {
  return [
    createLayout('kilo', { home }).userRoot(),
    createLayout('dsh', { home }).userRoot(),
    createLayout('opencode', { home }).userRoot(),
  ]
}

/** Database file inside a client store (plan §15.6 uses `_db`). */
export function mcpStoreDbPath(storeRoot: string): string {
  return join(storeRoot, '_db', 'memory.db')
}

function requireClientId(value: string | undefined): string {
  const clientId = (value ?? '').trim()
  if (clientId.length === 0) {
    throw new StorePathError('MCP client id is required: pass --client-id or set LLM_MEMORY_MCP_CLIENT_ID')
  }
  return clientId
}

function localRoot(path: string): string {
  try {
    const resolved = resolveStorageRoot(path)
    return assertLocalPath(resolved)
  } catch (error) {
    if (error instanceof StorePathError) throw error
    throw new StorePathError(error instanceof Error ? error.message : String(error))
  }
}

/** Refuse a store that overlaps another harness (ADR-002/007). */
export function assertMcpNoForeignStore(storeRoot: string, home: string = homedir()): void {
  const isolation = createIsolation({
    identity: { harness: 'mcp', instanceId: `mcp-${process.pid}`, storeId: 'mcp' },
    storeRoot,
    forbiddenRoots: mcpForbiddenRoots(home),
  })
  isolation.assertNoForeignPaths()
}

export interface McpStoreOptions {
  clientId: string | undefined
  /** `--storage-root`; empty means the per-client default. */
  storageRoot?: string
  home?: string
}

/** Absolute store root for one client id, with the foreign-store guard. */
export function resolveMcpStoreRoot(options: McpStoreOptions): string {
  const clientId = requireClientId(options.clientId)
  const home = options.home ?? homedir()
  const configured = (options.storageRoot ?? '').trim()
  const root =
    configured.length > 0
      ? localRoot(configured)
      : join(home, '.llm-memory', 'mcp', sanitizeProjectKey(clientId))
  assertMcpNoForeignStore(root, home)
  return root
}

/** Location of the per-client config inside the store. */
export function mcpConfigPath(storeRoot: string): string {
  return join(storeRoot, 'config.json')
}

/** Stored config or the defaults when the file is absent or unreadable. */
export function loadMcpConfig(storeRoot: string): McpConfig {
  try {
    return resolveMcpConfig(JSON.parse(readFileSync(mcpConfigPath(storeRoot), 'utf8')) as unknown)
  } catch {
    return resolveMcpConfig({})
  }
}

/** Persist the config next to the store; the panel calls this on every save. */
export function saveMcpConfig(storeRoot: string, config: McpConfig): void {
  mkdirSync(storeRoot, { recursive: true })
  writeFileSync(mcpConfigPath(storeRoot), `${JSON.stringify(config, null, 2)}\n`, 'utf8')
}
