/**
 * Shared stylesheet of the schema-driven panel. The CSS is the accepted shared
 * design (`src/ui/design/panel/styles/`), generated into `styles.css.ts` by
 * `scripts/build-web-styles.mjs`; it is injected once by `mount()`.
 */
import { PANEL_CSS } from './styles.css.js'

export function styleSheet(): string {
  return PANEL_CSS
}

/** Theme tokens -> CSS variables (kept for hosts that still pass a theme). */
export function themeVars(tokens: {
  colorBg?: string
  colorSurface?: string
  colorBorder?: string
  colorText?: string
  colorMuted?: string
  colorAccent?: string
  colorDanger?: string
  radius?: string
  spacing?: string
  fontFamily?: string
  fontSize?: string
}): Record<string, string> {
  return {
    '--lm-bg': tokens.colorBg ?? '#fff',
    '--lm-surface': tokens.colorSurface ?? '#f5f6f8',
    '--lm-border': tokens.colorBorder ?? '#d9dce1',
    '--lm-text': tokens.colorText ?? '#1c1f24',
    '--lm-muted': tokens.colorMuted ?? '#6b7280',
    '--lm-accent': tokens.colorAccent ?? '#6d4aff',
    '--lm-danger': tokens.colorDanger ?? '#d14343',
    '--lm-radius': tokens.radius ?? '8px',
    '--lm-spacing': tokens.spacing ?? '8px',
    '--lm-font': tokens.fontFamily ?? 'system-ui, sans-serif',
    '--lm-size': tokens.fontSize ?? '14px',
  }
}
