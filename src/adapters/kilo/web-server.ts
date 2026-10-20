/**
 * Kilo panel: the shared design page plus the compatibility JSON API over
 * KiloService, on the Kilo port (8787 by default).
 */
import { embeddedLegacyHtml } from '../panel/web-bundle.js'
import { startPanelServer, type PanelHandle } from '../panel/server.js'
import type { KiloService } from './service.js'
import type { KiloMemoryConfig } from './config.js'

export type KiloWebHandle = PanelHandle

/** Host wiring the shared design page receives (theme and API live here). */
const KILO_PANEL = { kind: 'kilo' as const, apiBase: '/api/legacy', locale: 'ru' as const }

export async function startKiloWebServer(options: {
  service: KiloService
  config: KiloMemoryConfig
  host?: string
  port?: number
  saveConfig?: (config: KiloMemoryConfig) => void
}): Promise<KiloWebHandle> {
  return startPanelServer({
    service: options.service,
    config: options.config,
    panel: KILO_PANEL,
    html: embeddedLegacyHtml,
    ...(options.host !== undefined ? { host: options.host } : {}),
    ...(options.port !== undefined ? { port: options.port } : {}),
    ...(options.saveConfig ? { saveConfig: options.saveConfig } : {}),
  })
}
