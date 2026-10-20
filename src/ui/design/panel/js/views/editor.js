/** Entry editor: fields exactly as the SDK editor widget declares them. */
import { navigate } from '../router.js'
import { app, tr, viewDef } from '../state.js'
import {
  button,
  card,
  confirmAction,
  errorPanel,
  fieldControl,
  loadingBlock,
  pageHead,
  toast,
} from '../ui.js'
import { h } from '../util.js'

const TRACKED = ['title', 'text', 'kind', 'tier', 'importance', 'tags', 'keywords']

function tracked(draft) {
  return JSON.stringify(Object.fromEntries(TRACKED.map(key => [key, draft[key] ?? null])))
}

export async function mount(container) {
  const view = viewDef('editor')
  const editorWidget = view.widgets.find(widget => widget.kind === 'editor')
  const isNew = app.params.new === '1' || !app.params.id
  const project = app.project === 'all' ? '' : app.project

  const root = h('div', { class: 'page' })
  container.append(root)

  let draft
  let initial
  let titleError = null
  let saveButton = null
  let discardButton = null
  let dirtyBar = null
  let controls = []

  if (isNew) {
    draft = {
      title: '',
      text: '',
      kind: 'facts',
      tier: 'normal',
      importance: 3,
      tags: [],
      keywords: '',
      project,
      scope: 'project',
    }
  } else {
    root.append(loadingBlock())
    try {
      const item = await app.api.item(app.params.id)
      draft = { ...item }
    } catch (error) {
      root.replaceChildren(pageHead({ title: view.title, sub: tr('editor.subtitleEdit') }), errorPanel(error, () => mount(container)))
      return
    }
    root.replaceChildren()
  }
  initial = tracked(draft)

  const isDirty = () => tracked(draft) !== initial

  function updateDirtyState() {
    const dirty = isDirty()
    if (dirtyBar) dirtyBar.style.display = dirty ? '' : 'none'
    if (saveButton) saveButton.disabled = !dirty
    if (discardButton) discardButton.disabled = !dirty
  }

  async function save() {
    if (!String(draft.title ?? '').trim()) {
      if (titleError) titleError.textContent = tr('editor.titleRequired')
      const input = root.querySelector('input[aria-label="' + (editorWidget.fields[0].label) + '"]')
      input?.focus()
      return
    }
    if (saveButton) saveButton.disabled = true
    try {
      const saved = await app.api.saveItem({
        ...draft,
        title: String(draft.title).trim(),
        project: draft.project ?? project,
        scope: draft.scope ?? 'project',
      })
      toast({ type: 'ok', text: isNew ? tr('editor.created') : tr('editor.updated') })
      void saved
      navigate('items')
    } catch (error) {
      toast({ type: 'error', text: error instanceof Error ? error.message : String(error) })
      updateDirtyState()
    }
  }

  async function discard() {
    if (!isDirty()) {
      navigate('items')
      return
    }
    const ok = await confirmAction({ title: tr('editor.discardTitle'), text: tr('editor.discardText'), danger: false, confirmText: tr('common.discard') })
    if (ok) navigate('items')
  }

  const back = button({ label: tr('editor.back'), iconName: 'chevron-left', variant: 'ghost', onClick: discard })
  saveButton = button({ label: tr('common.save'), variant: 'primary', disabled: true, onClick: save })

  root.append(pageHead({
    title: isNew ? tr('palette.newEntry') : view.title,
    sub: isNew ? tr('editor.subtitleNew') : tr('editor.subtitleEdit'),
    actions: [back, saveButton],
  }))

  dirtyBar = h('div', { class: 'savebar accent', style: { display: 'none' } },
    h('span', { class: 'grow' }, tr('editor.dirty')),
    button({ label: tr('common.reset'), variant: 'ghost', size: 'sm', onClick: () => { draft = JSON.parse(initial); rerender() } }),
    button({ label: tr('common.save'), variant: 'primary', size: 'sm', onClick: save }),
  )
  root.append(dirtyBar)

  if (project) root.append(h('div', { class: 'notice', style: { marginBottom: '12px' } }, h('div', { class: 'grow' }, tr('editor.projectNote', { project }))))

  const formHost = h('div')
  root.append(formHost)

  function rerender() {
    // Rebuild only the controls from the draft, keeping the screen structure.
    const rows = h('div', {})
    controls = []
    for (const field of editorWidget.fields) {
      const control = fieldControl(field, draft[field.path], value => {
        draft[field.path] = value
        if (field.path === 'title' && titleError) titleError.textContent = ''
        updateDirtyState()
      })
      controls.push({ field, control })
      const error = field.path === 'title' ? h('div', { class: 'field-error' }) : null
      if (field.path === 'title') titleError = error
      rows.append(h('div', { class: 'setting-row' },
        h('div', {},
          h('div', { class: 'setting-label' }, field.label),
        ),
        h('div', { class: 'setting-control' }, control, error),
      ))
    }
    const form = card({ body: rows, flush: true })
    formHost.replaceChildren(form)
    updateDirtyState()
  }

  // Initial draft may carry an old title in the form header: rebuild on every change is too
  // expensive, so the header stays stable while the fields keep their own state.
  rerender()
  discardButton = dirtyBar.querySelector('button')
  updateDirtyState()
  app.refresh = () => void 0
}
