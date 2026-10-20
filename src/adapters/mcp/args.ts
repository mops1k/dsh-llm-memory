/**
 * CLI arguments of `llm-memory-mcp` (plan §15.3).
 *
 * Parsing is separated from the wiring so the flags stay testable without
 * starting transports or opening a store.
 *
 * @module dsh-llm-memory/adapters/mcp/args
 */

export interface McpCliOptions {
  clientId?: string
  storageRoot?: string
  transport?: 'stdio' | 'http'
  host?: string
  port?: number
  token?: string
  allowDelete?: boolean
  allowExternalBind?: boolean
  projectRoot?: string
  projectKey?: string
  configPath?: string
  /** Web UI (8789) on/off; on by default. */
  ui?: boolean
  help?: boolean
  version?: boolean
}

const VALUE_FLAGS = {
  '--client-id': 'clientId',
  '--storage-root': 'storageRoot',
  '--transport': 'transport',
  '--host': 'host',
  '--port': 'port',
  '--token': 'token',
  '--project-root': 'projectRoot',
  '--project-key': 'projectKey',
  '--config': 'configPath',
} as const

type ValueFlag = keyof typeof VALUE_FLAGS

function parsePort(raw: string): number {
  const port = Number(raw)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`invalid --port value: ${raw}`)
  return port
}

function parseTransport(raw: string): 'stdio' | 'http' {
  if (raw !== 'stdio' && raw !== 'http') throw new Error(`invalid --transport value: ${raw} (expected stdio or http)`)
  return raw
}

/** Parse argv (without `node` and the script) into options. */
export function parseMcpArgs(argv: readonly string[]): McpCliOptions {
  const options: McpCliOptions = { ui: true }
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? ''
    if (token === '--ui') {
      options.ui = true
      continue
    }
    if (token === '--no-ui') {
      options.ui = false
      continue
    }
    if (token === '--allow-delete') {
      options.allowDelete = true
      continue
    }
    if (token === '--allow-external-bind') {
      options.allowExternalBind = true
      continue
    }
    if (token === '--help' || token === '-h') {
      options.help = true
      continue
    }
    if (token === '--version' || token === '-v') {
      options.version = true
      continue
    }

    const equals = token.startsWith('--') ? token.indexOf('=') : -1
    const flag = equals > 0 ? token.slice(0, equals) : token
    if (!(flag in VALUE_FLAGS)) throw new Error(`unknown argument: ${flag}`)
    const value = equals > 0 ? token.slice(equals + 1) : argv[++index]
    if (value === undefined || value.length === 0) throw new Error(`missing value for ${flag}`)
    const key = VALUE_FLAGS[flag as ValueFlag]
    if (key === 'port') options.port = parsePort(value)
    else if (key === 'transport') options.transport = parseTransport(value)
    else options[key] = value
  }
  return options
}
