/** RAG map: PCA scatter from the SDK vector-map widget, query marker and health. */
import { app, tr, viewDef } from '../state.js'
import {
  button,
  card,
  emptyState,
  errorPanel,
  metricLine,
  pageHead,
  searchBox,
  toast,
} from '../ui.js'
import { clamp, fmtNumber, h } from '../util.js'
import { openEntry } from './entry.js'

const W = 1000
const H = 560
const PAD = 54

function kindOf(point) {
  return point.kind ?? 'facts'
}

function project(map, query) {
  const points = map?.points ?? []
  const xs = points.map(point => point.x)
  const ys = points.map(point => point.y)
  if (query && Number.isFinite(query.x)) xs.push(query.x)
  if (query && Number.isFinite(query.y)) ys.push(query.y)
  const minX = Math.min(...xs, -0.6)
  const maxX = Math.max(...xs, 0.6)
  const minY = Math.min(...ys, -0.6)
  const maxY = Math.max(...ys, 0.6)
  const sx = point => PAD + ((point.x - minX) / (maxX - minX || 1)) * (W - PAD * 2)
  const sy = point => H - PAD - ((point.y - minY) / (maxY - minY || 1)) * (H - PAD * 2)
  return { sx, sy, minX, maxX, minY, maxY }
}

function scoreOf(point, query) {
  if (!query) return null
  const distance = Math.hypot((point.x ?? 0) - query.x, (point.y ?? 0) - query.y)
  return Number(clamp(1 - distance / 1.4, 0, 0.99).toFixed(3))
}

export async function mount(container) {
  const view = viewDef('map')
  const mapWidget = view.widgets.find(widget => widget.kind === 'vector-map')
  const actionsWidget = view.widgets.find(widget => widget.kind === 'actions')
  const params = Object.fromEntries((mapWidget.params ?? []).map(param => [param.name, param]))
  const minParam = params.minScore ?? { label: tr('map.minScore'), min: 0, max: 1, step: 0.01 }
  const topParam = params.topK ?? { label: tr('map.topK'), min: 1, max: 50, step: 1 }
  const paramLabel = param => (app.locale === 'ru' ? tr(`map.param.${param.name}`) : param.label ?? tr(`map.param.${param.name}`))
  const minLabel = paramLabel(minParam)
  const topLabel = paramLabel(topParam)

  const state = {
    q: '',
    topK: Math.min(Number(topParam.max ?? 50), 8),
    minScore: 0,
    data: null,
    health: null,
    error: null,
  }

  const root = h('div', { class: 'page' })
  container.append(root)
  root.append(pageHead({ title: view.title, sub: tr('map.subtitle') }))

  const host = h('div', { class: 'mt-16' })
  root.append(host)

  async function rebuild(event) {
    const btn = event?.currentTarget
    if (btn) btn.disabled = true
    try {
      await app.api.rebuildVectors()
      toast({ type: 'ok', text: tr('map.rebuildStarted') })
      await reload()
    } catch (error) {
      toast({ type: 'error', text: error instanceof Error ? error.message : String(error) })
    } finally {
      if (btn) btn.disabled = false
    }
  }

  function renderNearest(mapData) {
    const query = mapData?.query
    const points = mapData?.map?.points ?? []
    let nearest = query?.nearest
    if (!nearest && query && points.length) {
      nearest = points
        .map(point => ({ id: point.id, title: point.title, kind: point.kind, score: scoreOf(point, query) }))
        .filter(item => item.score !== null)
        .sort((a, b) => b.score - a.score)
    }
    if (!nearest?.length) {
      return card({
        title: tr('map.nearest'),
        body: h('div', { class: 'empty' }, h('div', { class: 'empty-text' }, tr('map.nearestHint'))),
      })
    }
    const filtered = nearest.filter(item => (item.score ?? 0) >= state.minScore).slice(0, state.topK)
    return card({
      title: tr('map.nearest'),
      sub: `${filtered.length} / ${nearest.length}`,
      body: h('div', {},
        filtered.length
          ? filtered.map(item => {
            const row = h('div', { class: 'nearest-item' },
              h('i', { class: 'kind-dot', dataset: { kind: item.kind ?? 'facts' } }),
              h('div', { class: 't grow' }, item.title ?? item.id),
              h('span', { class: 'score' }, `${Math.round((item.score ?? 0) * 100)}%`),
            )
            row.tabIndex = 0
            row.setAttribute('role', 'button')
            row.addEventListener('click', () => openEntry(item.id))
            row.addEventListener('keydown', event => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                openEntry(item.id)
              }
            })
            return row
          })
          : h('div', { class: 'empty' }, h('div', { class: 'empty-text' }, tr('common.none'))),
      ),
      flush: true,
    })
  }

  function renderHealth(health) {
    const value = health?.health ?? health
    if (!value) return card({ title: tr('map.health'), body: h('div', { class: 'card-body muted' }, tr('map.disabled')) })
    const issues = ['orphans', 'missing', 'partial', 'badDim', 'broken', 'metadataStale']
      .reduce((sum, key) => sum + (value[key]?.length ?? 0), 0)
    return card({
      title: tr('map.health'),
      sub: `${tr('map.checked')}: ${fmtNumber(value.checked ?? 0)}`,
      actions: h('span', { class: `badge ${issues ? 'badge-warn' : 'badge-ok'}` }, issues ? `${issues}` : tr('common.ok')),
      body: h('div', {},
        metricLine(tr('map.orphans'), fmtNumber(value.orphans?.length ?? 0)),
        metricLine(tr('map.missing'), fmtNumber(value.missing?.length ?? 0)),
        metricLine(tr('map.partial'), fmtNumber(value.partial?.length ?? 0)),
        metricLine(tr('map.badDim'), fmtNumber(value.badDim?.length ?? 0)),
      ),
    })
  }

  async function reload() {
    host.replaceChildren(card({ body: h('div', { class: 'skeleton', style: { height: '380px' } }) }))
    try {
      const [mapData, health] = await Promise.all([
        app.api.vectorsMap({ q: state.q, topK: state.topK, project: app.project }),
        app.api.vectorsHealth().catch(() => null),
      ])
      state.data = mapData
      state.health = health
      state.error = null
      render()
    } catch (error) {
      state.error = error
      host.replaceChildren(card({ body: errorPanel(error, reload) }))
    }
  }

  function render() {
    const mapData = state.data
    const map = mapData?.map
    const query = mapData?.query
    if (!map || !(map.points?.length)) {
      host.replaceChildren(card({
        body: emptyState({
          iconName: 'map',
          title: tr('map.empty'),
          text: tr('map.disabledText'),
          action: actionsWidget.actions.includes('vectors.rebuild')
            ? button({ label: tr('map.rebuild'), variant: 'primary', iconName: 'zap', onClick: rebuild })
            : null,
        }),
      }))
      return
    }

    const { sx, sy } = project(map, query)
    const points = map.points
    const nearest = new Set((mapData.query?.nearest ?? []).map(item => item.id))
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`)
    svg.setAttribute('role', 'img')
    svg.setAttribute('aria-label', tr('map.subtitle'))

    const axis = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    axis.setAttribute('class', 'map-axes')
    const yAxis = document.createElementNS('http://www.w3.org/2000/svg', 'line')
    yAxis.setAttribute('x1', String(PAD - 12)); yAxis.setAttribute('x2', String(PAD - 12))
    yAxis.setAttribute('y1', String(PAD)); yAxis.setAttribute('y2', String(H - PAD))
    const xAxis = document.createElementNS('http://www.w3.org/2000/svg', 'line')
    xAxis.setAttribute('x1', String(PAD - 12)); xAxis.setAttribute('x2', String(W - PAD))
    xAxis.setAttribute('y1', String(H - PAD)); xAxis.setAttribute('y2', String(H - PAD))
    const xLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text')
    xLabel.setAttribute('x', String(W - PAD)); xLabel.setAttribute('y', String(H - PAD + 16)); xLabel.setAttribute('text-anchor', 'end')
    xLabel.textContent = `PC1 · ${Math.round((map.explained?.[0] ?? 0) * 100)}%`
    const yLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text')
    yLabel.setAttribute('x', String(PAD - 10)); yLabel.setAttribute('y', String(PAD - 16)); yLabel.setAttribute('text-anchor', 'start')
    yLabel.textContent = `PC2 · ${Math.round((map.explained?.[1] ?? 0) * 100)}%`
    axis.append(yAxis, xAxis, xLabel, yLabel)
    svg.append(axis)

    for (const point of points) {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
      circle.setAttribute('class', 'map-point')
      circle.setAttribute('cx', String(sx(point)))
      circle.setAttribute('cy', String(sy(point)))
      circle.setAttribute('r', nearest.has(point.id) ? '5.5' : '3.4')
      circle.setAttribute('fill', `var(--k-${kindOf(point)}, var(--accent))`)
      circle.setAttribute('fill-opacity', '0.78')
      circle.setAttribute('stroke', nearest.has(point.id) ? 'var(--accent)' : 'var(--surface)')
      circle.setAttribute('stroke-width', nearest.has(point.id) ? '1.6' : '0.8')
      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title')
      title.textContent = point.title ?? point.id
      circle.append(title)
      circle.addEventListener('click', () => openEntry(point.id))
      svg.append(circle)
    }

    if (query && Number.isFinite(query.x) && Number.isFinite(query.y)) {
      const cx = sx(query)
      const cy = sy(query)
      const ring = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
      ring.setAttribute('cx', String(cx)); ring.setAttribute('cy', String(cy)); ring.setAttribute('r', '9')
      ring.setAttribute('fill', 'none'); ring.setAttribute('stroke', 'var(--accent)'); ring.setAttribute('stroke-width', '2')
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
      dot.setAttribute('cx', String(cx)); dot.setAttribute('cy', String(cy)); dot.setAttribute('r', '3.2')
      dot.setAttribute('fill', 'var(--accent)')
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text')
      const onLeft = cx > W - 170
      label.setAttribute('x', String(onLeft ? cx - 14 : cx + 14)); label.setAttribute('y', String(cy + 4)); label.setAttribute('class', 'graph-label')
      label.setAttribute('text-anchor', onLeft ? 'end' : 'start')
      label.textContent = tr('map.queryPoint')
      svg.append(ring, dot, label)
    }

    const viz = h('div', { class: 'viz' }, svg,
      h('div', { class: 'viz-legend' },
        [...new Set(points.map(kindOf))].map(kind => h('span', { class: 'chip' },
          h('i', { class: 'kind-dot', dataset: { kind } }),
          h('span', {}, kind),
          h('span', { class: 'faint' }, String(points.filter(point => kindOf(point) === kind).length)),
        )),
      ),
    )

    const queryInput = searchBox({
      placeholder: tr('map.queryPlaceholder'),
      value: state.q,
      onEnter: value => { state.q = value; void reload() },
    })
    queryInput.setAttribute('data-page-search', 'true')

    const controls = h('div', { class: 'map-toolbar' },
      queryInput,
      h('label', { class: 'field', style: { minWidth: '160px' } },
        h('span', { class: 'field-label' }, `${minLabel} ≥ ${state.minScore.toFixed(2)}`),
        h('input', {
          class: 'range', type: 'range', min: String(minParam.min ?? 0), max: String(minParam.max ?? 1), step: String(minParam.step ?? 0.01), value: String(state.minScore),
        }),
      ),
      h('label', { class: 'field', style: { minWidth: '130px' } },
        h('span', { class: 'field-label' }, `${topLabel} ${state.topK}`),
        h('input', { class: 'range', type: 'range', min: String(topParam.min ?? 1), max: String(topParam.max ?? 50), step: String(topParam.step ?? 1), value: String(state.topK) }),
      ),
      actionsWidget.actions.includes('vectors.rebuild')
        ? button({ label: tr('map.rebuild'), iconName: 'zap', onClick: rebuild })
        : null,
    )
    const ranges = controls.querySelectorAll('.range')
    ranges[0].addEventListener('input', event => {
      state.minScore = Number(event.target.value)
      event.target.closest('.field').querySelector('.field-label').textContent = `${minLabel} ≥ ${state.minScore.toFixed(2)}`
      const parent = host.querySelector('.grid-2 .stack')
      if (parent) parent.replaceChildren(renderNearest(state.data), renderHealth(state.health))
    })
    ranges[1].addEventListener('input', event => {
      state.topK = Number(event.target.value)
      event.target.closest('.field').querySelector('.field-label').textContent = `${topLabel} ${state.topK}`
      const parent = host.querySelector('.grid-2 .stack')
      if (parent) parent.replaceChildren(renderNearest(state.data), renderHealth(state.health))
    })

    const grid = h('div', { class: 'grid-2' },
      card({
        title: tr('map.projection'),
        sub: `${map.entries} ${tr('overview.entries').toLowerCase()} · ${map.chunks} ${tr('overview.chunks').toLowerCase()}`,
        actions: h('span', { class: 'badge badge-accent' }, `${tr('map.points')}: ${points.length}`),
        body: viz,
        flush: true,
      }),
      h('div', { class: 'stack', style: { gap: '14px' } }, renderHealth(state.health), renderNearest(mapData)),
    )

    host.replaceChildren(
      h('div', { class: 'card' }, controls),
      h('div', { class: 'mt-16' }, grid),
    )
  }

  app.refresh = reload
  await reload()
}
