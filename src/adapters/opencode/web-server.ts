/**
 * OpenCode panel: the shared design page plus the compatibility JSON API over
 * OpenCodeService, on the OpenCode port (8788 by default).
 */
import { embeddedLegacyHtml } from '../panel/web-bundle.js'
import { startPanelServer, type PanelHandle } from '../panel/server.js'
import type { OpenCodeService } from './service.js'
import type { OpenCodeMemoryConfig } from './config.js'

export type OpenCodeWebHandle = PanelHandle

const OPENCODE_PANEL = { kind: 'opencode' as const, apiBase: '/api/legacy', locale: 'en' as const }

export async function startOpenCodeWebServer(options: {
  service: OpenCodeService
  config: OpenCodeMemoryConfig
  host?: string
  port?: number
  saveConfig?: (config: OpenCodeMemoryConfig) => void
}): Promise<OpenCodeWebHandle> {
  return startPanelServer({
    service: options.service,
    config: options.config,
    panel: OPENCODE_PANEL,
    html: embeddedLegacyHtml,
    ...(options.host !== undefined ? { host: options.host } : {}),
    ...(options.port !== undefined ? { port: options.port } : {}),
    ...(options.saveConfig ? { saveConfig: options.saveConfig } : {}),
  })
}
