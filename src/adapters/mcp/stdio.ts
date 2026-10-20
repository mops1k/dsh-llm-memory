/**
 * stdio transport: newline-delimited JSON-RPC on stdin/stdout.
 *
 * stdout carries protocol messages only — anything informational goes to
 * stderr, because the client parses stdout. Requests are processed in order, and
 * EOF on stdin ends the session (the CLI then closes the store).
 *
 * @module dsh-llm-memory/adapters/mcp/stdio
 */
import { createInterface } from 'node:readline'
import type { Readable, Writable } from 'node:stream'

import type { McpServer } from './server.js'

export interface StdioTransportOptions {
  server: McpServer
  /** Defaults to `process.stdin`. */
  input?: Readable
  /** Defaults to `process.stdout`. */
  output?: Writable
  /** Diagnostic sink; defaults to `process.stderr`. */
  log?: (line: string) => void
}

export interface StdioTransportHandle {
  /** Resolves when the input side ends or `close()` is called. */
  readonly closed: Promise<void>
  close(): void
}

export function startStdioTransport(options: StdioTransportOptions): StdioTransportHandle {
  const input = options.input ?? process.stdin
  const output = options.output ?? process.stdout
  const log = options.log ?? ((line: string): void => void process.stderr.write(`${line}\n`))
  const reader = createInterface({ input, crlfDelay: Infinity, terminal: false })

  let resolveClosed: (() => void) | undefined
  const closed = new Promise<void>(resolve => {
    resolveClosed = resolve
  })

  let chain: Promise<void> = Promise.resolve()
  reader.on('line', (line: string) => {
    const message = line.trim()
    if (message.length === 0) return
    chain = chain
      .then(async () => {
        const response = await options.server.dispatch(message, { transport: 'stdio' })
        if (response) output.write(`${JSON.stringify(response)}\n`)
      })
      .catch(error => {
        log(`[llm-memory-mcp] stdio error: ${error instanceof Error ? error.message : String(error)}`)
      })
  })
  reader.on('close', () => resolveClosed?.())

  return {
    closed,
    close: () => reader.close(),
  }
}
