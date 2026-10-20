/**
 * End-to-end smoke for every harness: DSH engine, Kilo, OpenCode and MCP each
 * get their own temporary home, write one entry, recall it, serve their panel
 * and take a verified backup. The live host runs (Kilo on Windows, OpenCode
 * 2.1.1) are reported in docs/adr; this file is the repeatable in-process E2E.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { MemoryEngine } from '@llm-memory/core/application/engine'
import { mergeConfig } from '@llm-memory/core/domain/config'
import { createBackup, verifyBackup } from '@llm-memory/core/infrastructure/backup'
import { DEFAULT_KILO_CONFIG, resolveKiloConfig } from '@llm-memory/adapter/kilo/config'
import { KiloService } from '@llm-memory/adapter/kilo/service'
import { startKiloWebServer } from '@llm-memory/adapter/kilo/web-server'
import { DEFAULT_OPENCODE_CONFIG, resolveOpenCodeConfig } from '@llm-memory/adapter/opencode/config'
import { createOpenCodeRuntime } from '@llm-memory/adapter/opencode/runtime'
import { OpenCodeService } from '@llm-memory/adapter/opencode/service'
import { startOpenCodeWebServer } from '@llm-memory/adapter/opencode/web-server'
import { DEFAULT_MCP_CONFIG, resolveMcpConfig } from '@llm-memory/adapter/mcp/config'
import { startHttpTransport } from '@llm-memory/adapter/mcp/http'
import { startMcpWebServer } from '@llm-memory/adapter/mcp/panel'
import { McpServer } from '@llm-memory/adapter/mcp/server'
import { McpService } from '@llm-memory/adapter/mcp/service'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function sandbox(): { dir: string; home: string; repo: string } {
  const dir = mkdtempSync(join(tmpdir(), 'llm-e2e-'))
  dirs.push(dir)
  const home = join(dir, 'home')
  const repo = join(dir, 'repo')
  mkdirSync(home, { recursive: true })
  mkdirSync(repo, { recursive: true })
  return { dir, home, repo }
}

async function panelTotal(url: string | null): Promise<number> {
  if (url === null) throw new Error('panel did not start')
  const response = await fetch(new URL('api/legacy/status', url))
  expect(response.status).toBe(200)
  const body = (await response.json()) as { status: { total: number } }
  return body.status.total
}

describe('E2E: DSH engine', () => {
  it('saves, recalls and backs up its own store', async () => {
    const { dir } = sandbox()
    const root = join(dir, 'dsh')
    const engine = new MemoryEngine({ storageRoot: root, project: 'demo', config: mergeConfig({}) })
    try {
      const saved = engine.save({ text: 'DSH e2e fact', title: 'dsh e2e' })
      const recalled = await engine.recall('DSH e2e', { touch: false })
      expect(recalled.items.map(item => item.id)).toContain(saved.id)

      const backupsDir = join(root, 'backups')
      const report = createBackup({
        harness: 'dsh',
        storeDir: engine.getStore().root,
        dbPath: engine.getStore().dbPath,
        projectDirs: [],
        backupsDir,
      })
      expect(verifyBackup(report.archive).ok).toBe(true)
    } finally {
      engine.close()
    }
  })
})

describe('E2E: Kilo adapter', () => {
  it('saves, recalls, serves the panel and takes a backup', async () => {
    const { dir, repo } = sandbox()
    const config = resolveKiloConfig({
      memory: { ...DEFAULT_KILO_CONFIG.memory, storageRoot: join(dir, 'kilo') },
      web: { ...DEFAULT_KILO_CONFIG.web, enabled: true },
    })
    const service = new KiloService({ config, projectRoot: repo, configDir: join(dir, 'kilo-conf') })
    service.init()
    const panel = await startKiloWebServer({ service, config, port: 0 })
    try {
      const saved = service.save({ text: 'Kilo e2e fact', title: 'kilo e2e' })
      const recalled = await service.recall('Kilo e2e', { touch: false })
      expect(recalled.items.map(item => item.id)).toContain(saved.id)
      expect(await panelTotal(panel.url)).toBe(1)
      expect(verifyBackup(service.backupCreate().archive).ok).toBe(true)
    } finally {
      await panel.close()
      service.close()
    }
  })
})

describe('E2E: OpenCode adapter', () => {
  it('saves, recalls, injects the guide and serves the panel', async () => {
    const { dir, repo } = sandbox()
    const config = resolveOpenCodeConfig({
      memory: { ...DEFAULT_OPENCODE_CONFIG.memory, storageRoot: join(dir, 'opencode') },
      web: { ...DEFAULT_OPENCODE_CONFIG.web, enabled: true },
    })
    const service = new OpenCodeService({ config, projectRoot: repo, configDir: join(dir, 'oc-conf') })
    service.init()
    const panel = await startOpenCodeWebServer({ service, config, port: 0 })
    try {
      const saved = service.save({ text: 'OpenCode e2e fact', title: 'opencode e2e' })
      const recalled = await service.recall('OpenCode e2e', { touch: false })
      expect(recalled.items.map(item => item.id)).toContain(saved.id)

      const runtime = createOpenCodeRuntime({ service, config })
      const output: { system: string[] } = { system: [] }
      await runtime.hooks['experimental.chat.system.transform']?.({ sessionID: 'e2e' }, output)
      expect(output.system.join('\n')).toContain('llm_memory_recall')

      expect(await panelTotal(panel.url)).toBe(1)
      expect(verifyBackup(service.backupCreate().archive).ok).toBe(true)
    } finally {
      await panel.close()
      service.close()
    }
  })
})

describe('E2E: MCP adapter', () => {
  it('speaks stdio and HTTP, serves the panel and backs up through the tool', async () => {
    const { dir, home, repo } = sandbox()
    const config = resolveMcpConfig({
      ...DEFAULT_MCP_CONFIG,
      memory: { ...DEFAULT_MCP_CONFIG.memory, storageRoot: join(dir, 'mcp') },
      web: { ...DEFAULT_MCP_CONFIG.web, enabled: true },
    })
    const service = new McpService({ config, clientId: 'e2e', home, projectRoot: repo })
    service.init()
    const server = new McpServer({ service, config })
    const panel = await startMcpWebServer({ service, config, port: 0 })
    const http = await startHttpTransport({ server, token: 'e2e-token', port: 0 })
    try {
      const saved = await server.dispatch(
        { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'llm_memory_save', arguments: { text: 'MCP e2e fact', title: 'mcp e2e' } } },
        { transport: 'stdio' },
      )
      expect(saved?.error).toBeUndefined()
      const recalled = await server.dispatch(
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'llm_memory_recall', arguments: { query: 'MCP e2e' } } },
        { transport: 'stdio' },
      )
      expect(JSON.stringify(recalled?.result)).toContain('mcp e2e')

      expect(http.url).not.toBeNull()
      const overHttp = await fetch(http.url!, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer e2e-token' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/list' }),
      })
      expect(overHttp.status).toBe(200)
      expect(await panelTotal(panel.url)).toBe(1)

      const backup = await server.dispatch(
        { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'llm_memory_backup', arguments: { operation: 'create' } } },
        { transport: 'stdio' },
      )
      const backupResult = backup?.result as { content: { text: string }[] }
      const report = JSON.parse(backupResult.content[0]!.text) as { ok: boolean; archive: string }
      expect(report.ok).toBe(true)
      expect(report.archive.startsWith(join(dir, 'mcp'))).toBe(true)
    } finally {
      await http.close()
      await panel.close()
      service.close()
    }
  })
})
