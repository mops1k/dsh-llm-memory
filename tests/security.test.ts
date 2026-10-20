/**
 * Security checks of the HTTP-panel harnesses (этап 11): the MCP bearer token
 * never leaves the process through the panel, logs or error bodies; the config
 * file that stores it is owner-only; destructive backup operations stay behind
 * typed confirmations.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { cleanupRoot, trackResource } from './helpers'

import { DEFAULT_MCP_CONFIG, resolveMcpConfig, saveMcpConfig } from '@llm-memory/adapter/mcp/config'
import { startHttpTransport } from '@llm-memory/adapter/mcp/http'
import { startMcpWebServer } from '@llm-memory/adapter/mcp/panel'
import { McpServer } from '@llm-memory/adapter/mcp/server'
import { McpService } from '@llm-memory/adapter/mcp/service'

const TOKEN = 'secret-token-0123456789abcdef'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) cleanupRoot(dir)
})

function setup(): { home: string; repo: string; store: string; service: McpService; server: McpServer; config: ReturnType<typeof resolveMcpConfig> } {
  const dir = mkdtempSync(join(tmpdir(), 'llm-security-'))
  dirs.push(dir)
  const home = join(dir, 'home')
  const repo = join(dir, 'repo')
  const store = join(dir, 'store')
  mkdirSync(home, { recursive: true })
  mkdirSync(repo, { recursive: true })
  const config = resolveMcpConfig({
    ...DEFAULT_MCP_CONFIG,
    memory: { ...DEFAULT_MCP_CONFIG.memory, storageRoot: store },
    mcp: { ...DEFAULT_MCP_CONFIG.mcp, token: TOKEN },
  })
  const service = trackResource(new McpService({ config, clientId: 'security', home, projectRoot: repo }))
  service.init()
  const server = new McpServer({ service, config })
  return { home, repo, store, service, server, config }
}

describe('MCP token stays inside the process', () => {
  it('is absent from the panel page and its JSON API', async () => {
    const { service, config, server } = setup()
    const panel = await startMcpWebServer({ service, config, port: 0 })
    try {
      expect(panel.url).not.toBeNull()
      const page = await (await fetch(panel.url!)).text()
      expect(page).not.toContain(TOKEN)

      const configResponse = await (await fetch(new URL('api/legacy/config', panel.url!))).text()
      expect(configResponse).not.toContain(TOKEN)
      const configBody = JSON.parse(configResponse) as { config: Record<string, unknown> }
      expect(configBody.config['mcp']).toBeUndefined()

      const settingsResponse = await fetch(new URL('api/legacy/settings', panel.url!), {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ recallLimit: 12 }),
      })
      const settingsText = await settingsResponse.text()
      expect(settingsText).not.toContain(TOKEN)
      expect(JSON.parse(settingsText).config.mcp).toBeUndefined()

      const status = await (await fetch(new URL('api/legacy/status', panel.url!))).text()
      expect(status).not.toContain(TOKEN)
      expect(server.supportedVersions.length).toBeGreaterThan(0)
    } finally {
      await panel.close()
      service.close()
    }
  })

  it('is absent from HTTP errors, unauthorized bodies and transport logs', async () => {
    const { service, server } = setup()
    const logs: string[] = []
    const http = await startHttpTransport({ server, token: TOKEN, port: 0, log: line => logs.push(line) })
    try {
      expect(http.url).not.toBeNull()
      const unauthorized = await fetch(http.url!, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer wrong-token' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      })
      expect(unauthorized.status).toBe(401)
      expect(await unauthorized.text()).not.toContain(TOKEN)

      const forbidden = await fetch(http.url!, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}`, origin: 'http://evil.example' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      })
      expect(forbidden.status).toBe(403)
      expect(await forbidden.text()).not.toContain(TOKEN)

      const unknown = await server.dispatch(
        { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'nope', arguments: {} } },
        { transport: 'http' },
      )
      expect(JSON.stringify(unknown)).not.toContain(TOKEN)
      expect(logs.join('\n')).not.toContain(TOKEN)
    } finally {
      await http.close()
      service.close()
    }
  })

  it('writes the config file owner-only', () => {
    const { store, config } = setup()
    saveMcpConfig(store, config)
    const file = join(store, 'config.json')
    // The token must be persisted (the client needs it at the next start), but
    // only the owner may read the file.
    expect(readFileSync(file, 'utf8')).toContain(TOKEN)
    if (process.platform !== 'win32') {
      const mode = statSync(file).mode & 0o777
      expect(mode & 0o077).toBe(0)
    }
  })
})
