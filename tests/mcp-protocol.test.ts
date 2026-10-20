/**
 * MCP protocol layer: JSON-RPC 2.0 envelope handling and version negotiation.
 *
 * The transport tests cover byte framing; this file covers exactly the rules
 * the MCP revision 2025-11-25 puts on the envelope: a request is answered under
 * its own id, a notification gets no response, a malformed message never
 * crashes the server, and an unsupported protocol version is answered with a
 * version the server does support.
 */
import { describe, expect, it } from 'vitest'

import {
  JSON_RPC_ERRORS,
  JsonRpcRouter,
  McpError,
  PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
  negotiateProtocolVersion,
  parseMessage,
} from '@llm-memory/adapter/mcp/protocol'

describe('protocol version negotiation', () => {
  it('echoes a version it supports', () => {
    expect(negotiateProtocolVersion('2025-06-18')).toBe('2025-06-18')
    expect(negotiateProtocolVersion('2025-03-26')).toBe('2025-03-26')
  })

  it('falls back to the latest supported version for an unknown one', () => {
    expect(negotiateProtocolVersion('2026-07-28')).toBe(PROTOCOL_VERSION)
    expect(negotiateProtocolVersion(undefined)).toBe(PROTOCOL_VERSION)
  })

  it('advertises a list that starts with the current revision', () => {
    expect(SUPPORTED_PROTOCOL_VERSIONS[0]).toBe(PROTOCOL_VERSION)
    expect(SUPPORTED_PROTOCOL_VERSIONS).toContain('2025-06-18')
  })
})

describe('parseMessage', () => {
  it('parses a request', () => {
    const message = parseMessage('{"jsonrpc":"2.0","id":1,"method":"tools/list"}')
    expect(message.method).toBe('tools/list')
    expect(message.id).toBe(1)
  })

  it('throws a parse error on invalid JSON', () => {
    expect(() => parseMessage('{')).toThrowError()
    try {
      parseMessage('{')
    } catch (error) {
      expect((error as McpError).code).toBe(JSON_RPC_ERRORS.parseError)
    }
  })

  it('throws an invalid-request error on a non-object payload', () => {
    try {
      parseMessage('[]')
    } catch (error) {
      expect((error as McpError).code).toBe(JSON_RPC_ERRORS.invalidRequest)
    }
    expect(() => parseMessage('"text"')).toThrowError()
  })
})

describe('JsonRpcRouter', () => {
  const router = new JsonRpcRouter({
    methods: {
      'demo/echo': params => params,
      'demo/context': (params, context) => ({ params, transport: context.transport }),
      'demo/fail': () => {
        throw new McpError(JSON_RPC_ERRORS.invalidParams, 'bad params')
      },
      'demo/boom': () => {
        throw new Error('boom')
      },
    },
  })

  it('answers a request under the same id', async () => {
    await expect(router.dispatch({ jsonrpc: '2.0', id: 7, method: 'demo/echo', params: { a: 1 } }, { transport: 'stdio' })).resolves.toEqual({
      jsonrpc: '2.0',
      id: 7,
      result: { a: 1 },
    })
  })

  it('passes the transport down to a handler', async () => {
    const response = await router.dispatch({ jsonrpc: '2.0', id: 'x', method: 'demo/context', params: {} }, { transport: 'http' })
    expect(response?.result).toEqual({ params: {}, transport: 'http' })
  })

  it('returns null for a notification and still runs it', async () => {
    let seen = false
    const notifying = new JsonRpcRouter({
      methods: {
        'demo/note': () => {
          seen = true
        },
      },
    })
    await expect(notifying.dispatch({ jsonrpc: '2.0', method: 'demo/note' }, { transport: 'stdio' })).resolves.toBeNull()
    expect(seen).toBe(true)
  })

  it('rejects a malformed envelope with the id it could recover', async () => {
    const response = await router.dispatch({ id: 3, method: 'demo/echo' }, { transport: 'stdio' })
    expect(response).toEqual({
      jsonrpc: '2.0',
      id: 3,
      error: { code: JSON_RPC_ERRORS.invalidRequest, message: expect.any(String) },
    })
  })

  it('answers unparseable text with a parse error and a null id', async () => {
    const response = await router.dispatch('garbage', { transport: 'stdio' })
    expect(response).toMatchObject({ jsonrpc: '2.0', id: null, error: { code: JSON_RPC_ERRORS.parseError } })
  })

  it('reports an unknown method', async () => {
    const response = await router.dispatch({ jsonrpc: '2.0', id: 1, method: 'nope/nothing' }, { transport: 'stdio' })
    expect(response).toMatchObject({ id: 1, error: { code: JSON_RPC_ERRORS.methodNotFound } })
  })

  it('rejects params that are not an object', async () => {
    const response = await router.dispatch({ jsonrpc: '2.0', id: 1, method: 'demo/echo', params: [1, 2] }, { transport: 'stdio' })
    expect(response).toMatchObject({ id: 1, error: { code: JSON_RPC_ERRORS.invalidParams } })
  })

  it('keeps an expected McpError code and message', async () => {
    const response = await router.dispatch({ jsonrpc: '2.0', id: 1, method: 'demo/fail' }, { transport: 'stdio' })
    expect(response).toMatchObject({ error: { code: JSON_RPC_ERRORS.invalidParams, message: 'bad params' } })
  })

  it('wraps an unexpected throw as an internal error without leaking the stack', async () => {
    const response = await router.dispatch({ jsonrpc: '2.0', id: 1, method: 'demo/boom' }, { transport: 'stdio' })
    expect(response).toMatchObject({ error: { code: JSON_RPC_ERRORS.internalError } })
    expect(JSON.stringify(response)).not.toContain('    at ')
  })

  it('does not answer a notification that throws', async () => {
    const notifying = new JsonRpcRouter({ methods: { 'demo/note': () => Promise.reject(new Error('boom')) } })
    await expect(notifying.dispatch({ jsonrpc: '2.0', method: 'demo/note' }, { transport: 'stdio' })).resolves.toBeNull()
  })
})
