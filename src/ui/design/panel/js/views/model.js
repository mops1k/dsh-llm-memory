/** Embedding model: cache state, progress, runtime and typed-confirm removal. */
import { app, tr, viewDef } from '../state.js'
import {
  button,
  card,
  confirmAction,
  copyButton,
  errorPanel,
  metricLine,
  noticeBox,
  pageHead,
  progressBar,
  toast,
} from '../ui.js'
import { fmtBytes, fmtNumber, getPath, h, icon } from '../util.js'

export async function mount(container) {
  const view = viewDef('model')
  const statsWidget = view.widgets.find(widget => widget.kind === 'stats')
  const actionsWidget = view.widgets.find(widget => widget.kind === 'actions')
  const removeWord = app.sdk.locales[app.locale].actions.find(action => action.id === 'model.remove')?.confirm ?? 'DELETE'
  const demo = app.mode === 'demo'

  const root = h('div', { class: 'page' })
  container.append(root)
  const host = h('div')
  let status = null
  let downloading = false

  const downloadButton = button({ label: tr('model.download'), iconName: 'download', variant: 'primary' })
  const removeButton = button({ label: tr('model.remove'), iconName: 'trash', variant: 'danger' })

  root.append(pageHead({
    title: view.title,
    sub: tr('model.subtitle'),
    actions: actionsWidget.actions.includes('model.download') ? h('div', { class: 'flex gap-8' }, downloadButton, removeButton) : null,
  }))
  root.append(host)

  function applyButtons() {
    const cached = Boolean(status?.cached)
    downloadButton.disabled = downloading || (cached && !status?.missing?.length)
    removeButton.disabled = downloading || !cached
    downloadButton.textContent = ''
    downloadButton.append(icon(downloading ? 'refresh' : 'download'), h('span', {}, downloading ? tr('model.downloading') : tr('model.download')))
  }

  function tile(metric) {
    let value = getPath(status, metric.path)
    let node
    if (typeof value === 'boolean') node = h('span', { class: `badge ${value ? 'badge-ok' : 'badge-warn'}` }, value ? tr('common.ok') : tr('common.off'))
    else if (metric.path === 'bytes') node = fmtBytes(value)
    else if (typeof value === 'number') node = fmtNumber(value)
    else node = value ?? '—'
    const small = metric.path === 'dir' || metric.path === 'model'
    return h('div', { class: 'stat' },
      h('div', { class: 'stat-top' }, h('span', { class: 'stat-label' }, metric.label), h('span', { class: 'stat-ico' }, icon(metric.path === 'dir' ? 'database' : metric.path === 'model' ? 'cpu' : 'layers'))),
      h('div', { class: 'stat-value', style: small ? { fontSize: '12.5px', fontWeight: '500', fontFamily: metric.path === 'dir' ? 'var(--mono)' : 'inherit', overflowWrap: 'anywhere', marginTop: '8px' } : null }, node),
    )
  }

  function render() {
    if (!status) return
    const tiles = h('div', { class: 'grid-kpi' }, statsWidget.metrics.filter(metric => metric.path !== 'dir').map(tile))
    const runtime = status.runtime
    const body = h('div', {},
      status.error ? h('div', { class: 'error-box', style: { marginBottom: '12px' } }, icon('alert'), h('div', { class: 'grow' }, status.error)) : null,
      downloading || status.downloading
        ? h('div', { class: 'mb-12' },
          h('div', { class: 'flex items-center gap-8', style: { justifyContent: 'space-between', marginBottom: '6px' } },
            h('span', { class: 'muted' }, tr('model.downloading')),
            h('span', { class: 'mono faint' }, `${Math.round(status.progress ?? 0)}%`),
          ),
          progressBar(status.progress ?? 0),
        )
        : null,
      h('div', { class: 'chips', style: { marginBottom: '12px' } },
        h('span', { class: 'chip' }, tr('model.provider'), h('strong', {}, status.provider ?? '—')),
        h('span', { class: `chip ${status.enabled ? 'active' : ''}` }, status.enabled ? tr('model.enabled') : tr('model.disabled')),
        h('span', { class: 'chip' }, tr('model.cached'), h('strong', {}, status.cached ? tr('common.ok') : tr('common.off'))),
      ),
      status.missing?.length
        ? h('div', { class: 'notice warn mb-12' },
          icon('alert'),
          h('div', { class: 'grow' },
            h('div', { style: { fontWeight: '550' } }, tr('model.missing')),
            h('div', { class: 'chips mt-8' }, status.missing.map(item => h('span', { class: 'tag' }, item))),
          ),
        )
        : null,
      metricLine(tr('model.dir'), h('span', { class: 'flex items-center gap-6', style: { minWidth: 0 } },
        h('span', { class: 'mono truncate', title: status.dir }, status.dir ?? '—'),
        copyButton(status.dir ?? ''),
      )),
      runtime
        ? h('div', {},
          h('hr', { class: 'divider' }),
          metricLine(tr('model.runtime'), runtime.present ? tr('model.runtimePresent') : tr('model.runtimeMissing')),
          runtime.dir ? metricLine(tr('model.runtimeDir'), h('span', { class: 'mono' }, runtime.dir)) : null,
          runtime.installing ? metricLine(tr('common.status'), tr('common.running')) : null,
          runtime.error ? metricLine(tr('common.error'), runtime.error) : null,
          runtime.command && !runtime.present ? metricLine('command', h('span', { class: 'mono' }, runtime.command)) : null,
        )
        : null,
      h('div', { class: 'mt-12' }, h('p', { class: 'faint', style: { margin: 0, fontSize: '12px' } }, tr('model.hint'))),
    )
    const cardEl = card({ title: tr('model.status'), sub: status.model, body })
    host.replaceChildren(tiles, h('div', { class: 'mt-16' }, cardEl))

    if (runtime && !runtime.present && actionsWidget.actions.includes('model.download')) {
      host.append(h('div', { class: 'mt-12' }, noticeBox('warn', tr('model.noRuntime'))))
    }
    applyButtons()
  }

  async function load() {
    try {
      status = await app.api.modelStatus()
      render()
    } catch (error) {
      host.replaceChildren(card({ body: errorPanel(error, load) }))
    }
  }

  async function download() {
    if (downloading) return
    downloading = true
    applyButtons()
    const timer = setInterval(async () => {
      try {
        status = await app.api.modelStatus()
        render()
      } catch {
        // polling is best-effort
      }
    }, demo ? 260 : 900)
    try {
      status = await app.api.downloadModel()
      toast({ type: 'ok', text: tr('model.downloadDone') })
    } catch (error) {
      toast({ type: 'error', text: error instanceof Error ? error.message : String(error) })
    } finally {
      clearInterval(timer)
      downloading = false
      try {
        status = await app.api.modelStatus()
      } catch {
        // keep the last known status
      }
      render()
    }
  }

  downloadButton.addEventListener('click', download)

  removeButton.addEventListener('click', async () => {
    const ok = await confirmAction({
      title: tr('model.removeTitle'),
      text: tr('model.removeText'),
      word: removeWord,
      confirmText: tr('common.remove'),
    })
    if (!ok) return
    try {
      await app.api.removeModel()
      toast({ type: 'ok', text: tr('model.removeDone') })
      await load()
    } catch (error) {
      toast({ type: 'error', text: error instanceof Error ? error.message : String(error) })
    }
  })

  app.refresh = load
  await load()
}
