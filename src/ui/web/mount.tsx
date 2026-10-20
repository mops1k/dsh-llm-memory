/** Browser entry point: mount the shared schema-driven panel against a host API. */
import * as React from 'react'
import { createRoot } from 'react-dom/client'

import type { UiHost } from '../headless/host.js'
import { MemoryPanel } from './panel.js'
import { styleSheet } from './styles.js'
import type { PanelSnapshot } from './types.js'

/** Everything the panel needs to draw itself: views, actions and operations. */
export async function loadPanel(host: UiHost): Promise<PanelSnapshot> {
  return host.request<PanelSnapshot>('ui.snapshot')
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
  const requested =
    typeof location !== 'undefined' ? new URLSearchParams(location.search).get('view') ?? undefined : undefined
  return loadPanel(host).then(snapshot => {
    createRoot(target).render(
      <MemoryPanel host={host} snapshot={snapshot} {...(requested ? { initialView: requested } : {})} />,
    )
  })
}
