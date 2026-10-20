/** Health: lint and heal reports plus their action buttons. */
import { app, tr, viewDef } from '../state.js'
import {
  actionButton,
  button,
  card,
  confirmAction,
  emptyState,
  errorPanel,
  loadingBlock,
  metricLine,
  pageHead,
  toast,
} from '../ui.js'
import { dateText } from '../state.js'
import { fmtNumber, h, markdown } from '../util.js'

function chip(label, value, tone = '') {
  return h('span', { class: `chip ${tone}` }, h('span', { class: 'faint' }, label), h('strong', {}, fmtNumber(value)))
}

function issueLine(title, meta) {
  return h('div', { class: 'issue' },
    h('div', { class: 'issue-title' }, title),
    meta ? h('div', { class: 'issue-meta' }, meta) : null,
  )
}

function sections(lint) {
  const blocks = []
  const add = (label, items, render) => {
    if (!items?.length) return
    blocks.push(h('div', { class: 'report-section-label' }, `${label} · ${items.length}`))
    const list = h('div', { class: 'issue-list' }, items.map(render))
    blocks.push(list)
  }
  add(tr('health.brokenLinks'), lint.brokenLinks, link =>
    issueLine(`${link.from} → ${link.to}`, link.label))
  add(tr('health.overlaps'), lint.overlaps, pair =>
    issueLine(`${pair.aTitle ?? pair.a} ↔ ${pair.bTitle ?? pair.b}`, pair.sharedTags ? `tags: ${pair.sharedTags}` : pair.a))
  add(tr('health.duplicates'), lint.duplicates, pair =>
    issueLine(`${pair.title} ↔ ${pair.duplicateTitle ?? pair.duplicateId}`, pair.id))
  add(tr('health.stale'), lint.stale, item =>
    issueLine(item.title ?? item.id, item.updatedAt ? dateText(item.updatedAt) : ''))
  return blocks
}

function renderLint(lint) {
  if (typeof lint === 'string') return h('div', { class: 'report', html: markdown(lint) })
  if (!lint || typeof lint !== 'object') return emptyState({ iconName: 'pulse', title: tr('health.reportEmpty') })
  const overlaps = lint.overlaps?.length ?? 0
  const duplicates = lint.duplicates?.length ?? 0
  const broken = lint.brokenLinks?.length ?? 0
  const stale = lint.stale?.length ?? 0
  const clean = overlaps + duplicates + broken + stale === 0
  return h('div', {},
    h('div', { class: 'chips' },
      chip(tr('health.entries'), lint.totalCount ?? 0),
      chip(tr('health.active'), lint.activeCount ?? 0),
      chip(tr('health.overlaps'), overlaps, overlaps ? 'warn' : ''),
      chip(tr('health.duplicates'), duplicates, duplicates ? 'warn' : ''),
      chip(tr('health.brokenLinks'), broken, broken ? 'danger' : ''),
      chip(tr('health.stale'), stale, stale ? 'warn' : ''),
    ),
    clean
      ? h('div', { class: 'mt-12' }, emptyState({ iconName: 'check-circle', title: tr('health.clean') }))
      : sections(lint),
    lint.staleDays !== undefined ? h('div', { class: 'mt-12' }, metricLine(tr('health.staleDays'), lint.staleDays)) : null,
    lint.promptDigestChars !== undefined ? metricLine(tr('health.promptDigest'), `${fmtNumber(lint.promptDigestChars)} ${tr('health.chars')}`) : null,
    lint.overlapsHidden ? metricLine(tr('health.overlapsHidden'), lint.overlapsHidden) : null,
  )
}

const HEAL_LABELS = {
  removedLinks: 'health.removedLinks',
  addedBacklinks: 'health.addedBacklinks',
  reindexed: 'health.reindexed',
  brokenBefore: 'health.brokenBefore',
  brokenAfter: 'health.brokenAfter',
}
const VECTOR_LABELS = {
  checked: 'health.checked',
  orphansRemoved: 'health.orphansRemoved',
  metadataFixed: 'health.metadataFixed',
  badRemoved: 'health.badRemoved',
  foreignRemoved: 'health.foreignRemoved',
  queued: 'health.queued',
  tempFilesSwept: 'health.tempSwept',
}

function healLabel(key) {
  return HEAL_LABELS[key] ? tr(HEAL_LABELS[key]) : key
}

function vectorLabel(key) {
  return VECTOR_LABELS[key] ? tr(VECTOR_LABELS[key]) : `vectors.${key}`
}

function renderHeal(report) {
  if (typeof report === 'string') return h('div', { class: 'report', html: markdown(report) })
  if (!report || typeof report !== 'object') return emptyState({ iconName: 'shield-check', title: tr('health.reportEmpty') })
  const vectors = report.vectors ?? {}
  return h('div', {},
    metricLine(healLabel('removedLinks'), report.removedLinks ?? 0),
    metricLine(healLabel('addedBacklinks'), report.addedBacklinks ?? 0),
    metricLine(healLabel('reindexed'), report.reindexed ?? 0),
    metricLine(healLabel('brokenBefore'), report.brokenBefore ?? 0),
    metricLine(healLabel('brokenAfter'), report.brokenAfter ?? 0),
    Object.keys(vectors).length ? h('hr', { class: 'divider' }) : null,
    Object.keys(vectors).length ? h('div', { class: 'report-section-label', style: { marginTop: '0' } }, tr('health.vectors')) : null,
    Object.entries(vectors).map(([key, value]) => metricLine(vectorLabel(key), value)),
  )
}

const VECTOR_HEALTH_LABELS = {
  orphans: 'health.orphans',
  metadataStale: 'health.metadataStale',
  missing: 'health.missingVectors',
  partial: 'health.partial',
  foreign: 'health.foreign',
  badDim: 'health.badDim',
  broken: 'health.broken',
}

function renderVectorHealth(health) {
  if (!health) {
    return emptyState({ iconName: 'pulse', title: tr('health.reportEmpty'), text: tr('health.vectorDisabled') })
  }
  const counters = Object.entries(VECTOR_HEALTH_LABELS).map(([key, label]) => {
    const value = Array.isArray(health[key]) ? health[key].length : Number(health[key] ?? 0)
    return chip(tr(label), value, value ? 'warn' : '')
  })
  const issues = counters.filter((_, index) => {
    const key = Object.keys(VECTOR_HEALTH_LABELS)[index]
    const value = Array.isArray(health[key]) ? health[key].length : Number(health[key] ?? 0)
    return value > 0
  })
  return h('div', {},
    h('div', { class: 'chips' },
      chip(tr('health.checked'), health.checked ?? 0),
      ...counters,
    ),
    issues.length === 0
      ? h('div', { class: 'mt-12' }, emptyState({ iconName: 'check-circle', title: tr('health.clean') }))
      : null,
  )
}

export async function mount(container) {
  const view = viewDef('health')
  const actionsWidget = view.widgets.find(widget => widget.kind === 'actions')
  const root = h('div', { class: 'page' })
  container.append(root)
  root.append(pageHead({ title: view.title, sub: tr('health.subtitle') }))
  const host = h('div', { class: 'mt-16' })
  root.append(host)

  async function run(id, buttonEl) {
    if (buttonEl) buttonEl.disabled = true
    try {
      if (id === 'lint.run') {
        await app.api.lint({ project: app.project })
        toast({ type: 'ok', text: tr('health.lintDone') })
      } else if (id === 'heal.apply') {
        const ok = await confirmAction({ title: tr('health.applyTitle'), text: tr('health.applyText'), danger: false, confirmText: tr('common.apply') })
        if (!ok) return
        await app.api.heal('apply-safe')
        toast({ type: 'ok', text: tr('health.applied') })
      } else if (id === 'vectors.health') {
        // The report is reloaded below; nothing to change.
      } else if (id === 'vectors.repair') {
        await app.api.repairVectors()
        toast({ type: 'ok', text: tr('health.repaired') })
      } else if (id === 'vectors.embed') {
        await app.api.embedVectors()
        toast({ type: 'ok', text: tr('health.embedded') })
      } else if (id === 'vectors.rebuild') {
        const ok = await confirmAction({ title: tr('health.rebuildTitle'), text: tr('health.rebuildText'), danger: true, confirmText: tr('common.apply') })
        if (!ok) return
        await app.api.rebuildVectors()
        toast({ type: 'ok', text: tr('health.rebuilt') })
      } else {
        await app.api.heal('report')
        toast({ type: 'ok', text: tr('health.healDone') })
      }
      await load()
    } catch (error) {
      toast({ type: 'error', text: error instanceof Error ? error.message : String(error) })
    } finally {
      if (buttonEl) buttonEl.disabled = false
    }
  }

  async function load() {
    host.replaceChildren(loadingBlock())
    try {
      const [lint, heal, vectors] = await Promise.all([
        app.api.lint({ project: app.project }),
        app.api.heal('report'),
        Promise.resolve(app.api.vectorsHealth ? app.api.vectorsHealth() : null).catch(() => null),
      ])
      const lintCard = card({
        title: tr('health.lint'),
        sub: tr('health.runHint'),
        actionsFirst: true,
        actions: actionsWidget.actions.includes('lint.run')
          ? actionButton('lint.run', event => run('lint.run', event.currentTarget), { size: 'sm' })
          : null,
        body: renderLint(lint),
      })
      const healCard = card({
        title: tr('health.heal'),
        sub: tr('health.runHint'),
        actionsFirst: true,
        actions: [
          actionButton('heal.report', event => run('heal.report', event.currentTarget), { size: 'sm' }),
          actionsWidget.actions.includes('heal.apply')
            ? button({ label: tr('health.applyHeal'), size: 'sm', onClick: event => run('heal.apply', event.currentTarget) })
            : null,
        ],
        body: renderHeal(heal),
      })
      const vectorAction = id => actionsWidget.actions.includes(id)
      const ragCard = card({
        title: tr('health.vectorsTitle'),
        sub: tr('health.vectorsSub'),
        actionsFirst: true,
        actions: [
          vectorAction('vectors.health')
            ? actionButton('vectors.health', event => run('vectors.health', event.currentTarget), { size: 'sm' })
            : null,
          vectorAction('vectors.repair') && app.api.repairVectors
            ? actionButton('vectors.repair', event => run('vectors.repair', event.currentTarget), { size: 'sm' })
            : null,
          vectorAction('vectors.embed') && app.api.embedVectors
            ? actionButton('vectors.embed', event => run('vectors.embed', event.currentTarget), { size: 'sm' })
            : null,
          vectorAction('vectors.rebuild')
            ? actionButton('vectors.rebuild', event => run('vectors.rebuild', event.currentTarget), { size: 'sm', variant: 'danger' })
            : null,
        ],
        body: renderVectorHealth(vectors),
      })
      host.replaceChildren(h('div', { class: 'grid-2' }, lintCard, healCard), h('div', { class: 'mt-16' }, ragCard))
    } catch (error) {
      host.replaceChildren(errorPanel(error, load))
    }
  }

  app.refresh = load
  await load()
}
