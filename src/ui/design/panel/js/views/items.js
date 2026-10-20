/** Entries: schema columns, filters, sorting and schema-driven pagination. */
import { navigate, replaceHash } from '../router.js'
import { app, persist, restore, tr, viewDef } from '../state.js'
import {
  button,
  card,
  dataTable,
  errorPanel,
  pageHead,
  searchBox,
  skeletonTable,
} from '../ui.js'
import { debounce, h } from '../util.js'
import { openEntry } from './entry.js'

export { openEntry }

function select({ title, value, options, onChange }) {
  const el = h('select', { class: 'select', title, 'aria-label': title, style: { width: 'auto', minWidth: '132px' } })
  for (const option of options) {
    el.append(h('option', { value: option.value, selected: option.value === value }, option.label))
  }
  el.addEventListener('change', () => onChange(el.value))
  return el
}

export async function mount(container) {
  const view = viewDef('items')
  const tableWidget = view.widgets.find(widget => widget.kind === 'table')
  const pagination = tableWidget.pagination ?? { pageSizes: [12, 24, 48, 96], defaultPageSize: 24 }
  const editorWidget = viewDef('editor').widgets.find(widget => widget.kind === 'editor')
  const kindField = editorWidget.fields.find(field => field.path === 'kind')
  const tierField = editorWidget.fields.find(field => field.path === 'tier')

  const params = app.params
  const savedSize = restore('size:items', null)
  let size = Number(params.size) || (pagination.pageSizes.includes(savedSize) ? savedSize : null) || pagination.defaultPageSize
  const state = {
    query: params.q ?? '',
    kind: params.kind ?? '',
    tier: params.tier ?? '',
    scope: params.scope ?? '',
    status: params.status ?? '',
    sort: params.sort ?? 'updated',
    page: Math.max(1, Number(params.page) || 1),
    size,
  }

  const root = h('div', { class: 'page' })
  container.append(root)
  root.append(pageHead({
    title: view.title,
    sub: tr('items.subtitle'),
    actions: button({ label: tr('items.newEntry'), iconName: 'plus', variant: 'primary', onClick: () => navigateEditor() }),
  }))

  function navigateEditor() {
    navigate('editor', { new: '1' })
  }

  const search = searchBox({
    placeholder: tr('items.placeholder'),
    value: state.query,
    onInput: debounce(value => {
      state.query = value
      state.page = 1
      void load()
    }, 240),
    onEnter: value => {
      state.query = value
      state.page = 1
      void load()
    },
  })
  search.setAttribute('data-page-search', 'true')

  const kindSelect = select({
    title: tr('items.filterKind'),
    value: state.kind,
    options: [{ value: '', label: tr('items.allKinds') }, ...(kindField?.options ?? []).map(option => ({ value: option.value, label: option.label }))],
    onChange: value => { state.kind = value; state.page = 1; void load() },
  })
  const tierSelect = select({
    title: tr('items.filterTier'),
    value: state.tier,
    options: [{ value: '', label: tr('items.allTiers') }, ...(tierField?.options ?? []).map(option => ({ value: option.value, label: option.label }))],
    onChange: value => { state.tier = value; state.page = 1; void load() },
  })
  const scopeSelect = select({
    title: tr('items.filterScope'),
    value: state.scope,
    options: [
      { value: '', label: tr('items.allScopes') },
      { value: 'project', label: 'project' },
      { value: 'user', label: 'user' },
    ],
    onChange: value => { state.scope = value; state.page = 1; void load() },
  })
  const statusSelect = select({
    title: tr('items.filterStatus'),
    value: state.status,
    options: [
      { value: '', label: tr('items.allStatuses') },
      { value: 'active', label: 'active' },
      { value: 'superseded', label: 'superseded' },
    ],
    onChange: value => { state.status = value; state.page = 1; void load() },
  })
  const sortSelect = select({
    title: tr('items.sort'),
    value: state.sort,
    options: [
      { value: 'updated', label: tr('items.sortUpdated') },
      { value: 'created', label: tr('items.sortCreated') },
      { value: 'importance', label: tr('items.sortImportance') },
    ],
    onChange: value => { state.sort = value; state.page = 1; void load() },
  })

  const reset = button({ label: tr('common.reset'), variant: 'ghost', size: 'sm', iconName: 'refresh' })
  const resetWrap = h('span', { style: { display: 'none' } }, reset)
  const updateReset = () => {
    const active = Boolean(state.query || state.kind || state.tier || state.scope || state.status || state.sort !== 'updated')
    resetWrap.style.display = active ? '' : 'none'
  }
  reset.addEventListener('click', () => {
    state.query = ''
    state.kind = ''
    state.tier = ''
    state.scope = ''
    state.status = ''
    state.sort = 'updated'
    state.page = 1
    search.input.value = ''
    kindSelect.value = ''
    tierSelect.value = ''
    scopeSelect.value = ''
    statusSelect.value = ''
    sortSelect.value = 'updated'
    updateReset()
    void load()
  })

  const toolbar = h('div', { class: 'toolbar' },
    search,
    kindSelect,
    tierSelect,
    scopeSelect,
    statusSelect,
    sortSelect,
    resetWrap,
  )
  const tableHost = h('div')
  root.append(toolbar, tableHost)

  function syncHash() {
    replaceHash('items', {
      q: state.query,
      kind: state.kind,
      tier: state.tier,
      scope: state.scope,
      status: state.status,
      sort: state.sort === 'updated' ? '' : state.sort,
      page: state.page > 1 ? state.page : '',
      size: state.size,
    })
  }

  async function load() {
    updateReset()
    tableHost.replaceChildren(card({ body: skeletonTable(6) }))
    try {
      const result = await app.api.items({
        query: state.query,
        kind: state.kind,
        tier: state.tier,
        scope: state.scope,
        status: state.status,
        project: app.project,
        limit: state.size,
        offset: (state.page - 1) * state.size,
        sort: state.sort,
      })
      const total = result.total ?? result.items?.length ?? 0
      const pages = Math.max(1, Math.ceil(total / state.size))
      if (state.page > pages) state.page = pages
      tableHost.replaceChildren(dataTable({
        columns: tableWidget.columns,
        rows: result.items ?? [],
        page: state.page,
        pageSize: state.size,
        total,
        pageSizes: pagination.pageSizes,
        onPage: page => {
          state.page = page
          syncHash()
          void load()
        },
        onPageSize: value => {
          state.size = value
          state.page = 1
          persist('size:items', value)
          syncHash()
          void load()
        },
        onRow: row => openEntry(row),
        empty: {
          iconName: 'list',
          title: tr('items.empty'),
          text: tr('items.emptyText'),
          action: button({ label: tr('items.newEntry'), onClick: navigateEditor }),
        },
      }))
      syncHash()
    } catch (error) {
      tableHost.replaceChildren(card({ body: errorPanel(error, load) }))
    }
  }

  app.refresh = load
  await load()
}
