/** Browser entry point: mount the shared app against a host's API. */
import * as React from 'react'
import { createRoot } from 'react-dom/client'

import type { UiHost } from '../headless/host.js'
import { createTranslator } from '../headless/i18n.js'
import { graphVm, healthVm, itemsVm, lintVm, settingsVm, statusVm } from '../headless/viewmodels.js'
import { MemoryApp, type ScreenData } from './app.js'
import { styleSheet } from './styles.js'

export async function collectScreenData(host: UiHost): Promise<ScreenData> {
  const t = createTranslator(host.locale())
  const [status, items, graph, lint, health, settings, backups] = await Promise.all([
    host.request<Parameters<typeof statusVm>[0]>('status'),
    host.request<Parameters<typeof itemsVm>[0]>('list'),
    host.request<Parameters<typeof graphVm>[0]>('graph'),
    host.request<Parameters<typeof lintVm>[0]>('lint'),
    host.request<Parameters<typeof healthVm>[0]>('health'),
    host.request<Record<string, string | number | boolean>>('settings.get'),
    host.request<ScreenData['backups']>('backup.list'),
  ])
  return {
    status: statusVm(status, t),
    items: itemsVm(items),
    graph: graphVm(graph),
    lint: lintVm(lint),
    health: healthVm(health, t),
    settings: settingsVm(settings, t),
    backups,
  }
}

function injectStyles(): void {
  const id = 'lm-styles'
  if (typeof document === 'undefined' || document.getElementById(id)) return
  const style = document.createElement('style')
  style.id = id
  style.textContent = styleSheet()
  document.head.append(style)
}

export function mount(target: HTMLElement, host: UiHost): Promise<void> {
  injectStyles()
  return collectScreenData(host).then(data => {
    createRoot(target).render(<MemoryApp host={host} data={data} />)
  })
}
