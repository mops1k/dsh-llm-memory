/**
 * Theme = tokens + CSS only (ADR-004): hosts differ by tokens, never by
 * forked components.
 */
export interface ThemeTokens {
  colorBg: string
  colorSurface: string
  colorBorder: string
  colorText: string
  colorMuted: string
  colorAccent: string
  colorDanger: string
  radius: string
  spacing: string
  fontFamily: string
  fontSize: string
}

export const BASE_THEME: ThemeTokens = {
  colorBg: '#ffffff',
  colorSurface: '#f5f6f8',
  colorBorder: '#d9dce1',
  colorText: '#1c1f24',
  colorMuted: '#6b7280',
  colorAccent: '#2f6fed',
  colorDanger: '#d14343',
  radius: '8px',
  spacing: '8px',
  fontFamily: 'system-ui, sans-serif',
  fontSize: '14px',
}

export const THEMES: Record<'kilo' | 'opencode' | 'mcp' | 'dsh', ThemeTokens> = {
  kilo: { ...BASE_THEME, colorAccent: '#6d4aff' },
  opencode: { ...BASE_THEME, colorAccent: '#00a37a' },
  mcp: { ...BASE_THEME, colorAccent: '#c2410c' },
  dsh: { ...BASE_THEME, colorAccent: '#2f6fed' },
}

/** CSS custom properties for a theme, ready to be applied by any host. */
export function themeToCssVars(theme: ThemeTokens): Record<string, string> {
  return {
    '--lm-bg': theme.colorBg,
    '--lm-surface': theme.colorSurface,
    '--lm-border': theme.colorBorder,
    '--lm-text': theme.colorText,
    '--lm-muted': theme.colorMuted,
    '--lm-accent': theme.colorAccent,
    '--lm-danger': theme.colorDanger,
    '--lm-radius': theme.radius,
    '--lm-spacing': theme.spacing,
    '--lm-font-family': theme.fontFamily,
    '--lm-font-size': theme.fontSize,
  }
}
