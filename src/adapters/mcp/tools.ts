/**
 * MCP tool surface: the shared `llm_memory_*` semantics plus JSON Schema.
 *
 * The shared descriptors in core stay SDK-free; this module adds what MCP
 * needs: JSON Schema input schemas, the optional `project` argument for
 * project-scope entries, structured content where a client can use it, the
 * delete policy per transport and the conservative limits (plan §15.4/15.7).
 *
 * @module dsh-llm-memory/adapters/mcp/tools
 */
import {
  createMemoryTools,
  MEMORY_TOOL_NAMES,
  type ToolArg,
} from '../../core/application/tools.js'
import type { MemoryService } from '../../core/application/memory-service.js'
import type { MemoryKind, MemoryTier } from '../../core/domain/types.js'
import type { RouterContext } from './protocol.js'
import { llmMemoryBackupTool } from './backup-tool.js'
import type { McpLimits } from './config.js'

export type JsonSchema = Record<string, unknown>

export interface McpToolDefinition {
  name: string
  description: string
  inputSchema: JsonSchema
}

export interface McpToolCallResult {
  content: { type: 'text'; text: string }[]
  structuredContent?: unknown
  isError?: boolean
}

export interface McpToolEntry {
  readonly definition: McpToolDefinition
  execute(args: Record<string, unknown>, context: RouterContext): Promise<McpToolCallResult>
}

export interface McpToolSet {
  /** Deterministic list for `tools/list` (plan: stable order for client caching). */
  list(context: RouterContext): McpToolDefinition[]
  get(name: string): McpToolEntry | undefined
}

export interface McpToolsOptions {
  service: MemoryService
  limits: McpLimits
  /** `llm_memory_delete` is always allowed on stdio and opt-in on HTTP. */
  canDelete(context: RouterContext): boolean
}

const TRUNCATION_MARKER = '\n…[truncated: response limit]'

function bytes(text: string): number {
  return Buffer.byteLength(text, 'utf8')
}

/** Cut a rendered result to the byte ceiling, keeping the marker inside it. */
function truncate(text: string, limit: number): string {
  if (bytes(text) <= limit) return text
  const budget = Math.max(0, limit - bytes(TRUNCATION_MARKER))
  let slice = text
  while (slice.length > 0 && bytes(slice) > budget) slice = slice.slice(0, -16)
  return `${slice}${TRUNCATION_MARKER}`
}

function textResult(text: string, structuredContent?: unknown): McpToolCallResult {
  return {
    content: [{ type: 'text', text }],
    ...(structuredContent !== undefined ? { structuredContent } : {}),
  }
}

function errorResult(text: string): McpToolCallResult {
  return { content: [{ type: 'text', text }], isError: true }
}

/** JSON Schema for one shared tool argument. */
export function jsonSchemaForArg(arg: ToolArg): JsonSchema {
  return {
    type: arg.type === 'array' ? 'array' : arg.type,
    ...(arg.type === 'array' ? { items: { type: 'string' } } : {}),
    ...(arg.enum ? { enum: [...arg.enum] } : {}),
    ...(arg.description ? { description: arg.description } : {}),
  }
}

/** Object schema with the required list derived from non-optional args. */
export function jsonSchemaFor(args: Record<string, ToolArg>): JsonSchema {
  const properties: Record<string, JsonSchema> = {}
  const required: string[] = []
  for (const [name, arg] of Object.entries(args)) {
    properties[name] = jsonSchemaForArg(arg)
    if (!arg.optional) required.push(name)
  }
  return { type: 'object', properties, ...(required.length > 0 ? { required } : {}) }
}

function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function projectOf(args: Record<string, unknown>): string | undefined {
  return optionalString(args, 'project')
}

/** `llm_memory_save` with the MCP project argument and structured content. */
function saveEntry(service: MemoryService, args: Record<string, unknown>, limits: McpLimits): McpToolCallResult {
  const text = typeof args['text'] === 'string' ? args['text'] : ''
  if (text.trim().length === 0) return errorResult('text is required')
  if (bytes(text) > limits.maxEntryBytes) {
    return errorResult(`entry text exceeds the ${limits.maxEntryBytes}-byte limit`)
  }
  const project = projectOf(args)
  const entry = service.save({
    text,
    ...(optionalString(args, 'title') !== undefined ? { title: args['title'] as string } : {}),
    ...(optionalString(args, 'kind') !== undefined ? { kind: args['kind'] as MemoryKind } : {}),
    ...(optionalString(args, 'tier') !== undefined ? { tier: args['tier'] as MemoryTier } : {}),
    ...(optionalString(args, 'scope') !== undefined ? { scope: args['scope'] as 'project' | 'global' } : {}),
    ...(typeof args['importance'] === 'number' ? { importance: args['importance'] } : {}),
    ...(Array.isArray(args['tags']) ? { tags: args['tags'].map(String) } : {}),
    ...(optionalString(args, 'keywords') !== undefined ? { keywords: args['keywords'] as string } : {}),
    ...(project !== undefined ? { project } : {}),
  })
  return textResult(`Сохранено: ${entry.id} — ${entry.title}`, {
    id: entry.id,
    title: entry.title,
    kind: entry.kind,
    tier: entry.tier,
    scope: entry.scope,
    project: entry.project,
    importance: entry.importance,
  })
}

/** Build the whole MCP tool surface over one service. */
export function createMcpTools(options: McpToolsOptions): McpToolSet {
  const { service, limits, canDelete } = options
  const shared = createMemoryTools(service)
  const entries = new Map<string, McpToolEntry>()

  for (const name of MEMORY_TOOL_NAMES) {
    const tool = shared[name]
    if (!tool) continue
    if (name === 'llm_memory_save') {
      entries.set(name, {
        definition: { name, description: tool.description, inputSchema: jsonSchemaFor(tool.args) },
        execute: async args => saveEntry(service, args, limits),
      })
      continue
    }
    entries.set(name, {
      definition: { name, description: tool.description, inputSchema: jsonSchemaFor(tool.args) },
      execute: async (args, context) => {
        if (name === 'llm_memory_delete' && !canDelete(context)) {
          return errorResult('llm_memory_delete is not available over HTTP; start the server with --allow-delete')
        }
        try {
          const text = await tool.execute(args)
          const structured =
            name === 'llm_memory_status' ? service.status(projectOf(args)) : undefined
          return textResult(truncate(text, limits.maxResponseBytes), structured)
        } catch (error) {
          return errorResult(error instanceof Error ? error.message : String(error))
        }
      },
    })
  }

  const backup = llmMemoryBackupTool(() => ({ ...service.backupTarget(), harness: service.harness }))
  entries.set('llm_memory_backup', {
    definition: { name: 'llm_memory_backup', description: backup.description, inputSchema: jsonSchemaFor(backup.args) },
    execute: async args => {
      try {
        return textResult(truncate(await backup.execute(args), limits.maxResponseBytes))
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error))
      }
    },
  })

  return {
    list(context) {
      const visible = [...entries.values()].filter(
        entry => entry.definition.name !== 'llm_memory_delete' || canDelete(context),
      )
      return visible.map(entry => entry.definition)
    },
    get(name) {
      return entries.get(name)
    },
  }
}
