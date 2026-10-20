/**
 * MCP adapter contract: per-client store, config file and CLI surface.
 *
 * The invariants come from ADR-002 (separate stores) and the MCP section of the
 * plan: a client id is mandatory, the store never overlaps Kilo/DSH/OpenCode,
 * pages stay inside the client store, and the CLI takes the documented flags.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { parseMcpArgs } from '@llm-memory/adapter/mcp/args'
import {
  DEFAULT_MCP_CONFIG,
  loadMcpConfig,
  mcpForbiddenRoots,
  mcpStoreDbPath,
  resolveMcpConfig,
  resolveMcpStoreRoot,
  saveMcpConfig,
} from '@llm-memory/adapter/mcp/config'
import { McpService } from '@llm-memory/adapter/mcp/service'
import { IsolationViolation } from '@llm-memory/core/isolation/index'
import { createLayout, StorePathError } from '@llm-memory/core/layout/index'
import { assertLayoutContract, storesAreSeparate } from '@llm-memory/testkit'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function sandbox(): { home: string; repo: string } {
  const dir = mkdtempSync(join(tmpdir(), 'llm-mcp-'))
  dirs.push(dir)
  const home = join(dir, 'home')
  const repo = join(dir, 'repo')
  mkdirSync(home, { recursive: true })
  mkdirSync(repo, { recursive: true })
  return { home, repo }
}

describe('MCP config defaults', () => {
  it('uses the reserved ports and conservative limits', () => {
    expect(DEFAULT_MCP_CONFIG.web.port).toBe(8789)
    expect(DEFAULT_MCP_CONFIG.mcp.port).toBe(8790)
    expect(DEFAULT_MCP_CONFIG.mcp.transport).toBe('stdio')
    expect(DEFAULT_MCP_CONFIG.embeddings.provider).toBe('off')
    expect(DEFAULT_MCP_CONFIG.mcp.limits).toEqual({
      maxRequestBytes: 256 * 1024,
      maxEntryBytes: 1024 * 1024,
      maxResponseBytes: 2 * 1024 * 1024,
    })
  })

  it('deep-merges stored values over the defaults', () => {
    const config = resolveMcpConfig({
      web: { port: 9001 },
      mcp: { clientId: 'Cursor', limits: { maxEntryBytes: 10 } },
    })
    expect(config.web.port).toBe(9001)
    expect(config.web.host).toBe('127.0.0.1')
    expect(config.mcp.clientId).toBe('Cursor')
    expect(config.mcp.limits.maxEntryBytes).toBe(10)
    expect(config.mcp.limits.maxRequestBytes).toBe(256 * 1024)
    expect(config.mcp.transport).toBe('stdio')
  })

  it('round-trips through the client store config file', () => {
    const { home } = sandbox()
    const root = resolveMcpStoreRoot({ clientId: 'cursor', home })
    const config = resolveMcpConfig({ mcp: { clientId: 'cursor', token: 'secret-token' } })
    expect(loadMcpConfig(root)).toEqual(DEFAULT_MCP_CONFIG)
    saveMcpConfig(root, config)
    expect(existsSync(join(root, 'config.json'))).toBe(true)
    expect(loadMcpConfig(root).mcp.token).toBe('secret-token')
    expect(loadMcpConfig(root).mcp.clientId).toBe('cursor')
  })
})

describe('MCP store root', () => {
  it('requires a client id', () => {
    expect(() => resolveMcpStoreRoot({ clientId: '   ' })).toThrow(/client id/i)
    expect(() => createLayout('mcp', {})).toThrow(/clientId/)
  })

  it('slugs the client id and keeps one store per client', () => {
    const { home } = sandbox()
    expect(resolveMcpStoreRoot({ clientId: 'Claude Desktop!', home })).toBe(join(home, '.llm-memory', 'mcp', 'claude-desktop'))
    expect(resolveMcpStoreRoot({ clientId: 'Cursor', home })).not.toBe(resolveMcpStoreRoot({ clientId: 'Zed', home }))
  })

  it('accepts a storage-root override but rejects a foreign one', () => {
    const { home, repo } = sandbox()
    const outside = join(repo, 'mcp-store')
    expect(resolveMcpStoreRoot({ clientId: 'cursor', home, storageRoot: outside })).toBe(outside)

    const kiloRoot = mcpForbiddenRoots(home).find(root => root.includes('.config') && root.endsWith('memory'))!
    expect(() => resolveMcpStoreRoot({ clientId: 'cursor', home, storageRoot: join(kiloRoot, 'mcp') })).toThrow(IsolationViolation)
  })

  it('rejects a network share as a store', () => {
    expect(() => resolveMcpStoreRoot({ clientId: 'cursor', storageRoot: '\\\\wsl.localhost\\x\\store' })).toThrow(StorePathError)
  })

  it('keeps its store apart from every native harness', () => {
    const { home } = sandbox()
    const mcp = createLayout('mcp', { home, clientId: 'cursor' })
    assertLayoutContract(mcp)
    expect(mcpStoreDbPath(mcp.userRoot())).toBe(mcp.dbPath())
    expect(storesAreSeparate(mcp, createLayout('kilo', { home }))).toBe(true)
    expect(storesAreSeparate(mcp, createLayout('dsh', { home }))).toBe(true)
    expect(storesAreSeparate(mcp, createLayout('opencode', { home }))).toBe(true)
  })
})

describe('McpService', () => {
  it('opens the per-client store and keeps project pages inside it', async () => {
    const { home, repo } = sandbox()
    const service = new McpService({ config: DEFAULT_MCP_CONFIG, clientId: 'cursor', home, projectRoot: repo })
    try {
      service.init()
      const entry = service.save({ text: 'Project note', scope: 'project', title: 'Project note' })
      expect(entry.project).toBe(repo)
      const storeRoot = service.store.root
      expect(storeRoot).toBe(join(home, '.llm-memory', 'mcp', 'cursor'))
      expect(service.store.dbPath).toBe(join(storeRoot, '_db', 'memory.db'))
      expect(existsSync(join(storeRoot, 'projects', 'repo'))).toBe(true)
      expect(readdirSync(repo)).toEqual([])
      const saved = await service.recall('', { scope: 'project', touch: false })
      expect(saved.items.map(item => item.id)).toContain(entry.id)
    } finally {
      service.close()
    }
  })

  it('refuses to open a store inside another harness', () => {
    const { home, repo } = sandbox()
    const kiloRoot = join(home, '.config', 'kilo', 'memory')
    mkdirSync(kiloRoot, { recursive: true })
    // The user layer of Kilo ends with `memory`, so a sibling under it must fail.
    expect(() => resolveMcpStoreRoot({ clientId: 'cursor', home, storageRoot: join(kiloRoot, 'mcp') })).toThrow(IsolationViolation)
    const service = new McpService({ config: DEFAULT_MCP_CONFIG, clientId: 'cursor', home, projectRoot: repo })
    try {
      service.init()
      // A normal store opens fine; the guard is what the previous line proved.
      expect(service.store.isOpen).toBe(true)
    } finally {
      service.close()
    }
  })
})

describe('parseMcpArgs', () => {
  it('parses every documented flag', () => {
    const options = parseMcpArgs([
      '--transport',
      'http',
      '--client-id',
      'cursor',
      '--storage-root',
      '/tmp/store',
      '--project-root',
      '/repo',
      '--project-key',
      'proj',
      '--host',
      '127.0.0.1',
      '--port',
      '9000',
      '--token',
      'tok',
      '--allow-delete',
      '--allow-external-bind',
      '--no-ui',
      '--config',
      '/tmp/config.json',
    ])
    expect(options).toMatchObject({
      transport: 'http',
      clientId: 'cursor',
      storageRoot: '/tmp/store',
      projectRoot: '/repo',
      projectKey: 'proj',
      host: '127.0.0.1',
      port: 9000,
      token: 'tok',
      allowDelete: true,
      allowExternalBind: true,
      ui: false,
      configPath: '/tmp/config.json',
    })
  })

  it('defaults to stdio and keeps the UI on', () => {
    expect(parseMcpArgs([])).toEqual({ ui: true })
    expect(parseMcpArgs(['--ui']).ui).toBe(true)
  })

  it('rejects a bad transport, a bad port and unknown flags', () => {
    expect(() => parseMcpArgs(['--transport', 'sse'])).toThrow(/transport/)
    expect(() => parseMcpArgs(['--port', 'nope'])).toThrow(/port/)
    expect(() => parseMcpArgs(['--wat'])).toThrow(/unknown argument/)
    expect(() => parseMcpArgs(['--client-id'])).toThrow(/missing value/)
  })
})
