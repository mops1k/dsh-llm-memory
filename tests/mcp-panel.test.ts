/**
 * MCP web panel: the shared design on port 8789, full settings and backups,
 * with the graceful-disable behaviour the other hosts already have (ADR-004/007).
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { DEFAULT_MCP_CONFIG, resolveMcpConfig } from '@llm-memory/adapter/mcp/config'
import { startMcpWebServer } from '@llm-memory/adapter/mcp/panel'
import { McpService } from '@llm-memory/adapter/mcp/service'
import type { McpConfig } from '@llm-memory/adapter/mcp/config'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function setup(): { service: McpService; config: McpConfig } {
  const dir = mkdtempSync(join(tmpdir(), 'llm-mcp-panel-'))
  dirs.push(dir)
  const home = join(dir, 'home')
  const repo = join(dir, 'repo')
  mkdirSync(home, { recursive: true })
  mkdirSync(repo, { recursive: true })
  const config = resolveMcpConfig({ ...DEFAULT_MCP_CONFIG })
  const service = new McpService({ config, clientId: 'cursor', home, projectRoot: repo })
  service.init()
  return { service, config }
}

describe('MCP web panel', () => {
  it('serves the shared design with the mcp host wiring', async () => {
    const { service, config } = setup()
    try {
      const panel = await startMcpWebServer({ service, config, port: 0 })
      expect(panel.url).not.toBeNull()
      const page = await fetch(panel.url!)
      expect(page.status).toBe(200)
      const html = await page.text()
      expect(html).toContain('"kind":"mcp"')
      expect(html).toContain('window.__LM_PANEL__')

      const status = await fetch(new URL('api/legacy/status', panel.url!))
      expect(status.status).toBe(200)
      const body = (await status.json()) as { ok: boolean; status: { total: number; root: string } }
      expect(body.ok).toBe(true)
      expect(body.status.total).toBe(0)
      expect(body.status.root.replace(/\\/g, '/')).toContain('.llm-memory/mcp/cursor')
      await panel.close()
    } finally {
      service.close()
    }
  })

  it('applies a settings patch and persists the whole config, mcp section included', async () => {
    const { service, config } = setup()
    try {
      const saved: McpConfig[] = []
      const panel = await startMcpWebServer({
        service,
        config,
        port: 0,
        saveConfig: next => saved.push(next),
      })
      const response = await fetch(new URL('api/legacy/settings', panel.url!), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ recallLimit: 25 }),
      })
      expect(response.status).toBe(200)
      const body = (await response.json()) as { ok: boolean; applied: string[] }
      expect(body.applied).toContain('recallLimit')
      expect(saved).toHaveLength(1)
      expect(saved[0]?.memory.recallLimit).toBe(25)
      expect(saved[0]?.mcp.clientId).toBe('')

      const configPut = await fetch(new URL('api/legacy/config', panel.url!), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ memory: { recallLimit: 30 } }),
      })
      expect(configPut.status).toBe(200)
      expect(saved).toHaveLength(2)
      expect(saved[1]?.memory.recallLimit).toBe(30)
      expect(saved[1]?.mcp.port).toBe(8790)
      await panel.close()
    } finally {
      service.close()
    }
  })

  it('degrades gracefully on a busy port and when the web UI is off', async () => {
    const { service, config } = setup()
    try {
      const first = await startMcpWebServer({ service, config, port: 0 })
      const port = Number(new URL(first.url!).port)
      const second = await startMcpWebServer({ service, config, port })
      expect(second.url).toBeNull()
      expect(second.disabledReason).toMatch(/busy/)
      await first.close()

      const off = await startMcpWebServer({ service, config: { ...config, web: { ...config.web, enabled: false } }, port: 0 })
      expect(off.url).toBeNull()
      expect(off.disabledReason).toMatch(/disabled/)
    } finally {
      service.close()
    }
  })
})
