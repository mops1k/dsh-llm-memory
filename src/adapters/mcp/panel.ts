/**
 * MCP web panel: the shared design page and compatibility JSON API on 8789.
 *
 * The page and the API are the same as Kilo/OpenCode (ADR-004); only the host
 * wiring differs, so the MCP host gets full settings and backups without a
 * second UI. A busy port disables just the panel, never the MCP transport.
 *
 * @module dsh-llm-memory/adapters/mcp/panel
 */
import { embeddedLegacyHtml } from '../panel/web-bundle.js'
import { startPanelServer, type PanelHandle } from '../panel/server.js'
import type { HarnessConfig } from '../../core/domain/harness-config.js'
import type { McpConfig } from './config.js'
import type { McpService } from './service.js'

const MCP_PANEL = { kind: 'mcp' as const, apiBase: '/api/legacy', locale: 'en' as const }

export interface McpWebServerOptions {
  service: McpService
  config: McpConfig
  host?: string
  port?: number
  /** Persist the config after a panel change (the CLI writes `<store>/config.json`). */
  saveConfig?: (config: McpConfig) => void
}

export async function startMcpWebServer(options: McpWebServerOptions): Promise<PanelHandle> {
  const config = options.config
  const onSave = options.saveConfig
  const saveConfig = onSave
    ? (next: HarnessConfig): void => {
        // The panel hands back the shared sections; the MCP transport block stays
        // ours so a settings change cannot drop the client id or limits.
        onSave({ ...(next as McpConfig), mcp: config.mcp })
      }
    : undefined
  return startPanelServer({
    service: options.service,
    config,
    panel: MCP_PANEL,
    html: embeddedLegacyHtml,
    ...(options.host !== undefined ? { host: options.host } : {}),
    ...(options.port !== undefined ? { port: options.port } : {}),
    ...(saveConfig ? { saveConfig } : {}),
  })
}
