/**
 * MCP server surface: tools, prompt, resource, project scoping and limits.
 *
 * The server wraps the shared `llm_memory_*` tools, so this file checks the MCP
 * specifics only: JSON schema shape, the delete policy per transport, the
 * optional `project` argument, the guide prompt/resource and the conservative
 * limits (plan §15.4–15.7).
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { DEFAULT_MCP_CONFIG, resolveMcpConfig } from '@llm-memory/adapter/mcp/config'
import { McpServer, MCP_SERVER_NAME } from '@llm-memory/adapter/mcp/server'
import { McpService } from '@llm-memory/adapter/mcp/service'
import type { JsonRpcResponse } from '@llm-memory/adapter/mcp/protocol'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

interface Harness {
  home: string
  repo: string
  service: McpService
  server: McpServer
}

function setup(options: { allowDelete?: boolean; limits?: Record<string, number>; settings?: Record<string, unknown> } = {}): Harness {
  const dir = mkdtempSync(join(tmpdir(), 'llm-mcp-server-'))
  dirs.push(dir)
  const home = join(dir, 'home')
  const repo = join(dir, 'repo')
  mkdirSync(home, { recursive: true })
  mkdirSync(repo, { recursive: true })
  const config = resolveMcpConfig({ ...DEFAULT_MCP_CONFIG, ...(options.settings ? options.settings : {}) })
  const service = new McpService({ config, clientId: 'cursor', home, projectRoot: repo })
  service.init()
  const server = new McpServer({
    service,
    config,
    allowDelete: options.allowDelete === true,
    ...(options.limits ? { limits: { ...config.mcp.limits, ...options.limits } } : {}),
  })
  return { home, repo, service, server }
}

async function call(harness: Harness, method: string, params: Record<string, unknown> = {}, transport: 'stdio' | 'http' = 'stdio'): Promise<JsonRpcResponse | null> {
  return harness.server.dispatch({ jsonrpc: '2.0', id: 1, method, params }, { transport })
}

async function callTool(harness: Harness, name: string, args: Record<string, unknown> = {}, transport: 'stdio' | 'http' = 'stdio'): Promise<{ text: string; isError: boolean; structured?: Record<string, unknown> }> {
  const response = await call(harness, 'tools/call', { name, arguments: args }, transport)
  const result = response?.result as { content: { type: string; text: string }[]; isError?: boolean; structuredContent?: Record<string, unknown> }
  return { text: result.content[0]?.text ?? '', isError: result.isError === true, ...(result.structuredContent ? { structured: result.structuredContent } : {}) }
}

describe('initialize', () => {
  it('advertises the server, its capabilities and the guide', async () => {
    const harness = setup()
    try {
      const result = (await call(harness, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } }))?.result as Record<string, unknown>
      expect(result['protocolVersion']).toBe('2025-11-25')
      const serverInfo = result['serverInfo'] as Record<string, unknown>
      expect(serverInfo['name']).toBe(MCP_SERVER_NAME)
      const capabilities = result['capabilities'] as Record<string, unknown>
      expect(Object.keys(capabilities)).toEqual(expect.arrayContaining(['tools', 'prompts', 'resources']))
      expect(String(result['instructions'])).toContain('llm_memory_recall')
    } finally {
      harness.service.close()
    }
  })

  it('negotiates down for an older client', async () => {
    const harness = setup()
    try {
      const result = (await call(harness, 'initialize', { protocolVersion: '2025-06-18' }))?.result as Record<string, unknown>
      expect(result['protocolVersion']).toBe('2025-06-18')
    } finally {
      harness.service.close()
    }
  })
})

describe('tools', () => {
  it('lists the semantic tools with JSON schemas and keeps delete on stdio', async () => {
    const harness = setup()
    try {
      const result = (await call(harness, 'tools/list'))?.result as { tools: { name: string; description: string; inputSchema: Record<string, unknown> }[] }
      const names = result.tools.map(tool => tool.name)
      expect(names).toEqual(
        expect.arrayContaining([
          'llm_memory_recall',
          'llm_memory_save',
          'llm_memory_forget',
          'llm_memory_status',
          'llm_memory_lint',
          'llm_memory_graph',
          'llm_memory_backup',
        ]),
      )
      expect(names).toContain('llm_memory_delete')
      const save = result.tools.find(tool => tool.name === 'llm_memory_save')!
      expect(save.description).toMatch(/durable/i)
      const schema = save.inputSchema as { type: string; properties: Record<string, Record<string, unknown>>; required: string[] }
      expect(schema.type).toBe('object')
      expect(schema.properties['text']?.['type']).toBe('string')
      expect(schema.required).toContain('text')
      expect(schema.required).not.toContain('title')
    } finally {
      harness.service.close()
    }
  })

  it('hides delete over HTTP unless it was allowed explicitly', async () => {
    const harness = setup()
    try {
      const overHttp = (await call(harness, 'tools/list', {}, 'http'))?.result as { tools: { name: string }[] }
      expect(overHttp.tools.map(tool => tool.name)).not.toContain('llm_memory_delete')
      const denied = await callTool(harness, 'llm_memory_delete', { id: 'm_x' }, 'http')
      expect(denied.isError).toBe(true)
      expect(denied.text).toMatch(/not available over HTTP|allow-delete/i)
    } finally {
      harness.service.close()
    }
  })

  it('saves and recalls through tools/call', async () => {
    const harness = setup()
    try {
      const saved = await callTool(harness, 'llm_memory_save', { text: 'Гибридный recall', title: 'Recall', kind: 'facts' })
      expect(saved.isError).toBe(false)
      expect(saved.text).toContain('Сохранено')
      expect(saved.structured?.['title']).toBe('Recall')
      const recalled = await callTool(harness, 'llm_memory_recall', { query: 'recall' })
      expect(recalled.text).toContain('Recall')
      const status = await callTool(harness, 'llm_memory_status')
      expect(status.text).toContain('Всего: 1')
      await callTool(harness, 'llm_memory_lint')
      const graph = await callTool(harness, 'llm_memory_graph')
      expect(graph.text).toContain('Сущностей')
      await expect(callTool(harness, 'llm_memory_forget', { id: 'nope' })).resolves.toMatchObject({ isError: false })
    } finally {
      harness.service.close()
    }
  })

  it('reports an unknown tool as an invalid-params error', async () => {
    const harness = setup()
    try {
      const response = await call(harness, 'tools/call', { name: 'nope', arguments: {} })
      expect(response?.error?.code).toBe(-32602)
    } finally {
      harness.service.close()
    }
  })

  it('scopes project entries by the project argument', async () => {
    const harness = setup()
    try {
      await callTool(harness, 'llm_memory_save', { text: 'alpha fact', scope: 'project', project: 'alpha', title: 'alpha' })
      await callTool(harness, 'llm_memory_save', { text: 'beta fact', scope: 'project', project: 'beta', title: 'beta' })
      const recalled = await callTool(harness, 'llm_memory_recall', { query: '', scope: 'project', project: 'alpha' })
      expect(recalled.text).toContain('alpha')
      expect(recalled.text).not.toContain('beta')
    } finally {
      harness.service.close()
    }
  })
})

describe('prompt and resource', () => {
  it('serves the memory guide as a prompt', async () => {
    const harness = setup()
    try {
      const list = (await call(harness, 'prompts/list'))?.result as { prompts: { name: string; description: string }[] }
      expect(list.prompts.map(prompt => prompt.name)).toContain('memory-guide')
      const got = (await call(harness, 'prompts/get', { name: 'memory-guide' }))?.result as { messages: { role: string; content: { type: string; text: string } }[] }
      expect(got.messages[0]?.role).toBe('user')
      expect(got.messages[0]?.content.text).toContain('llm_memory_save')
    } finally {
      harness.service.close()
    }
  })

  it('serves the guide as memory://guide', async () => {
    const harness = setup()
    try {
      const list = (await call(harness, 'resources/list'))?.result as { resources: { uri: string; mimeType: string }[] }
      expect(list.resources.map(resource => resource.uri)).toContain('memory://guide')
      const read = (await call(harness, 'resources/read', { uri: 'memory://guide' }))?.result as { contents: { uri: string; mimeType: string; text: string }[] }
      expect(read.contents[0]?.mimeType).toBe('text/markdown')
      expect(read.contents[0]?.text).toContain('llm_memory_recall')
      const unknown = await call(harness, 'resources/read', { uri: 'memory://nope' })
      expect(unknown?.error?.code).toBe(-32602)
    } finally {
      harness.service.close()
    }
  })
})

describe('limits', () => {
  it('rejects a request over the input ceiling', async () => {
    const harness = setup({ limits: { maxRequestBytes: 512 } })
    try {
      const response = await harness.server.dispatch({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'llm_memory_save', arguments: { text: 'x'.repeat(600) } } }, { transport: 'stdio' })
      expect(response?.error?.code).toBe(-32600)
      expect(response?.error?.message).toMatch(/limit/i)
    } finally {
      harness.service.close()
    }
  })

  it('refuses an entry over the write ceiling without touching the store', async () => {
    const harness = setup({ limits: { maxEntryBytes: 32 } })
    try {
      const result = await callTool(harness, 'llm_memory_save', { text: 'y'.repeat(64) })
      expect(result.isError).toBe(true)
      expect(result.text).toMatch(/limit/i)
      const status = await callTool(harness, 'llm_memory_status')
      expect(status.text).toContain('Всего: 0')
    } finally {
      harness.service.close()
    }
  })

  it('truncates a tool result over the response ceiling', async () => {
    const harness = setup({ limits: { maxResponseBytes: 160 } })
    try {
      await callTool(harness, 'llm_memory_save', { text: 'z'.repeat(120), title: 'long entry ' + 'q'.repeat(80) })
      const recalled = await callTool(harness, 'llm_memory_recall', { query: '' })
      expect(recalled.text.length).toBeLessThanOrEqual(160)
      expect(recalled.text.toLowerCase()).toContain('truncated')
    } finally {
      harness.service.close()
    }
  })
})
