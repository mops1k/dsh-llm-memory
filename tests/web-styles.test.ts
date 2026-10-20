import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { PANEL_CSS } from '@llm-memory/ui/web/styles.css'

/**
 * The React panel must render the same design as the Kilo/OpenCode page. The CSS
 * is generated into `src/ui/web/styles.css.ts`; this test fails when the
 * generated copy drifts from `src/ui/design/panel/styles/`.
 */
const designDir = fileURLToPath(new URL('../src/ui/design/panel/styles/', import.meta.url))

describe('web panel styles', () => {
  it('matches the shared design stylesheets', () => {
    const expected = ['tokens.css', 'app.css'].map(file => readFileSync(`${designDir}${file}`, 'utf8')).join('\n')
    expect(PANEL_CSS).toBe(expected)
    expect(PANEL_CSS).toContain('--accent')
    expect(PANEL_CSS).toContain('.card')
    expect(PANEL_CSS).toContain('data-theme="dark"')
  })
})
