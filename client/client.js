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

    const TOKENS = {
      colorBg: '#fff', colorSurface: '#f5f6f8', colorBorder: '#d9dce1', colorText: '#1c1f24',
      colorMuted: '#6b7280', colorAccent: '#6d4aff', colorDanger: '#d14343',
      radius: '8px', spacing: '8px', fontFamily: 'system-ui, sans-serif', fontSize: '14px',
    }

    function makeHost(base) {
      return {
        kind: 'dsh',
        request: async (operation, input) => {
          const response = await window.fetch(base + '/api/ui', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ operation, input }),
          })
          if (!response.ok) throw new Error(operation + ' failed: HTTP ' + response.status)
          return response.json()
        },
        locale: () => 'en',
        theme: () => TOKENS,
        t: key => key,
      }
    }

    function Panel(ctx) {
      const base = resolveBase(ctx)
      const ref = React.useRef(null)
      React.useEffect(() => {
        let cancelled = false
        const node = ref.current
        import(base + '/ui/web-ui.js')
          .then(mod => { if (!cancelled && node) mod.mount(node, makeHost(base)) })
          .catch(error => { if (node) node.textContent = 'LLM Memory UI failed to load: ' + String(error) })
        return () => { cancelled = true }
      }, [base])
      return h('div', { ref, style: { width: '100%', height: '100%', minHeight: '520px', overflow: 'auto' } })
    }

    let scope = null

    function MemoryView() {
      return Panel(scope)
    }

    function SettingsCard() {
      return Panel(scope)
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
