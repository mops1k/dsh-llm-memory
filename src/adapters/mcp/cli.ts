/**
 * `llm-memory-mcp` entry point: wiring, transports and shutdown.
 *
 * Flags come from `args.ts`, environment fallbacks from `LLM_MEMORY_MCP_*`, and
 * everything persistent lives in the per-client store. One process = one client
 * id = one store (plan §15.2): the CLI never opens another harness's memory.
 *
 * @module dsh-llm-memory/adapters/mcp/cli
 */
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'

import { parseMcpArgs, type McpCliOptions } from './args.js'
import {
  loadMcpConfig,
  mcpConfigPath,
  resolveMcpConfig,
  resolveMcpStoreRoot,
  saveMcpConfig,
  type McpConfig,
} from './config.js'
import { startHttpTransport } from './http.js'
import { startMcpWebServer } from './panel.js'
import { MCP_SERVER_NAME, MCP_SERVER_VERSION, McpServer } from './server.js'
import { McpService } from './service.js'
import { startStdioTransport } from './stdio.js'

const USAGE = `llm-memory-mcp ${MCP_SERVER_VERSION} — long-term memory for MCP clients

Usage: llm-memory-mcp --client-id <id> [options]

Options:
  --transport stdio|http     Transport (default: stdio)
  --client-id <id>           Client id that owns the store (required)
  --storage-root <path>      Store root (default: ~/.llm-memory/mcp/<client-id>)
  --project-root <path>      Project root the server works for (default: cwd)
  --project-key <key>        Explicit project key
  --host <host>              HTTP host (default: 127.0.0.1)
  --port <port>              HTTP port (default: 8790)
  --token <token>            Bearer token for HTTP (required there)
  --allow-delete             Allow llm_memory_delete over HTTP
  --allow-external-bind      Bind beyond loopback
  --config <path>            Config file (default: <store>/config.json)
  --ui / --no-ui             Web panel on 8789 (default: on)
  --help, --version

Environment: LLM_MEMORY_MCP_CLIENT_ID, _STORAGE_ROOT, _TRANSPORT, _HOST, _PORT,
_TOKEN, _PROJECT_ROOT, _PROJECT_KEY, _ALLOW_DELETE, _ALLOW_EXTERNAL_BIND, _UI.
`

export interface McpRuntime {
  config: McpConfig
  clientId: string
  storeRoot: string
}

function envValue(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = (env[key] ?? '').trim()
  return value.length > 0 ? value : undefined
}

function envFlag(env: NodeJS.ProcessEnv, key: string): boolean | undefined {
  const value = envValue(env, key)?.toLowerCase()
  if (value === undefined) return undefined
  return value === '1' || value === 'true' || value === 'yes'
}

function envTransport(env: NodeJS.ProcessEnv): 'stdio' | 'http' | undefined {
  const value = envValue(env, 'LLM_MEMORY_MCP_TRANSPORT')
  if (value === undefined) return undefined
  if (value !== 'stdio' && value !== 'http') {
    throw new Error(`invalid LLM_MEMORY_MCP_TRANSPORT: ${value} (expected stdio or http)`)
  }
  return value
}

function envPort(env: NodeJS.ProcessEnv): number | undefined {
  const value = envValue(env, 'LLM_MEMORY_MCP_PORT')
  if (value === undefined) return undefined
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`invalid LLM_MEMORY_MCP_PORT: ${value}`)
  return port
}

function readConfigFile(path: string): McpConfig | null {
  if (!existsSync(path)) return null
  return resolveMcpConfig(JSON.parse(readFileSync(path, 'utf8')) as unknown)
}

/**
 * Merge flags, environment and the stored config into one runtime description.
 * The client id is mandatory because it names the store; a `--config` file may
 * provide it for clients that cannot pass both.
 */
export function resolveMcpRuntime(options: McpCliOptions, env: NodeJS.ProcessEnv = process.env, home: string = homedir()): McpRuntime {
  const configPath = options.configPath ?? envValue(env, 'LLM_MEMORY_MCP_CONFIG')
  const external = configPath ? readConfigFile(configPath) : null
  const clientId = (options.clientId ?? envValue(env, 'LLM_MEMORY_MCP_CLIENT_ID') ?? external?.mcp.clientId ?? '').trim()
  if (clientId.length === 0) {
    throw new Error('MCP client id is required: pass --client-id or set LLM_MEMORY_MCP_CLIENT_ID')
  }
  const storageRoot = options.storageRoot ?? envValue(env, 'LLM_MEMORY_MCP_STORAGE_ROOT') ?? (external ? external.memory.storageRoot : undefined)
  const storeRoot = resolveMcpStoreRoot({ clientId, home, ...(storageRoot !== undefined && storageRoot.trim().length > 0 ? { storageRoot } : {}) })
  const config = external ?? loadMcpConfig(storeRoot)
  config.mcp = {
    ...config.mcp,
    clientId,
    transport: options.transport ?? envTransport(env) ?? config.mcp.transport,
    host: options.host ?? envValue(env, 'LLM_MEMORY_MCP_HOST') ?? config.mcp.host,
    port: options.port ?? envPort(env) ?? config.mcp.port,
    token: options.token ?? envValue(env, 'LLM_MEMORY_MCP_TOKEN') ?? config.mcp.token,
    allowDelete: options.allowDelete ?? envFlag(env, 'LLM_MEMORY_MCP_ALLOW_DELETE') ?? config.mcp.allowDelete,
    allowExternalBind:
      options.allowExternalBind ?? envFlag(env, 'LLM_MEMORY_MCP_ALLOW_EXTERNAL_BIND') ?? config.mcp.allowExternalBind,
  }
  return { config, clientId, storeRoot }
}

function log(line: string): void {
  process.stderr.write(`[llm-memory-mcp] ${line}\n`)
}

/** Run the server; resolves with the process exit code. */
export async function main(argv: readonly string[] = process.argv.slice(2), env: NodeJS.ProcessEnv = process.env): Promise<number> {
  let options: McpCliOptions
  try {
    options = parseMcpArgs(argv)
  } catch (error) {
    process.stderr.write(`[llm-memory-mcp] ${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`)
    return 2
  }
  if (options.help) {
    process.stdout.write(USAGE)
    return 0
  }
  if (options.version) {
    process.stdout.write(`${MCP_SERVER_NAME} ${MCP_SERVER_VERSION}\n`)
    return 0
  }

  let runtime: McpRuntime
  try {
    runtime = resolveMcpRuntime(options, env)
  } catch (error) {
    process.stderr.write(`[llm-memory-mcp] ${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }

  const { config, clientId, storeRoot } = runtime
  const service = new McpService({
    config,
    clientId,
    storageRoot: storeRoot,
    projectRoot: options.projectRoot ?? envValue(env, 'LLM_MEMORY_MCP_PROJECT_ROOT'),
    ...(options.projectKey !== undefined ? { projectKey: options.projectKey } : {}),
  })
  service.init()
  const server = new McpServer({ service, config, allowDelete: config.mcp.allowDelete, limits: config.mcp.limits })

  const uiEnabled = (options.ui ?? envFlag(env, 'LLM_MEMORY_MCP_UI') ?? true) && config.web.enabled
  const panel = uiEnabled
    ? await startMcpWebServer({
        service,
        config,
        port: config.web.port,
        saveConfig: next => saveMcpConfig(storeRoot, next),
      })
    : null
  if (panel?.url) log(`web panel on ${panel.url} (config ${mcpConfigPath(storeRoot)})`)
  else if (panel?.disabledReason) log(`web panel disabled: ${panel.disabledReason}`)

  try {
    if (config.mcp.transport === 'http') {
      const http = await startHttpTransport({
        server,
        token: config.mcp.token,
        host: config.mcp.host,
        port: config.mcp.port,
        allowExternalBind: config.mcp.allowExternalBind,
        limits: config.mcp.limits,
      })
      if (http.url === null) throw new Error(http.disabledReason ?? 'HTTP transport could not start')
      log(`MCP HTTP listening on ${http.url}`)
      await new Promise<void>(resolve => {
        process.once('SIGINT', resolve)
        process.once('SIGTERM', resolve)
      })
      await http.close()
    } else {
      log(`MCP stdio ready (client ${clientId}, store ${storeRoot})`)
      const stdio = startStdioTransport({ server })
      await stdio.closed
    }
    return 0
  } catch (error) {
    log(error instanceof Error ? error.message : String(error))
    return 1
  } finally {
    await panel?.close()
    service.close()
  }
}

const isMain = (() => {
  const entry = process.argv[1]
  if (entry === undefined) return false
  try {
    return import.meta.url === pathToFileURL(entry).href
  } catch {
    return false
  }
})()

if (isMain) {
  process.exitCode = await main()
}
