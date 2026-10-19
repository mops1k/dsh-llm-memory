/**
 * dsh-llm-memory client half (classic browser module).
 *
 * The GUI panel now hosts the shared headless WebUI (packages/ui/web) inside an
 * iframe of the plugin's own page (`<webPath>/ui`), so DSH shows exactly the
 * same status/items/graph/lint/health/settings/backup screens as Kilo/OpenCode.
 * The native settings page stays server-rendered by SettingsForms.
 */
window.__ModuleLoader__.load({
  id: 'dsh-llm-memory',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement

    const NAMESPACE = 'dsh-llm-memory'
    const DEFAULT_WEB_PATH = '/llm-memory'
    const VIEW_LABEL = 'LLM Memory'
    const VIEW_ID = 'llm-memory'
    const ORDER = 30

    const inject = ['slots', 'configForms']

    function normalizeBase(value) {
      let raw = typeof value === 'string' ? value.trim() : ''
      if (raw.length === 0) raw = DEFAULT_WEB_PATH
      if (raw.charAt(0) !== '/') raw = '/' + raw
      raw = raw.replace(/\/+$/, '')
      return raw.length === 0 ? DEFAULT_WEB_PATH : raw
    }

    function resolveBase(ctx) {
      try {
        const config = ctx && ctx.configForms ? ctx.configForms.get(NAMESPACE) : undefined
        return normalizeBase(config ? config.webPath : undefined)
      } catch {
        return DEFAULT_WEB_PATH
      }
    }

    function Panel(ctx, view) {
      const base = resolveBase(ctx)
      const source = base + '/ui' + (view === 'settings' ? '?section=settings' : '')
      return h('div', { className: 'llm-memory-embed', style: { width: '100%', height: '100%', minHeight: '520px' } },
        h('iframe', {
          title: VIEW_LABEL,
          src: source,
          style: { width: '100%', height: '100%', minHeight: '520px', border: '0', display: 'block' },
          sandbox: 'allow-scripts allow-same-origin allow-forms',
        }),
      )
    }

    let scope = null

    function MemoryView() {
      return Panel(scope, 'conversation')
    }

    function SettingsCard() {
      return Panel(scope, 'settings')
    }

    function apply(ctx) {
      scope = ctx
      ctx.slots.inject('conversation.view', () =>
        ctx.slots.register({ name: 'conversation.view', id: VIEW_ID, order: ORDER, label: () => VIEW_LABEL }, MemoryView),
      )
      ctx.slots.inject('settings.section', () =>
        ctx.slots.register({ name: 'settings.section', id: VIEW_ID, order: 20, label: () => VIEW_LABEL }, SettingsCard),
      )
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
