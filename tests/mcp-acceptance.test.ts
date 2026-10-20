/**
 * MCP acceptance checks from plan §15.9: concurrent calls, client and project
 * isolation, restart persistence and a smoke over real transports.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { DEFAULT_MCP_CONFIG, resolveMcpConfig } from '@llm-memory/adapter/mcp/config'
import { McpServer } from '@llm-memory/adapter/mcp/server'
import { McpService } from '@llm-memory/adapter/mcp/service'
import { createLayout } from '@llm-memory/core/layout/index'
import { storesAreSeparate } from '@llm-memory/testkit'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function sandbox(): { home: string; repo: string } {
  const dir = mkdtempSync(join(tmpdir(), 'llm-mcp-accept-'))
  dirs.push(dir)
  const home = join(dir, 'home')
  const repo = join(dir, 'repo')
  mkdirSync(home, { recursive: true })
  mkdirSync(repo, { recursive: true })
  return { home, repo }
}

describe('concurrency', () => {
  it('serves 20 parallel calls without lock errors', async () => {
    const { home, repo } = sandbox()
    const config = resolveMcpConfig(DEFAULT_MCP_CONFIG)
    const service = new McpService({ config, clientId: 'cursor', home, projectRoot: repo })
    service.init()
    const server = new McpServer({ service, config })
    try {
      const calls = Array.from({ length: 20 }, (_, index) =>
        server.dispatch(
          {
            jsonrpc: '2.0',
            id: index + 1,
            method: 'tools/call',
            params:
              index % 2 === 0
                ? { name: 'llm_memory_save', arguments: { text: `parallel fact ${index}`, title: `p${index}` } }
                : { name: 'llm_memory_recall', arguments: { query: 'parallel' } },
          },
          { transport: 'stdio' },
        ),
      )
      const responses = await Promise.all(calls)
      expect(responses).toHaveLength(20)
      for (const response of responses) {
        expect(response?.error).toBeUndefined()
        expect(response?.result).toBeDefined()
      }
      expect(service.status().total).toBe(10)
    } finally {
      service.close()
    }
  })
})

describe('isolation', () => {
  it('keeps two client ids in separate stores', async () => {
    const { home, repo } = sandbox()
    const config = resolveMcpConfig(DEFAULT_MCP_CONFIG)
    const first = new McpService({ config, clientId: 'cursor', home, projectRoot: repo })
    const second = new McpService({ config, clientId: 'zed', home, projectRoot: repo })
    first.init()
    second.init()
    try {
      first.save({ text: 'only cursor knows this', scope: 'project', title: 'cursor fact' })
      expect(first.status().total).toBe(1)
      expect(second.status().total).toBe(0)
      expect(first.store.root).not.toBe(second.store.root)
      expect(storesAreSeparate(createLayout('mcp', { home, clientId: 'cursor' }), createLayout('mcp', { home, clientId: 'zed' }))).toBe(true)
    } finally {
      first.close()
      second.close()
    }
  })

  it('does not leak one project into another within a store', async () => {
    const { home, repo } = sandbox()
    const config = resolveMcpConfig(DEFAULT_MCP_CONFIG)
    const service = new McpService({ config, clientId: 'cursor', home, projectRoot: repo })
    service.init()
    try {
      service.save({ text: 'alpha only', scope: 'project', project: 'alpha', title: 'alpha' })
      service.save({ text: 'beta only', scope: 'project', project: 'beta', title: 'beta' })
      const recalled = await service.recall('', { scope: 'project', project: 'alpha', touch: false })
      expect(recalled.items.map(item => item.project)).toEqual(['alpha'])
      const beta = await service.recall('', { scope: 'project', project: 'beta', touch: false })
      expect(beta.items.map(item => item.project)).toEqual(['beta'])
    } finally {
      service.close()
    }
  })

  it('keeps the memory across a restart', async () => {
    const { home, repo } = sandbox()
    const config = resolveMcpConfig(DEFAULT_MCP_CONFIG)
    const first = new McpService({ config, clientId: 'cursor', home, projectRoot: repo })
    first.init()
    const saved = first.save({ text: 'survives restart', title: 'durable', scope: 'user' })
    first.close()

    const second = new McpService({ config, clientId: 'cursor', home, projectRoot: repo })
    second.init()
    try {
      expect(second.status().total).toBe(1)
      const recalled = await second.recall('durable', { touch: false })
      expect(recalled.items.map(item => item.id)).toContain(saved.id)
    } finally {
      second.close()
    }
  })
})
