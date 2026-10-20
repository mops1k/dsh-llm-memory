import { describe, expect, it } from 'vitest'

import { scopedPanelCss } from '../scripts/build-client-css.mjs'

describe('dsh in-shell panel styles', () => {
  it('scopes the prototype CSS to the panel root', () => {
    const css = scopedPanelCss()
    expect(css).toContain('.lm-panel{')
    expect(css).toContain('.lm-panel[data-theme="dark"]{')
    expect(css).toContain('.lm-panel .page-head{')
    expect(css).toContain('.lm-panel .table{')
    expect(css).not.toMatch(/(^|\n)\.page-head\s*\{/)
    expect(css).not.toMatch(/(^|\n)body\s*\{/)
  })

  it('keeps keyframes reusable inside the panel', () => {
    const css = scopedPanelCss()
    expect(css).toContain('@keyframes fade-up')
    expect(css).toContain('@media (max-width: 640px)')
    expect(css).not.toContain('.lm-panel @keyframes')
  })
})
