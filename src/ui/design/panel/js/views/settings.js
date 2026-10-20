/** Settings: groups and fields exactly as the SDK settings snapshot declares them. */
import { app, sdk, tr, viewDef } from '../state.js'
import {
  button,
  card,
  emptyState,
  noticeBox,
  pageHead,
  searchBox,
  settingRow,
  toast,
} from '../ui.js'
import { h } from '../util.js'

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

export async function mount(container) {
  const view = viewDef('settings')
  const groups = sdk().settingsGroups
  let original = clone(app.sdk.values)
  let values = app.settingsDraft ? clone(app.settingsDraft) : clone(original)
  let query = ''
  const rowByPath = new Map()
  let savebar = null
  let formHost = null
  let search = null

  app.settingsDraft = values
  const allFields = groups.flatMap(group => group.fields)
  const fieldCount = allFields.length

  const root = h('div', { class: 'page' })
  container.append(root)

  const readonly = app.api.settingsReadonly
  root.append(pageHead({
    title: view.title,
    sub: tr('settings.subtitle'),
    actions: h('span', { class: 'badge' }, tr('settings.groupsCount', { n: groups.length, f: fieldCount })),
  }))

  if (readonly) {
    root.append(h('div', { class: 'mb-12' }, noticeBox('warn', tr('settings.liveReadonly'))))
  }

  search = searchBox({
    placeholder: tr('settings.searchPlaceholder'),
    onInput: value => { query = value; renderForm() },
  })
  search.setAttribute('data-page-search', 'true')
  const toolbar = h('div', { class: 'settings-toolbar' }, search)
  formHost = h('div')
  root.append(toolbar, formHost)

  function changedCount() {
    return allFields.filter(field => !same(values[field.path], original[field.path])).length
  }

  function updateSavebar() {
    if (!savebar) return
    const count = changedCount()
    savebar.style.display = count ? '' : 'none'
    savebar.querySelector('.count').textContent = tr('settings.changed', { n: count })
  }

  async function save() {
    const patch = {}
    for (const field of allFields) {
      if (!same(values[field.path], original[field.path])) patch[field.path] = values[field.path]
    }
    if (!Object.keys(patch).length) return
    try {
      await app.api.updateSettings(patch)
      app.sdk.values = clone(values)
      app.settingsDraft = clone(values)
      original = clone(values)
      for (const [path, row] of rowByPath) {
        const changed = !same(values[path], original[path])
        row.classList.toggle('changed', changed)
      }
      updateSavebar()
      toast({ type: 'ok', text: app.mode === 'demo' ? tr('toast.settingsDemo') : tr('settings.saved') })
    } catch (error) {
      toast({ type: 'error', title: tr('settings.notSaved'), text: error instanceof Error ? error.message : String(error) })
    }
  }

  function reset() {
    values = clone(original)
    app.settingsDraft = clone(values)
    renderForm()
    toast({ type: 'info', text: tr('settings.resetDone') })
  }

  savebar = h('div', { class: 'savebar accent', style: { display: 'none' } },
    h('span', { class: 'grow' }, h('strong', { class: 'count' }, '')),
    h('span', { class: 'faint', style: { fontSize: '12px' } }, tr('settings.dirtyHint')),
    button({ label: tr('settings.reset'), variant: 'ghost', size: 'sm', onClick: reset }),
    button({ label: tr('settings.save'), variant: 'primary', size: 'sm', onClick: save, disabled: readonly }),
  )
  root.append(savebar)

  function renderForm() {
    rowByPath.clear()
    const needle = query.trim().toLowerCase()
    const blocks = []
    for (const group of groups) {
      const fields = group.fields.filter(field => {
        if (!needle) return true
        return [field.label, field.path, field.hint].some(text => String(text ?? '').toLowerCase().includes(needle))
      })
      if (!fields.length) continue
      const rows = fields.map(field => {
        const row = settingRow(field, values[field.path], value => {
          values[field.path] = value
          app.settingsDraft = values
          const changed = !same(values[field.path], original[field.path])
          row.classList.toggle('changed', changed)
          updateSavebar()
        }, {
          changed: !same(values[field.path], original[field.path]),
          disabled: readonly,
          restart: field.restartRequired,
        })
        rowByPath.set(field.path, row)
        return row
      })
      blocks.push(card({ title: group.title, sub: `${fields.length} ${tr('settings.fields')}`, body: h('div', {}, rows), flush: true }))
    }
    if (!blocks.length) {
      formHost.replaceChildren(card({
        body: emptyState({ iconName: 'sliders', title: tr('settings.noMatch'), text: tr('settings.searchPlaceholder') }),
      }))
    } else {
      formHost.replaceChildren(h('div', { class: 'stack', style: { gap: '18px' } }, blocks))
    }
    updateSavebar()
  }

  renderForm()
  app.refresh = renderForm
}
