/** Recall: hybrid search with per-result sources, snippets and pagination. */
import { agoText, app, persist, restore, tr, viewDef } from '../state.js'
import {
  button,
  card,
  emptyState,
  errorPanel,
  kindElement,
  loadingBlock,
  pageHead,
  pager,
  searchBox,
  tierPill,
  toast,
} from '../ui.js'
import { h } from '../util.js'
import { openEntry } from './entry.js'

function highlight(text, query) {
  const tokens = String(query ?? '').split(/\s+/).filter(token => token.length > 1)
  const fragment = document.createDocumentFragment()
  if (!tokens.length) {
    fragment.append(document.createTextNode(text))
    return fragment
  }
  const escaped = tokens.map(token => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const parts = String(text).split(new RegExp(`(${escaped.join('|')})`, 'gi'))
  for (const part of parts) {
    if (!part) continue
    if (tokens.some(token => token.toLowerCase() === part.toLowerCase())) {
      fragment.append(h('mark', {}, part))
    } else {
      fragment.append(document.createTextNode(part))
    }
  }
  return fragment
}

export async function mount(container) {
  const view = viewDef('recall')
  const widget = view.widgets.find(item => item.kind === 'search')
  const pagination = widget.pagination ?? { pageSizes: [10, 20, 50], defaultPageSize: 20 }
  const savedSize = restore('size:recall', null)
  const state = {
    query: '',
    page: 1,
    size: pagination.pageSizes.includes(savedSize) ? savedSize : pagination.defaultPageSize,
    results: null,
    loading: false,
    error: null,
  }

  const root = h('div', { class: 'page' })
  container.append(root)
  root.append(pageHead({ title: view.title, sub: tr('recall.subtitle') }))

  let run = () => {}
  const search = searchBox({
    placeholder: tr('recall.placeholder'),
    value: '',
    onEnter: value => { state.query = value; state.page = 1; run() },
    clearable: true,
  })
  search.setAttribute('data-page-search', 'true')
  search.querySelector('.input').style.height = '42px'
  search.querySelector('.input').style.fontSize = '14px'
  const submit = button({ label: tr('common.search'), iconName: 'search', variant: 'primary', onClick: () => { state.query = search.input.value; state.page = 1; run() } })

  const suggestions = [tr('recall.suggest1'), tr('recall.suggest2'), tr('recall.suggest3'), tr('recall.suggest4')]
  const hero = card({
    body: h('div', {},
      h('div', { class: 'flex gap-8', style: { flexWrap: 'wrap' } }, search, submit),
      h('div', { class: 'flex gap-8 mt-8', style: { flexWrap: 'wrap', alignItems: 'center' } },
        h('span', { class: 'faint', style: { fontSize: '12px' } }, tr('recall.try')),
        suggestions.map(suggestion => {
          const chip = h('button', { class: 'chip', type: 'button' }, suggestion)
          chip.addEventListener('click', () => {
            search.input.value = suggestion
            state.query = suggestion
            state.page = 1
            run()
          })
          return chip
        }),
      ),
    ),
  })
  const host = h('div', { class: 'mt-16' })
  root.append(hero, host)

  function renderEmpty() {
    host.replaceChildren(card({
      body: emptyState({
        iconName: 'search',
        title: tr('recall.empty'),
        text: tr('recall.emptyText'),
        action: h('div', { class: 'chips', style: { justifyContent: 'center' } },
          suggestions.map(suggestion => {
            const chip = h('button', { class: 'chip', type: 'button' }, suggestion)
            chip.addEventListener('click', () => {
              search.input.value = suggestion
              state.query = suggestion
              state.page = 1
              run()
            })
            return chip
          }),
        ),
      }),
    }))
  }

  function renderResults() {
    const data = state.results
    if (!data) {
      renderEmpty()
      return
    }
    if (!data.items.length) {
      host.replaceChildren(card({
        body: emptyState({ iconName: 'x-circle', title: tr('recall.noResults'), text: tr('recall.noResultsText') }),
      }))
      return
    }
    const sourceLabel = { bm25: 'BM25', vector: app.locale === 'ru' ? 'вектор' : 'vector', metadata: app.locale === 'ru' ? 'метаданные' : 'metadata' }
    const totalPages = Math.max(1, Math.ceil(data.items.length / state.size))
    const pageItems = data.items.slice((state.page - 1) * state.size, state.page * state.size)
    const list = h('div', { class: 'stack', style: { gap: '10px' } },
      pageItems.map(item => {
        const result = h('div', { class: 'result card' })
        const title = h('div', { class: 'result-title' })
        title.append(highlight(item.title, state.query))
        const score = item.score !== undefined ? h('span', { class: 'badge badge-accent', title: tr('recall.score') }, `${Math.round(item.score * 100)}%`) : null
        const snippet = h('div', { class: 'result-snippet clamp-2' })
        snippet.append(highlight(item.text || '', state.query))
        const sources = (item.sources ?? ['bm25']).map(source => h('span', { class: `badge ${source === 'vector' ? 'badge-accent' : source === 'metadata' ? 'badge-info' : 'badge'}` }, sourceLabel[source] ?? source))
        const meta = h('div', { class: 'result-meta' },
          kindElement(item.kind),
          tierPill(item.tier),
          item.project ? h('span', {}, item.project) : null,
          item.importance ? h('span', {}, `★ ${item.importance}/5`) : null,
          h('span', { class: 'faint' }, agoText(item.updatedAt)),
          h('span', { class: 'result-meta-spacer' }),
          h('span', { class: 'faint', style: { fontSize: '11px' } }, tr('recall.sources')),
          ...sources,
        )
        result.append(h('div', { class: 'result-head' }, title, score), snippet, meta)
        result.tabIndex = 0
        result.setAttribute('role', 'button')
        result.addEventListener('click', () => openEntry(item))
        result.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            openEntry(item)
          }
        })
        return result
      }),
    )
    host.replaceChildren(card({
      title: tr('recall.summary'),
      sub: tr('recall.found', { n: data.items.length }),
      body: h('div', {}, list),
      foot: pager({
        page: state.page,
        pageSize: state.size,
        total: data.items.length,
        pageSizes: pagination.pageSizes,
        onPage: page => {
          state.page = Math.min(Math.max(1, page), totalPages)
          renderResults()
        },
        onPageSize: value => {
          state.size = value
          state.page = 1
          persist('size:recall', value)
          renderResults()
        },
      }),
    }))
  }

  run = async () => {
    if (!state.query.trim()) {
      state.results = null
      renderEmpty()
      return
    }
    state.loading = true
    host.replaceChildren(card({ body: loadingBlock(tr('recall.searching')) }))
    try {
      const data = await app.api.recall(state.query, { limit: 50, project: app.project })
      state.results = { ...data, items: data.items ?? [] }
      state.error = null
      renderResults()
    } catch (error) {
      state.error = error
      host.replaceChildren(card({ body: errorPanel(error, run) }))
      toast({ type: 'error', text: error instanceof Error ? error.message : String(error) })
    } finally {
      state.loading = false
    }
  }

  app.refresh = run
  renderEmpty()
}
