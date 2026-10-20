/**
 * Shared stylesheet. It is injected once by `mount()` so every host (Kilo panel,
 * DSH GUI/settings) gets the same design without shipping separate CSS files.
 */
export function styleSheet(): string {
  return `
.lm-app{display:flex;flex-direction:column;min-height:100%;background:var(--lm-bg,#fff);color:var(--lm-text,#1c1f24);font-family:var(--lm-font,system-ui,sans-serif);font-size:var(--lm-size,14px)}
.lm-nav{display:flex;flex-wrap:wrap;gap:4px;padding:8px;border-bottom:1px solid var(--lm-border,#d9dce1);background:var(--lm-surface,#f5f6f8)}
.lm-nav button{border:1px solid transparent;background:transparent;color:inherit;padding:6px 10px;border-radius:6px;cursor:pointer;font:inherit;text-transform:capitalize}
.lm-nav button:hover{background:var(--lm-hover,rgba(109,74,255,.08))}
.lm-nav button[aria-current="page"],.lm-nav button.lm-active{background:var(--lm-accent,#6d4aff);color:#fff;border-color:var(--lm-accent,#6d4aff)}
.lm-screen{display:flex;flex-direction:column;gap:12px;padding:16px}
.lm-status,.lm-health,.lm-settings,.lm-lint,.lm-backup,.lm-graph,.lm-items{display:grid;gap:8px}
.lm-item{padding:10px 12px;border:1px solid var(--lm-border,#d9dce1);border-radius:8px;background:var(--lm-surface,#fafbfc)}
.lm-item h3{margin:0 0 4px;font-size:14px}
.lm-meta{color:var(--lm-muted,#6b7280);font-size:12px;display:flex;gap:8px;flex-wrap:wrap}
.lm-badge,.lm-severity{display:inline-block;padding:1px 6px;border-radius:999px;background:var(--lm-hover,rgba(109,74,255,.1));font-size:11px}
.lm-ok{color:#188038}
.lm-empty{color:var(--lm-muted,#6b7280);padding:16px;text-align:center}
.lm-field{display:flex;flex-direction:column;gap:4px;margin-bottom:8px}
.lm-field label{font-size:12px;color:var(--lm-muted,#6b7280)}
.lm-field input,.lm-field select,.lm-field textarea{font:inherit;padding:6px 8px;border:1px solid var(--lm-border,#d9dce1);border-radius:6px;background:var(--lm-bg,#fff);color:inherit}
.lm-lint ul,.lm-backup ul,.lm-items ul{list-style:none;margin:0;padding:0;display:grid;gap:6px}
.lm-graph svg{max-width:100%;height:auto}
button.lm-btn{padding:6px 12px;border-radius:6px;border:1px solid var(--lm-border,#d9dce1);background:var(--lm-surface,#f5f6f8);cursor:pointer;font:inherit}
button.lm-btn:hover{background:var(--lm-hover,rgba(109,74,255,.08))}
.lm-head{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--lm-border,#d9dce1);background:var(--lm-surface,#f5f6f8)}
.lm-spacer{flex:1}
.lm-stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px;margin:0}
.lm-stats dt{color:var(--lm-muted,#6b7280);font-size:12px}
.lm-stats dd{margin:2px 0 0;font-weight:600}
.lm-table{width:100%;border-collapse:collapse;font-size:13px}
.lm-table th,.lm-table td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--lm-border,#d9dce1)}
.lm-table tbody tr:hover{background:var(--lm-hover,rgba(109,74,255,.06));cursor:pointer}
.lm-pager{display:flex;align-items:center;gap:8px;justify-content:flex-end}
.lm-pager select{font:inherit;padding:4px 6px;border:1px solid var(--lm-border,#d9dce1);border-radius:6px;background:var(--lm-bg,#fff);color:inherit}
.lm-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.lm-danger{border-color:var(--lm-danger,#d14343);color:var(--lm-danger,#d14343)}
.lm-primary{background:var(--lm-accent,#6d4aff);border-color:var(--lm-accent,#6d4aff);color:#fff}
.lm-search{display:flex;gap:8px}
.lm-search input{flex:1;font:inherit;padding:6px 8px;border:1px solid var(--lm-border,#d9dce1);border-radius:6px;background:var(--lm-bg,#fff);color:inherit}
.lm-load{display:flex;gap:8px;margin-bottom:8px}
.lm-load input{flex:1;font:inherit;padding:6px 8px;border:1px solid var(--lm-border,#d9dce1);border-radius:6px;background:var(--lm-bg,#fff);color:inherit}
.lm-error{color:var(--lm-danger,#d14343)}
.lm-report pre,.lm-map{white-space:pre-wrap;word-break:break-word;background:var(--lm-surface,#fafbfc);border:1px solid var(--lm-border,#d9dce1);border-radius:8px;padding:10px;font-size:12px;max-height:420px;overflow:auto}
.lm-unsupported span{opacity:.65}
.lm-fieldset{margin:0}
`
}

/** Theme tokens -> CSS variables consumed by the stylesheet above. */
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
