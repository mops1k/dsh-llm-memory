import { readFileSync } from 'node:fs'
import vm from 'node:vm'

import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

/**
 * The dsh in-shell client is a classic browser module (no bundler): it registers
 * itself through `window.__ModuleLoader__`. This test loads it in a VM, applies
 * the plugin context and statically renders the two slots — the fastest guard
 * against syntax/runtime mistakes in the 3k-line hand-written client.
 */
const code = readFileSync(new URL('../client/client.js', import.meta.url), 'utf8')

interface Registered {
  views: React.ComponentType[]
  settings: React.ComponentType[]
}

function loadClient(): Registered {
  let definition: { factory: (require: (id: string) => unknown) => { apply: (ctx: unknown) => void } } | undefined
  const window = {
    __ModuleLoader__: {
      load: (loaded: typeof definition) => {
        definition = loaded
      },
    },
  }
  const sandbox = { window, console, setTimeout, clearTimeout } as Record<string, unknown>
  sandbox['globalThis'] = sandbox
  vm.createContext(sandbox)
  vm.runInContext(code, sandbox)
  expect(definition).toBeDefined()

  const registered: Registered = { views: [], settings: [] }
  const scope = {
    getSnapshot: () => ({ value: { webPath: '/llm-memory' } }),
    subscribe: () => () => {},
    set: async () => {},
    unset: async () => {},
    mutate: async () => {},
  }
  const ctx = {
    slots: {
      inject: (_name: string, register: () => unknown) => register(),
      register: (meta: { name: string }, component: React.ComponentType) => {
        if (meta.name === 'conversation.view') registered.views.push(component)
        if (meta.name === 'settings.section') registered.settings.push(component)
        return () => {}
      },
    },
    configForms: { get: () => scope },
  }
  definition!.factory(id => (id === 'react' ? React : undefined)).apply(ctx)
  return registered
}

describe('dsh in-shell client', () => {
  it('renders the conversation view in the shared design', () => {
    const { views } = loadClient()
    expect(views).toHaveLength(1)
    const html = renderToStaticMarkup(React.createElement(views[0]!))
    expect(html).toContain('class="lm-panel"')
    expect(html).toContain('class="lm-tabs"')
    expect(html).toContain('class="page-head"')
    expect(html).toContain('Entries')
    expect(html).toContain('New entry')
    expect(html).toContain('class="btn btn-primary"')
    expect(html).toContain('data-theme=')
  })

  it('renders the settings slot without throwing', () => {
    const { settings } = loadClient()
    expect(settings).toHaveLength(1)
    const html = renderToStaticMarkup(React.createElement(settings[0]!))
    expect(html).toContain('LLM Memory')
  })
})
