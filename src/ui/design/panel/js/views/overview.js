/** Overview: KPI cards from the schema stats widget, recent entries, live state. */
import { navigate } from '../router.js'
import { app, tr, viewDef } from '../state.js'
import {
  actionButton,
  button,
  card,
  copyButton,
  dataTable,
  errorPanel,
  fmtBytes,
  fmtNumber,
  pageHead,
  statCard,
  toast,
} from '../ui.js'
import { fmtDate, h } from '../util.js'
import { openEntry } from './entry.js'

const STAT_ICONS = ['database', 'check-circle', 'shield', 'tag', 'layers']

function metricValue(metric, status) {
  // Projects are a property of the store, not of the active filter: the KPI and
  // the selector must agree on the full list even when one project is selected.
  if (metric.path === 'projects') return app.projects.length || status.projects || Object.keys(status.byProject ?? {}).length
  if (metric.path === 'total') return status.total
  if (metric.path === 'active') return status.active
  if (metric.path.startsWith('byKind.')) return status.byKind?.[metric.path.slice(7)] ?? 0
  return metric.path.split('.').reduce((node, key) => (node == null ? undefined : node[key]), status)
}

function formatMetric(value) {
  if (typeof value === 'number') return fmtNumber(value)
  if (typeof value === 'boolean') return value ? tr('common.ok') : tr('common.off')
  return value ?? '—'
}

function stateRow(label, value, extra) {
  return h('div', { class: 'metric-line' },
    h('span', { class: 'muted' }, label),
    h('span', { class: 'flex items-center gap-8', style: { minWidth: 0, justifyContent: 'flex-end' } }, value, extra ?? null),
  )
}

function vectorBadge(vectors) {
  if (!vectors) return h('span', { class: 'badge' }, tr('common.off'))
  if (vectors.disabled) return h('span', { class: 'badge' }, tr('common.off'))
  if (vectors.running) return h('span', { class: 'badge badge-warn' }, tr('common.running'))
  if (vectors.pending > 0) return h('span', { class: 'badge badge-warn' }, `${vectors.pending}`)
  return h('span', { class: 'badge badge-ok' }, tr('common.ok'))
}

export async function mount(container) {
  const view = viewDef('overview')
  const root = h('div', { class: 'page' })
  container.append(root)
  root.append(pageHead({
    title: view.title,
    sub: tr('overview.subtitle'),
    actions: button({ label: tr('overview.allEntries'), iconName: 'arrow-right', onClick: () => navigate('items') }),
  }))

  const statsHost = h('div', { class: 'grid-kpi' },
    Array.from({ length: 5 }, () => h('div', { class: 'stat' }, h('div', { class: 'skeleton', style: { width: '50%' } }), h('div', { class: 'skeleton mt-8', style: { height: '24px', width: '35%' } }))),
  )
  const mainHost = h('div', { class: 'grid-2 mt-16' },
    card({ body: h('div', { class: 'skeleton', style: { height: '180px' } }) }),
    card({ body: h('div', { class: 'skeleton', style: { height: '180px' } }) }),
  )
  const statsWrap = h('div', {}, statsHost)
  const mainWrap = h('div', {}, mainHost)
  root.append(statsWrap, mainWrap)

  const reload = async () => {
    try {
      const project = app.project
      const [status, recent, model] = await Promise.all([
        app.api.status({ project }),
        app.api.items({ limit: 6, sort: 'updated', project }),
        app.api.modelStatus().catch(() => null),
      ])
      app.status = status

      const statsWidget = view.widgets.find(widget => widget.kind === 'stats')
      const kpi = h('div', { class: 'grid-kpi' },
        statsWidget.metrics.map((metric, index) => statCard({
          label: metric.label,
          value: formatMetric(metricValue(metric, status)),
          iconName: STAT_ICONS[index % STAT_ICONS.length],
        })),
      )
      statsWrap.replaceChildren(kpi)

      const itemsWidget = viewDef('items').widgets.find(widget => widget.kind === 'table')
      const recentColumns = ['title', 'kind', 'updatedAt'].map(path => itemsWidget.columns.find(column => column.path === path)).filter(Boolean)
      const table = dataTable({
        title: tr('overview.recent'),
        sub: tr('overview.recentSub'),
        columns: recentColumns,
        rows: recent.items ?? [],
        onRow: row => openEntry(row),
        hideFoot: true,
        empty: { iconName: 'list', title: tr('items.empty'), text: tr('items.emptyText'), action: button({ label: tr('items.newEntry'), onClick: () => navigate('editor', { new: '1' }) }) },
      })

      const vectors = status.vectors ?? {}
      const actionsWidget = view.widgets.find(widget => widget.kind === 'actions')
      const quick = h('div', { class: 'flex gap-8', style: { flexWrap: 'wrap' } },
        actionsWidget.actions.map(id => {
          const btn = actionButton(id, async () => {
            btn.disabled = true
            try {
              if (id === 'lint.run') {
                await app.api.lint({ project })
                toast({ type: 'ok', text: tr('health.lintDone') })
              } else {
                await app.api.heal('report')
                toast({ type: 'ok', text: tr('health.healDone') })
                navigate('health')
              }
            } catch (error) {
              toast({ type: 'error', text: error instanceof Error ? error.message : String(error) })
            } finally {
              btn.disabled = false
            }
          }, { size: 'sm' })
          return btn
        }),
      )

      const side = card({
        title: tr('overview.state'),
        sub: tr('overview.stateSub'),
        body: h('div', {},
          stateRow(tr('overview.store'), h('span', { class: 'mono truncate', style: { maxWidth: '150px' }, title: status.root }, status.root ?? '—'), copyButton(status.root)),
          stateRow(tr('overview.dbSize'), fmtBytes(status.dbSizeBytes)),
          stateRow(tr('overview.vectors'), h('span', { class: 'mono' }, `${fmtNumber(vectors.entries ?? 0)} · ${fmtNumber(vectors.chunks ?? 0)}`), vectorBadge(vectors)),
          stateRow(tr('overview.model'), h('span', { class: 'truncate', style: { maxWidth: '150px' }, title: model?.model ?? '' }, model?.model ?? '—'),
            h('span', { class: `badge ${model?.cached ? 'badge-ok' : 'badge-warn'}` }, model?.cached ? tr('overview.cached') : tr('overview.notCached'))),
          stateRow(tr('common.updated'), h('span', { class: 'muted' }, status.updatedAt ? fmtDate(status.updatedAt, app.locale, true) : '—')),
          h('hr', { class: 'divider' }),
          quick,
        ),
      })

      mainWrap.replaceChildren(h('div', { class: 'grid-2 mt-16' }, table, side))
    } catch (error) {
      mainWrap.replaceChildren(h('div', { class: 'mt-16' }, errorPanel(error, reload)))
    }
  }

  app.refresh = reload
  await reload()
}
