import { describe, expect, it } from 'vitest'

import { BASE_THEME, THEMES, themeToCssVars } from '@llm-memory/ui/theme/tokens'

describe('themes', () => {
  it('exposes all tokens as CSS variables for every host', () => {
    const expected = Object.keys(themeToCssVars(BASE_THEME))
    expect(expected.length).toBe(11)
    for (const [kind, theme] of Object.entries(THEMES)) {
      const vars = themeToCssVars(theme)
      expect(Object.keys(vars)).toEqual(expected)
      expect(Object.values(vars).every(value => typeof value === 'string' && value.length > 0)).toBe(true)
      expect(kind).toMatch(/^(kilo|opencode|mcp|dsh)$/)
    }
  })

  it('differentiates hosts by tokens only', () => {
    const accents = new Set(Object.values(THEMES).map(theme => theme.colorAccent))
    expect(accents.size).toBeGreaterThan(1)
    // Layout tokens stay shared: no per-host forks of the design system.
    for (const theme of Object.values(THEMES)) {
      expect(theme.radius).toBe(BASE_THEME.radius)
      expect(theme.spacing).toBe(BASE_THEME.spacing)
      expect(theme.fontFamily).toBe(BASE_THEME.fontFamily)
    }
  })
})
