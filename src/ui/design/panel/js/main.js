/** App shell: boot, navigation, header, theme/locale, routing, palette, shortcuts. */
import { createApi, loadHostSdk } from './api.js'
import { applyTheme, app, persist, restore, sdk, tr, viewDef } from './state.js'
import { closeOverlays, closeTopOverlay, openModal, toast } from './ui.js'
import { navigate, readHash } from './router.js'
import { basename, clear, copyText, debounce, h, icon } from './util.js'

import * as overview from './views/overview.js'
import * as items from './views/items.js'
import * as editor from './views/editor.js'
import * as recall from './views/recall.js'
import * as graph from './views/graph.js'
import * as map from './views/map.js'
import * as health from './views/health.js'
import * as settings from './views/settings.js'
import * as backup from './views/backup.js'
import * as model from './views/model.js'

const routes = { overview, items, editor, recall, graph, map, health, settings, backup, model }

const ICONS = {
  overview: 'grid',
  items: 'list',
  editor: 'edit',
  recall: 'search',
  graph: 'graph',
  map: 'map',
  health: 'pulse',
  settings: 'sliders',
  backup: 'archive',
  model: 'cpu',
}

const NAV_GROUPS = [
  { label: null, ids: ['overview'] },
  { label: 'nav.group.data', ids: ['items', 'recall'] },
  { label: 'nav.group.analysis', ids: ['graph', 'map'] },
  { label: 'nav.group.system', ids: ['health', 'settings', 'backup', 'model'] },
]

let fixtures = null

function setupNav() {
  const nav = document.getElementById('nav')
  clear(nav)
  const status = app.status
  for (const group of NAV_GROUPS) {
    const section = h('div', { class: 'nav-group' })
    if (group.label) section.append(h('div', { class: 'nav-label' }, tr(group.label)))
    for (const id of group.ids) {
      const view = viewDef(id)
      if (!view) continue
      const link = h('a', {
        class: `nav-item${app.route === id ? ' active' : ''}`,
        href: `#/${id}`,
        dataset: { route: id },
        title: view.title,
      })
      link.append(icon(ICONS[id] ?? 'grid'), h('span', { class: 'nav-text' }, view.title))
      if (id === 'items' && status?.total !== undefined) {
        link.append(h('span', { class: 'nav-count' }, String(status.total)))
      }
      link.addEventListener('click', () => {
        document.getElementById('sidebar')?.classList.remove('open')
        closeMobileBackdrop()
      })
      section.append(link)
    }
    nav.append(section)
  }
}

function closeMobileBackdrop() {
  const backdrop = document.getElementById('backdrop')
  if (backdrop && !document.querySelector('.drawer.open, .layer, .palette-layer')) {
    backdrop.classList.remove('open')
    backdrop.hidden = true
  }
}

function updateNavActive() {
  for (const link of document.querySelectorAll('.nav-item')) {
    link.classList.toggle('active', link.dataset.route === app.route)
  }
}

function updateHeader() {
  document.documentElement.lang = app.locale
  document.getElementById('palette-hint').textContent = tr('topbar.searchPlaceholder')
  document.getElementById('project-label').textContent = tr('topbar.projectLabel')

  const modeChip = document.getElementById('mode-chip')
  modeChip.classList.toggle('live', app.mode === 'live')
  document.getElementById('mode-label').textContent = app.mode === 'live' ? tr('mode.live') : tr('mode.demo')
  modeChip.title = app.mode === 'live' ? tr('mode.liveTooltip') : tr('mode.demoTooltip')

  const storeText = app.status?.root ?? '—'
  document.getElementById('store-path-text').textContent = storeText
  document.getElementById('store-path').title = `${tr('overview.storeTooltip')}: ${storeText}`

  document.getElementById('sdk-version').textContent = `UI SDK v${fixtures?.version ?? 1}`

  const projectSelect = document.getElementById('project-select')
  clear(projectSelect)
  projectSelect.append(h('option', { value: 'all', selected: app.project === 'all' }, tr('topbar.projectAll')))
  for (const project of app.projects) {
    // The key is an absolute path; the list shows its short name and keeps the
    // full path in the title/value, exactly like the previous dashboard.
    projectSelect.append(h('option', {
      value: project,
      title: project,
      selected: app.project === project,
    }, basename(project) || project))
  }

  const themeButton = document.getElementById('theme-btn')
  clear(themeButton)
  const themeIcon = app.themePref === 'light' ? 'sun' : app.themePref === 'dark' ? 'moon' : 'monitor'
  themeButton.append(icon(themeIcon))
  themeButton.title = `${tr('topbar.theme')}: ${tr(`topbar.theme${app.themePref[0].toUpperCase()}${app.themePref.slice(1)}`)}`

  document.getElementById('lang-btn').textContent = app.locale === 'ru' ? 'RU' : 'EN'
  document.getElementById('lang-btn').title = tr('topbar.language')
}

function setTheme(pref) {
  applyTheme(pref)
  updateHeader()
}

function cycleTheme() {
  const order = ['system', 'light', 'dark']
  setTheme(order[(order.indexOf(app.themePref) + 1) % order.length])
}

async function toggleLocale() {
  app.locale = app.locale === 'ru' ? 'en' : 'ru'
  persist('locale', app.locale)
  updateHeader()
  setupNav()
  await renderRoute()
}

function showShortcuts() {
  const rows = [
    ['Ctrl K', tr('shortcuts.palette')],
    ['/', tr('shortcuts.focus')],
    ['Enter', tr('shortcuts.submit')],
    ['?', tr('shortcuts.help')],
    ['Esc', tr('shortcuts.close')],
  ]
  const body = h('div', { class: 'stack', style: { gap: '6px' } },
    rows.map(([keys, label]) => h('div', { class: 'flex items-center gap-12', style: { justifyContent: 'space-between' } },
      h('span', { class: 'muted' }, label),
      h('kbd', { class: 'kbd' }, keys),
    )),
  )
  openModal({ title: tr('shortcuts.title'), body, confirmText: tr('common.close'), hideCancel: true, onConfirm: () => true })
}

/* ---------------- command palette ---------------- */

let paletteLayer = null
let paletteEntries = []
let paletteSelected = 0
let paletteItems = []

function actionScreen(id) {
  if (id.startsWith('backup.')) return 'backup'
  if (id.startsWith('model.')) return 'model'
  if (id === 'vectors.rebuild' || id === 'vectors.health') return 'map'
  return 'health'
}

async function runGlobalAction(id) {
  const action = sdk().actions.find(item => item.id === id)
  try {
    switch (id) {
      case 'lint.run':
        await app.api.lint({ project: app.project })
        toast({ type: 'ok', text: tr('health.lintDone') })
        navigate('health')
        break
      case 'heal.report':
        await app.api.heal('report')
        toast({ type: 'ok', text: tr('health.healDone') })
        navigate('health')
        break
      case 'heal.apply':
        await app.api.heal('apply-safe')
        toast({ type: 'ok', text: tr('health.applied') })
        navigate('health')
        break
      case 'backup.create':
        await app.api.createBackup()
        toast({ type: 'ok', text: tr('backup.created') })
        navigate('backup')
        break
      case 'vectors.rebuild':
        await app.api.rebuildVectors()
        toast({ type: 'ok', text: tr('map.rebuildStarted') })
        navigate('map')
        break
      case 'vectors.health':
        await app.api.vectorsHealth()
        toast({ type: 'ok', text: tr('toast.actionDone', { action: action?.label ?? id }) })
        navigate('map')
        break
      case 'model.download':
        await app.api.downloadModel()
        toast({ type: 'ok', text: tr('model.downloadDone') })
        navigate('model')
        break
      case 'model.status':
        navigate('model')
        break
      default:
        toast({ type: 'info', text: tr('toast.actionDone', { action: action?.label ?? id }) })
        navigate(actionScreen(id))
    }
  } catch (error) {
    toast({ type: 'error', title: tr('toast.actionFailed'), text: error instanceof Error ? error.message : String(error) })
  }
}

function paletteBaseItems() {
  const nav = sdk().views
    .filter(view => view.id !== 'editor')
    .map(view => ({
      section: tr('palette.nav'),
      label: view.title,
      icon: ICONS[view.id] ?? 'grid',
      run: () => navigate(view.id),
    }))
  nav.push({
    section: tr('palette.nav'),
    label: tr('palette.newEntry'),
    icon: 'plus',
    run: () => navigate('editor', { new: '1' }),
  })
  const actions = sdk().actions.map(action => ({
    section: tr('palette.actions'),
    label: action.label,
    icon: action.danger ? 'shield' : 'play',
    hint: action.mode === 'write' ? tr('palette.write') : tr('palette.read'),
    run: () => runGlobalAction(action.id),
  }))
  const iface = [
    { section: tr('palette.interface'), label: tr('palette.themeLight'), icon: 'sun', run: () => setTheme('light') },
    { section: tr('palette.interface'), label: tr('palette.themeDark'), icon: 'moon', run: () => setTheme('dark') },
    { section: tr('palette.interface'), label: tr('palette.themeSystem'), icon: 'monitor', run: () => setTheme('system') },
    { section: tr('palette.interface'), label: tr('palette.langRu'), icon: 'info', run: () => { if (app.locale !== 'ru') void toggleLocale() } },
    { section: tr('palette.interface'), label: tr('palette.langEn'), icon: 'info', run: () => { if (app.locale !== 'en') void toggleLocale() } },
    { section: tr('palette.interface'), label: tr('shortcuts.title'), icon: 'help', run: () => showShortcuts() },
  ]
  return [...nav, ...actions, ...iface]
}

function closePalette() {
  paletteLayer?.remove()
  paletteLayer = null
  paletteItems = []
  document.body.classList.remove('no-scroll')
}

function renderPaletteList() {
  if (!paletteLayer) return
  const list = paletteLayer.querySelector('.palette-list')
  const input = paletteLayer.querySelector('input')
  const query = input.value.trim().toLowerCase()
  const staticItems = paletteBaseItems().filter(item => !query || item.label.toLowerCase().includes(query))
  const sections = []
  const push = (section, items) => {
    if (items.length) sections.push({ section, items })
  }
  push(tr('palette.nav'), staticItems.filter(item => item.section === tr('palette.nav')))
  push(tr('palette.actions'), staticItems.filter(item => item.section === tr('palette.actions')))
  const entryItems = paletteEntries.map(entry => ({
    section: tr('palette.entries'),
    label: entry.title,
    hint: entry.project || entry.kind,
    icon: 'list',
    run: () => openEntryFromPalette(entry),
  }))
  push(tr('palette.entries'), entryItems)
  push(tr('palette.interface'), staticItems.filter(item => item.section === tr('palette.interface')))

  paletteItems = sections.flatMap(section => section.items)
  if (!paletteItems.length) {
    clear(list)
    list.append(h('div', { class: 'palette-empty' }, tr('palette.empty')))
    return
  }
  paletteSelected = Math.min(paletteSelected, paletteItems.length - 1)
  clear(list)
  let index = 0
  for (const section of sections) {
    list.append(h('div', { class: 'palette-section' }, section.section))
    for (const item of section.items) {
      const itemIndex = index
      const row = h('button', {
        class: `palette-item${itemIndex === paletteSelected ? ' active' : ''}`,
        type: 'button',
        style: { width: '100%', border: '0', background: 'transparent', textAlign: 'left', font: 'inherit', cursor: 'pointer' },
      })
      row.append(icon(item.icon ?? 'arrow-right'), h('span', { class: 'label' }, item.label))
      if (item.hint) row.append(h('span', { class: 'hint' }, item.hint))
      row.addEventListener('mousemove', () => {
        paletteSelected = itemIndex
        for (const [i, el] of [...list.querySelectorAll('.palette-item')].entries()) el.classList.toggle('active', i === paletteSelected)
      })
      row.addEventListener('click', () => {
        closePalette()
        item.run()
      })
      list.append(row)
      index += 1
    }
  }
}

async function openEntryFromPalette(entry) {
  const { openEntry } = await import('./views/items.js')
  openEntry(entry)
}

const searchPaletteEntries = debounce(async query => {
  if (!paletteLayer) return
  if (!query.trim()) {
    paletteEntries = []
    renderPaletteList()
    return
  }
  try {
    const result = await app.api.items({ query, limit: 5, project: app.project })
    paletteEntries = result.items ?? []
  } catch {
    paletteEntries = []
  }
  renderPaletteList()
}, 230)

function openPalette(prefill = '') {
  if (paletteLayer) {
    closePalette()
    return
  }
  paletteSelected = 0
  paletteEntries = []
  const layer = h('div', { class: 'palette-layer' })
  const input = h('input', { type: 'search', placeholder: tr('palette.placeholder'), 'aria-label': tr('palette.placeholder'), autocomplete: 'off', spellcheck: 'false' })
  input.value = prefill
  const list = h('div', { class: 'palette-list' })
  const search = h('div', { class: 'palette-search' }, icon('search'), input, h('kbd', { class: 'kbd' }, 'Esc'))
  const palette = h('div', { class: 'palette', role: 'dialog', 'aria-modal': 'true' }, search, list,
    h('div', { class: 'palette-foot' },
      h('span', {}, tr('palette.hintNav')),
      h('span', {}, tr('palette.hintOpen')),
      h('span', {}, tr('palette.hintClose')),
    ),
  )
  layer.append(palette)
  layer.addEventListener('click', event => { if (event.target === layer) closePalette() })
  document.getElementById('overlays').append(layer)
  document.body.classList.add('no-scroll')
  paletteLayer = layer

  input.addEventListener('input', () => {
    paletteSelected = 0
    renderPaletteList()
    searchPaletteEntries(input.value)
  })
  input.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      paletteSelected = Math.min(paletteSelected + 1, Math.max(0, paletteItems.length - 1))
      renderPaletteList()
      paletteLayer?.querySelector('.palette-item.active')?.scrollIntoView({ block: 'nearest' })
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      paletteSelected = Math.max(0, paletteSelected - 1)
      renderPaletteList()
      paletteLayer?.querySelector('.palette-item.active')?.scrollIntoView({ block: 'nearest' })
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const item = paletteItems[paletteSelected]
      if (item) {
        closePalette()
        item.run()
      }
    }
  })
  renderPaletteList()
  requestAnimationFrame(() => input.focus())
}

/* ---------------- routing ---------------- */

let renderToken = 0

async function renderRoute() {
  const { route, params } = readHash()
  const id = routes[route] ? route : 'overview'
  app.route = id
  app.params = params
  closeOverlays()
  updateNavActive()

  const container = document.getElementById('view')
  clear(container)

  const token = ++renderToken
  app.refresh = null
  try {
    await routes[id].mount(container)
    if (token !== renderToken) return
  } catch (error) {
    if (token !== renderToken) return
    clear(container)
    container.append(h('div', { class: 'page' },
      h('h1', { class: 'page-title' }, viewDef(id)?.title ?? id),
      h('div', { class: 'mt-16' }, h('div', { class: 'error-box' }, icon('alert'),
        h('div', { class: 'grow' }, h('div', {}, error instanceof Error ? error.message : String(error))),
      )),
    ))
  }
  document.title = `LLM Memory — ${viewDef(id)?.title ?? id}`
}

/* ---------------- boot ---------------- */

async function loadFixtures() {
  const response = await fetch('./fixtures/sdk-snapshot.json', { cache: 'no-store' })
  if (!response.ok) throw new Error(`fixture load failed: HTTP ${response.status}`)
  return response.json()
}

function bindChrome() {
  document.getElementById('menu-btn').addEventListener('click', () => {
    const sidebar = document.getElementById('sidebar')
    const backdrop = document.getElementById('backdrop')
    const open = sidebar.classList.toggle('open')
    if (backdrop) {
      backdrop.hidden = !open
      backdrop.classList.toggle('open', open)
    }
  })
  document.getElementById('backdrop').addEventListener('click', () => {
    closeOverlays()
    document.getElementById('sidebar').classList.remove('open')
    closeMobileBackdrop()
  })
  document.getElementById('palette-btn').addEventListener('click', () => openPalette())
  document.getElementById('theme-btn').addEventListener('click', cycleTheme)
  document.getElementById('lang-btn').addEventListener('click', () => void toggleLocale())
  document.getElementById('help-btn').addEventListener('click', showShortcuts)
  document.getElementById('store-path').addEventListener('click', async () => {
    if (!app.status?.root) return
    const ok = await copyText(app.status.root)
    toast({ type: ok ? 'ok' : 'error', text: ok ? tr('toast.copied') : tr('toast.copyFailed') })
  })
  document.getElementById('project-select').addEventListener('change', event => {
    app.project = event.target.value
    persist('project', app.project)
    // Re-render explicitly: the hash often already carries page=1, so setting
    // it again fires no hashchange and the screen would keep the old project.
    void renderRoute()
  })

  window.addEventListener('hashchange', () => void renderRoute())

  window.addEventListener('keydown', event => {
    const target = event.target
    const typing = target instanceof HTMLElement && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault()
      openPalette()
      return
    }
    if (event.key === 'Escape') {
      if (paletteLayer) {
        closePalette()
        return
      }
      if (closeTopOverlay()) return
      document.getElementById('sidebar').classList.remove('open')
      closeMobileBackdrop()
      return
    }
    if (typing) return
    if (event.key === '/') {
      const search = document.querySelector('[data-page-search] input, .input-wrap input')
      if (search) {
        event.preventDefault()
        search.focus()
      }
      return
    }
    if (event.key === '?' || (event.shiftKey && event.key === '/')) {
      event.preventDefault()
      showShortcuts()
    }
  })

  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    if (app.themePref === 'system') applyTheme('system', false)
  })
}

async function boot() {
  // The embedded panel (Kilo/OpenCode) is wired by the host through
  // `window.__LM_PANEL__`; the dev server injects `window.__LM_PROTOTYPE__`.
  const panel = window.__LM_PANEL__ ?? null
  if (panel) {
    app.kind = panel.kind ?? 'kilo'
    app.mode = 'live'
    app.locale = panel.locale === 'en' ? 'en' : 'ru'
    app.themePref = restore('theme', 'system')
    app.source = panel.apiBase ?? '/api/legacy'
    fixtures = await loadHostSdk(app.source, app.locale)
    app.sdk = fixtures
    app.api = await createApi({ mode: 'legacy', apiBase: app.source, kind: app.kind })
  } else {
    fixtures = await loadFixtures()
    app.sdk = fixtures
    const host = window.__LM_PROTOTYPE__ ?? { mode: 'demo', apiBase: '/api' }
    app.mode = host.mode === 'live' ? 'live' : 'demo'
    app.source = host.source ?? null
    app.api = await createApi(host)
    app.locale = restore('locale', 'ru')
    app.themePref = restore('theme', 'system')
  }
  applyTheme(app.themePref, false)

  try {
    app.status = await app.api.status()
    app.projects = await app.api.projects().catch(() => Object.keys(app.status?.byProject ?? {}).sort((a, b) => a.localeCompare(b)))
  } catch (error) {
    app.projects = []
    toast({ type: 'error', text: error instanceof Error ? error.message : String(error) })
  }

  // The host decides the locale; a saved project still applies to it.
  const savedProject = restore('project', 'all')
  app.project = savedProject === 'all' || app.projects.includes(savedProject) ? savedProject : 'all'

  bindChrome()
  setupNav()
  updateHeader()

  const initial = readHash()
  if (!location.hash) location.hash = '#/overview'
  else if (!routes[initial.route]) location.hash = '#/overview'
  await renderRoute()

  // Keyboard focus for the page search shortcut.
  document.getElementById('view').addEventListener('keydown', event => {
    if (event.key === 'Escape' && event.target instanceof HTMLElement && event.target.tagName === 'INPUT') {
      event.target.blur()
    }
  })
}

boot().catch(error => {
  const container = document.getElementById('view')
  clear(container)
  container.append(h('div', { class: 'page' },
    h('h1', { class: 'page-title' }, 'LLM Memory'),
    h('div', { class: 'mt-16' }, h('div', { class: 'error-box' }, icon('alert'),
      h('div', { class: 'grow' },
        h('div', {}, 'Не удалось загрузить панель LLM Memory.'),
        h('div', { class: 'mt-8 mono' }, error instanceof Error ? error.message : String(error)),
        h('div', { class: 'mt-8 muted' }, 'Dev-сервер: node src/ui/design/panel/server.mjs · встроенная панель: проверьте /api/legacy на хосте.'),
      ),
    )),
  ))
})

