/**
 * MCP protocol layer: JSON-RPC 2.0 envelope handling for revision 2025-11-25.
 *
 * The server speaks the revision the current `@modelcontextprotocol/sdk`
 * implements (`LATEST_PROTOCOL_VERSION = 2025-11-25`) and negotiates down to
 * the two earlier Streamable-HTTP revisions during `initialize`. The protocol
 * is implemented here instead of pulling the SDK in: the surface this server
 * needs (initialize, tools, prompts, resources) is small, and the adapter stays
 * dependency-free like the panel hosts.
 *
 * @module dsh-llm-memory/adapters/mcp/protocol
 */

/** Revision this server implements; the first entry of the supported list. */
export const PROTOCOL_VERSION = '2025-11-25'

/** Revisions offered to a client during `initialize`, newest first. */
export const SUPPORTED_PROTOCOL_VERSIONS: readonly string[] = [PROTOCOL_VERSION, '2025-06-18', '2025-03-26']

/** JSON-RPC 2.0 error codes plus the MCP-defined ones this server returns. */
export const JSON_RPC_ERRORS = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
} as const

export type JsonRpcId = string | number | null

export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: JsonRpcId
  method: string
  params?: Record<string, unknown>
}

export interface JsonRpcErrorBody {
  code: number
  message: string
  data?: unknown
}

export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: JsonRpcId
  result?: unknown
  error?: JsonRpcErrorBody
}

/** Transport a request arrived on: delete policy and log sinks depend on it. */
export type TransportKind = 'stdio' | 'http'

export interface RouterContext {
  transport: TransportKind
}

/** An error whose code and message are safe to send back to the client. */
export class McpError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message)
    this.name = 'McpError'
  }
}

/**
 * Pick the revision to answer `initialize` with: echo the requested one when it
 * is supported, otherwise fall back to this server's latest. Per the spec the
 * client then decides whether it can continue.
 */
export function negotiateProtocolVersion(requested?: unknown): string {
  return typeof requested === 'string' && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
    ? requested
    : PROTOCOL_VERSION
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isId(value: unknown): value is JsonRpcId {
  return value === null || typeof value === 'string' || typeof value === 'number'
}

/**
 * Validate a parsed payload as a JSON-RPC request for MCP: object envelope,
 * `jsonrpc: "2.0"`, non-empty string method, an optional id and object params.
 */
function validateEnvelope(value: unknown): JsonRpcRequest {
  if (!isObject(value)) throw new McpError(JSON_RPC_ERRORS.invalidRequest, 'request must be a JSON object')
  if (value['jsonrpc'] !== '2.0') throw new McpError(JSON_RPC_ERRORS.invalidRequest, 'jsonrpc must be "2.0"')
  const method = value['method']
  if (typeof method !== 'string' || method.trim().length === 0) {
    throw new McpError(JSON_RPC_ERRORS.invalidRequest, 'method must be a non-empty string')
  }
  if (value['id'] !== undefined && !isId(value['id'])) {
    throw new McpError(JSON_RPC_ERRORS.invalidRequest, 'id must be a string, a number or null')
  }
  const params = value['params']
  if (params !== undefined && !isObject(params)) {
    throw new McpError(JSON_RPC_ERRORS.invalidParams, 'params must be an object')
  }
  return value as unknown as JsonRpcRequest
}

/** Parse one wire message; a parse failure becomes a `parseError` McpError. */
export function parseMessage(raw: string): JsonRpcRequest {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new McpError(JSON_RPC_ERRORS.parseError, 'parse error')
  }
  return validateEnvelope(parsed)
}

/** Serialize a message for the wire (ndjson on stdio, body on HTTP). */
export function serializeMessage(message: JsonRpcRequest | JsonRpcResponse): string {
  return JSON.stringify(message)
}

/** Recover the id of a malformed payload so the error can be correlated. */
export function messageId(input: unknown): JsonRpcId {
  if (isObject(input) && isId(input['id'])) return input['id']
  if (typeof input === 'string') {
    try {
      const parsed: unknown = JSON.parse(input)
      if (isObject(parsed) && isId(parsed['id'])) return parsed['id']
    } catch {
      // not JSON: no id to recover
    }
  }
  return null
}

function errorBody(error: unknown): JsonRpcErrorBody {
  if (error instanceof McpError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.data !== undefined ? { data: error.data } : {}),
    }
  }
  const detail = error instanceof Error ? error.message : String(error)
  return { code: JSON_RPC_ERRORS.internalError, message: `internal error: ${detail}` }
}

export type JsonRpcHandler = (params: Record<string, unknown>, context: RouterContext) => unknown | Promise<unknown>

export interface RouterOptions {
  /** Method name → handler. Unknown methods answer `-32601`. */
  methods: Record<string, JsonRpcHandler>
  /** Notifications cannot be answered, so handler failures end up here. */
  onNotificationError?: (error: unknown, method: string) => void
}

/**
 * Method dispatcher. It knows nothing about transports or tools: the transport
 * feeds it parsed or raw messages and writes its responses back.
 */
export class JsonRpcRouter {
  private readonly methods: Record<string, JsonRpcHandler>
  private readonly onNotificationError: ((error: unknown, method: string) => void) | undefined

  constructor(options: RouterOptions) {
    this.methods = options.methods
    this.onNotificationError = options.onNotificationError
  }

  async dispatch(input: unknown, context: RouterContext): Promise<JsonRpcResponse | null> {
    let message: JsonRpcRequest
    try {
      message = typeof input === 'string' ? parseMessage(input) : validateEnvelope(input)
    } catch (error) {
      return { jsonrpc: '2.0', id: messageId(input), error: errorBody(error) }
    }

    const notification = message.id === undefined
    try {
      const handler = this.methods[message.method]
      if (!handler) {
        throw new McpError(JSON_RPC_ERRORS.methodNotFound, `method not found: ${message.method}`)
      }
      const result = await handler(message.params ?? {}, context)
      return notification ? null : { jsonrpc: '2.0', id: message.id ?? null, result }
    } catch (error) {
      if (notification) {
        this.onNotificationError?.(error, message.method)
        return null
      }
      return { jsonrpc: '2.0', id: message.id ?? null, error: errorBody(error) }
    }
  }
}
