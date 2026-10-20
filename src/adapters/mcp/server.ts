/**
 * MCP server core: methods, capabilities, prompt and resource over one service.
 *
 * Transports (stdio, Streamable HTTP) only move bytes; every method lives here,
 * so both transports return the same answers. The server is stateless between
 * calls: MCP has no session and the store already carries all state.
 *
 * @module dsh-llm-memory/adapters/mcp/server
 */
import {
  JSON_RPC_ERRORS,
  JsonRpcRouter,
  McpError,
  messageId,
  negotiateProtocolVersion,
  PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
  type JsonRpcHandler,
  type JsonRpcResponse,
  type RouterContext,
} from './protocol.js'
import { MCP_GUIDE, MCP_GUIDE_PROMPT, MCP_GUIDE_RESOURCE } from './guide.js'
import { createMcpTools, type McpToolSet } from './tools.js'
import type { MemoryService } from '../../core/application/memory-service.js'
import type { McpConfig, McpLimits } from './config.js'

export const MCP_SERVER_NAME = 'llm-memory-mcp'

declare const __LLM_MEMORY_VERSION__: string | undefined

/** Version reported in `serverInfo`; replaced at build time from package.json. */
export const MCP_SERVER_VERSION =
  typeof __LLM_MEMORY_VERSION__ === 'string' && __LLM_MEMORY_VERSION__.length > 0 ? __LLM_MEMORY_VERSION__ : '0.0.0-dev'

export interface McpServerOptions {
  service: MemoryService
  config: McpConfig
  /** HTTP delete switch; stdio always allows delete (plan §15.7). */
  allowDelete?: boolean
  /** Ceilings; defaults to `config.mcp.limits`. */
  limits?: McpLimits
}

const CAPABILITIES = {
  tools: { listChanged: false },
  prompts: { listChanged: false },
  resources: { subscribe: false, listChanged: false },
} as const

export class McpServer {
  readonly router: JsonRpcRouter
  private readonly limits: McpLimits
  private readonly tools: McpToolSet

  constructor(options: McpServerOptions) {
    this.limits = options.limits ?? options.config.mcp.limits
    this.tools = createMcpTools({
      service: options.service,
      limits: this.limits,
      canDelete: context => context.transport === 'stdio' || options.allowDelete === true,
    })

    const methods: Record<string, JsonRpcHandler> = {
      initialize: params => ({
        protocolVersion: negotiateProtocolVersion(params['protocolVersion']),
        capabilities: CAPABILITIES,
        serverInfo: { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
        instructions: MCP_GUIDE,
      }),
      'notifications/initialized': () => ({}),
      ping: () => ({}),
      'tools/list': (_params, context) => ({ tools: this.tools.list(context) }),
      'tools/call': async (params, context) => {
        const name = typeof params['name'] === 'string' ? params['name'] : ''
        const entry = this.tools.get(name)
        if (!entry) throw new McpError(JSON_RPC_ERRORS.invalidParams, `unknown tool: ${name}`)
        const raw = params['arguments']
        if (raw !== undefined && (typeof raw !== 'object' || raw === null || Array.isArray(raw))) {
          throw new McpError(JSON_RPC_ERRORS.invalidParams, 'arguments must be an object')
        }
        return entry.execute((raw ?? {}) as Record<string, unknown>, context)
      },
      'prompts/list': () => ({
        prompts: [
          {
            name: MCP_GUIDE_PROMPT,
            title: 'LLM Memory guide',
            description: 'How to recall and store durable knowledge with llm_memory_* tools.',
            arguments: [],
          },
        ],
      }),
      'prompts/get': params => {
        const name = typeof params['name'] === 'string' ? params['name'] : ''
        if (name !== MCP_GUIDE_PROMPT) throw new McpError(JSON_RPC_ERRORS.invalidParams, `unknown prompt: ${name}`)
        return {
          description: 'How to recall and store durable knowledge with llm_memory_* tools.',
          messages: [{ role: 'user', content: { type: 'text', text: MCP_GUIDE } }],
        }
      },
      'resources/list': () => ({
        resources: [
          {
            uri: MCP_GUIDE_RESOURCE,
            name: 'Memory guide',
            description: 'The same guide as the memory-guide prompt, as markdown.',
            mimeType: 'text/markdown',
          },
        ],
      }),
      'resources/read': params => {
        const uri = typeof params['uri'] === 'string' ? params['uri'] : ''
        if (uri !== MCP_GUIDE_RESOURCE) throw new McpError(JSON_RPC_ERRORS.invalidParams, `unknown resource: ${uri}`)
        return { contents: [{ uri, mimeType: 'text/markdown', text: MCP_GUIDE }] }
      },
      'resources/templates/list': () => ({ resourceTemplates: [] }),
      'logging/setLevel': () => ({}),
      'completion/complete': () => ({ completion: { values: [], hasMore: false } }),
    }

    this.router = new JsonRpcRouter({
      methods,
      onNotificationError: (error, method) => {
        // Notifications cannot be answered; the transport logs this on stderr.
        process.stderr.write(`[llm-memory-mcp] notification ${method} failed: ${String(error)}\n`)
      },
    })
  }

  /** Supported revisions, newest first (used by the HTTP layer). */
  get supportedVersions(): readonly string[] {
    return SUPPORTED_PROTOCOL_VERSIONS
  }

  get protocolVersion(): string {
    return PROTOCOL_VERSION
  }

  /** Dispatch one message, enforcing the input ceiling before routing. */
  async dispatch(input: unknown, context: RouterContext): Promise<JsonRpcResponse | null> {
    const size = bytesOf(input)
    if (size > this.limits.maxRequestBytes) {
      return {
        jsonrpc: '2.0',
        id: messageId(input),
        error: {
          code: JSON_RPC_ERRORS.invalidRequest,
          message: `request exceeds the ${this.limits.maxRequestBytes}-byte limit`,
        },
      }
    }
    return this.router.dispatch(input, context)
  }
}

function bytesOf(input: unknown): number {
  if (typeof input === 'string') return Buffer.byteLength(input, 'utf8')
  try {
    return Buffer.byteLength(JSON.stringify(input), 'utf8')
  } catch {
    return 0
  }
}
