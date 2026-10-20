/** Reusable UI pieces. Every screen is assembled from these, not from one-off markup. */
import { agoText, app, dateText, tr } from './state.js'
import {
  copyText,
  fmtBytes,
  fmtNumber,
  getPath,
  h,
  icon,
  kindElement,
  timeAgo,
} from './util.js'

export function button({
  label,
  iconName,
  variant = '',
  size = '',
  onClick,
  title,
  disabled = false,
  type = 'button',
  class: extraClass = '',
}) {
  const btn = h('button', {
    class: ['btn', variant && `btn-${variant}`, size && `btn-${size}`, extraClass].filter(Boolean).join(' '),
    type,
    title: title ?? label ?? '',
  })
  if (iconName) btn.append(icon(iconName))
  if (label) btn.append(h('span', {}, label))
  if (disabled) btn.disabled = true
  if (onClick) btn.addEventListener('click', event => onClick(event))
  return btn
}

export function iconButton({ iconName, title, onClick, active = false, class: extraClass = '', label }) {
  const btn = h('button', {
    class: ['icon-btn', active && 'on', extraClass].filter(Boolean).join(' '),
    type: 'button',
    title: title ?? '',
    'aria-label': label ?? title ?? iconName,
  })
  btn.append(icon(iconName))
  if (onClick) btn.addEventListener('click', onClick)
  return btn
}

export function pageHead({ title, sub, actions }) {
  return h('div', { class: 'page-head' },
    h('div', { class: 'grow' },
      h('h1', { class: 'page-title' }, title),
      sub ? h('p', { class: 'page-sub' }, sub) : null,
    ),
    actions ? h('div', { class: 'page-actions' }, actions) : null,
  )
}

export function card({ title, sub, actions, body, foot, flush = false, actionsFirst = false, class: extraClass = '' }) {
  const el = h('section', { class: ['card', extraClass].filter(Boolean).join(' ') })
  if (title || actions) {
    const head = h('div', { class: ['card-head', actionsFirst && 'stacked'].filter(Boolean).join(' ') })
    head.append(h('div', { class: 'grow' },
      title ? h('h2', { class: 'card-title' }, title) : null,
      sub ? h('p', { class: 'card-sub' }, sub) : null,
    ))
    if (actions) head.append(h('div', { class: actionsFirst ? 'card-actions' : 'flex items-center gap-8' }, actions))
    el.append(head)
  }
  if (body) el.append(h('div', { class: [`card-body`, flush && 'flush'].filter(Boolean).join(' ') }, body))
  if (foot) el.append(h('div', { class: 'card-foot' }, foot))
  return el
}

export function statCard({ label, value, hint, iconName }) {
  return h('div', { class: 'stat' },
    h('div', { class: 'stat-top' },
      h('span', { class: 'stat-label' }, label),
      iconName ? h('span', { class: 'stat-ico' }, icon(iconName)) : null,
    ),
    h('div', { class: 'stat-value' }, value ?? '—'),
    hint ? h('div', { class: 'stat-hint' }, hint) : null,
  )
}

export function tierPill(tier) {
  const map = { immutable: 'badge-danger', important: 'badge-warn', normal: 'badge' }
  return h('span', { class: `badge ${map[tier] ?? ''}` }, tier ?? '—')
}

export function statusPill(status) {
  const labels = {
    ru: { active: 'активна', superseded: 'забыта', deleted: 'удалена' },
    en: { active: 'active', superseded: 'superseded', deleted: 'deleted' },
  }[app.locale]
  const cls = status === 'active' ? 'badge-ok' : status === 'deleted' ? 'badge-danger' : 'badge'
  return h('span', { class: `badge ${cls}` }, labels[status] ?? status ?? '—')
}

export function tagList(tags) {
  if (!tags?.length) return h('span', { class: 'faint' }, '—')
  return h('div', { class: 'chips' }, tags.map(tag => h('span', { class: 'tag' }, tag)))
}

export function progressBar(percent) {
  const value = Math.max(0, Math.min(100, Number(percent) || 0))
  const track = h('div', { class: 'progress', role: 'progressbar', 'aria-valuenow': String(value), 'aria-valuemin': '0', 'aria-valuemax': '100' })
  const fill = h('span', { style: { width: `${value}%` } })
  track.append(fill)
  return track
}

export function emptyState({ iconName = 'search', title, text, action }) {
  return h('div', { class: 'empty' },
    h('div', { class: 'empty-icon' }, icon(iconName)),
    h('div', { class: 'empty-title' }, title),
    text ? h('p', { class: 'empty-text' }, text) : null,
    action ? h('div', { class: 'empty-action' }, action) : null,
  )
}

export function skeletonTable(rows = 6) {
  return h('div', { class: 'skeleton-block' },
    Array.from({ length: rows }, () => h('div', { class: 'skeleton-line' },
      h('div', { class: 'skeleton' }),
      h('div', { class: 'skeleton w-40' }),
      h('div', { class: 'skeleton w-20' }),
      h('div', { class: 'skeleton w-20' }),
    )),
  )
}

export function loadingBlock(label) {
  return h('div', { class: 'empty' },
    h('div', { class: 'spinner lg', style: { margin: '0 auto 12px' } }),
    h('div', { class: 'empty-text' }, label ?? tr('common.loading')),
  )
}

export function errorPanel(error, retry) {
  const message = error instanceof Error ? error.message : String(error ?? 'Unknown error')
  return h('div', { class: 'error-box' },
    icon('alert'),
    h('div', { class: 'grow' },
      h('div', {}, message),
      retry ? h('div', { class: 'mt-8' }, button({ label: tr('common.retry'), size: 'sm', onClick: retry })) : null,
    ),
  )
}

export function noticeBox(kind, title, text) {
  return h('div', { class: `notice ${kind === 'warn' ? 'warn' : ''}` },
    icon(kind === 'warn' ? 'alert' : 'info'),
    h('div', { class: 'grow' },
      title ? h('div', { style: { fontWeight: '550' } }, title) : null,
      text ? h('div', { class: text || title ? 'mt-0' : '' }, text) : null,
    ),
  )
}

export function searchBox({ placeholder, value = '', onInput, onEnter, autofocus = false, clearable = true, id }) {
  const input = h('input', {
    class: 'input',
    type: 'search',
    placeholder,
    value,
    id,
    'aria-label': placeholder,
    autocomplete: 'off',
    spellcheck: 'false',
  })
  if (onInput) input.addEventListener('input', event => onInput(event.target.value))
  if (onEnter) {
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault()
        onEnter(input.value)
      }
    })
  }
  const wrap = h('div', { class: 'input-wrap grow' }, icon('search'), input)
  if (clearable) {
    const clear = h('button', {
      class: 'icon-btn input-clear',
      type: 'button',
      title: tr('common.clear'),
      'aria-label': tr('common.clear'),
      style: { width: '26px', height: '26px' },
    }, icon('x'))
    clear.addEventListener('click', () => {
      input.value = ''
      input.dispatchEvent(new Event('input'))
      onInput?.('')
      onEnter?.('')
      input.focus()
    })
    wrap.append(clear)
  }
  if (autofocus) requestAnimationFrame(() => input.focus())
  wrap.input = input
  return wrap
}

function defaultCell(column, row) {
  const value = getPath(row, column.path)
  if (column.path === 'title') {
    return h('div', { class: 'cell-title' },
      h('div', { class: 't' }, value ?? '—'),
      h('div', { class: 's' }, row.tags?.length ? row.tags.slice(0, 3).join(' · ') : [row.project, row.scope].filter(Boolean).join(' · ')),
    )
  }
  if (column.path === 'kind') return kindElement(value)
  if (column.path === 'tier') return tierPill(value)
  if (column.path === 'status') return statusPill(value)
  if (column.path === 'importance') return h('span', { class: 'badge' }, `${value ?? 3}/5`)
  if (column.path.endsWith('At')) {
    return h('span', { class: 'muted nowrap', title: dateText(value, true) }, value ? agoText(value) : '—')
  }
  if (column.path === 'sizeBytes' || column.path === 'bytes') return fmtBytes(value)
  if (column.path === 'files') return fmtNumber(value)
  if (column.path === 'name') return h('span', { class: 'mono' }, value ?? '—')
  return value === undefined || value === null || value === '' ? '—' : String(value)
}

export function pager({ page, pageSize, total, pageSizes, onPage, onPageSize }) {
  const pages = Math.max(1, Math.ceil((total || 0) / (pageSize || 1)))
  const current = Math.min(Math.max(1, page), pages)
  const from = total === 0 ? 0 : (current - 1) * pageSize + 1
  const to = Math.min(current * pageSize, total)
  const wrap = h('div', { class: 'table-foot' })
  wrap.append(h('div', { class: 'table-info' }, tr('common.showing', { from, to, total: total ?? 0 })))

  const right = h('div', { class: 'flex items-center gap-12' })
  if (pageSizes?.length && onPageSize) {
    const select = h('select', { class: 'select', 'aria-label': tr('common.pageSize') })
    for (const size of pageSizes) {
      select.append(h('option', { value: String(size), selected: size === pageSize }, String(size)))
    }
    select.addEventListener('change', () => onPageSize(Number(select.value)))
    right.append(h('label', { class: 'page-size' }, tr('common.pageSize'), select))
  }

  const nav = h('div', { class: 'pager' })
  const prev = button({ label: '', iconName: 'chevron-left', size: 'sm', variant: 'ghost', title: tr('common.prev'), disabled: current <= 1 })
  prev.addEventListener('click', () => onPage?.(current - 1))
  nav.append(prev)

  const shown = []
  const start = Math.max(1, Math.min(current - 2, pages - 4))
  const end = Math.min(pages, start + 4)
  for (let index = start; index <= end; index += 1) shown.push(index)
  for (const index of shown) {
    const pageButton = button({ label: String(index), size: 'sm', variant: index === current ? 'primary' : 'ghost' })
    pageButton.addEventListener('click', () => onPage?.(index))
    nav.append(pageButton)
  }

  const next = button({ label: '', iconName: 'chevron-right', size: 'sm', variant: 'ghost', title: tr('common.next'), disabled: current >= pages })
  next.addEventListener('click', () => onPage?.(current + 1))
  nav.append(next)
  right.append(nav)
  wrap.append(right)
  return wrap
}

export function dataTable({
  title,
  sub,
  actions,
  columns,
  rows = [],
  loading = false,
  empty,
  page = 1,
  pageSize,
  total,
  pageSizes,
  onPage,
  onPageSize,
  onRow,
  renderCell,
  hideFoot = false,
  dense = false,
}) {
  let content
  if (loading) {
    content = skeletonTable(6)
  } else if (!rows.length) {
    content = emptyState(empty ?? { title: tr('common.none') })
  } else {
    const head = h('tr', {}, columns.map(column => h('th', { scope: 'col' }, column.label ?? column.path)))
    const body = h('tbody')
    for (const row of rows) {
      const tr = h('tr', { class: onRow ? 'clickable' : '' })
      for (const column of columns) {
        const cell = h('td', { class: column.path === 'title' ? 'cell-title' : '' })
        const rendered = renderCell ? renderCell(row, column) : defaultCell(column, row)
        if (rendered instanceof Node) cell.append(rendered)
        else cell.append(document.createTextNode(rendered === undefined || rendered === null ? '—' : String(rendered)))
        tr.append(cell)
      }
      if (onRow) {
        tr.tabIndex = 0
        tr.addEventListener('click', () => onRow(row))
        tr.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onRow(row)
          }
        })
      }
      body.append(tr)
    }
    const table = h('table', { class: `table${dense ? ' dense' : ''}` }, h('thead', {}, head), body)
    content = h('div', { class: 'table-wrap' }, table)
  }

  const foot = !hideFoot && total !== undefined
    ? pager({ page, pageSize: pageSize ?? total ?? 1, total, pageSizes, onPage, onPageSize })
    : null
  return card({ title, sub, actions, body: content, foot, flush: true })
}

export function searchInput(opts) {
  return searchBox(opts)
}

export function fieldControl(field, value, onChange, { disabled = false } = {}) {
  const type = field.type ?? 'text'
  if (type === 'boolean') {
    const buttonEl = h('button', {
      class: 'switch',
      type: 'button',
      role: 'switch',
      'aria-checked': String(Boolean(value)),
      'aria-label': field.label,
      disabled,
    })
    buttonEl.addEventListener('click', () => {
      const next = buttonEl.getAttribute('aria-checked') !== 'true'
      buttonEl.setAttribute('aria-checked', String(next))
      onChange(next)
    })
    return buttonEl
  }
  if (type === 'select') {
    const select = h('select', { class: 'select', 'aria-label': field.label, disabled })
    for (const option of field.options ?? []) {
      select.append(h('option', { value: option.value, selected: option.value === value }, option.label ?? option.value))
    }
    select.addEventListener('change', () => onChange(select.value))
    return select
  }
  if (type === 'textarea' || type === 'list') {
    const textarea = h('textarea', {
      class: 'textarea',
      'aria-label': field.label,
      rows: type === 'list' ? 4 : 6,
      disabled,
      placeholder: field.hint ?? '',
    })
    textarea.value = Array.isArray(value) ? value.join('\n') : value ?? ''
    textarea.addEventListener('input', () => {
      onChange(type === 'list' ? textarea.value.split('\n').map(line => line.trim()).filter(Boolean) : textarea.value)
    })
    return textarea
  }
  if (type === 'readonly') {
    let text = '—'
    if (Array.isArray(value)) text = value.join(', ') || '—'
    else if (value && typeof value === 'object') {
      const entries = Object.entries(value)
      text = entries.length
        ? entries.map(([key, item]) => `${key}: ${item && typeof item === 'object' ? JSON.stringify(item) : item}`).join(', ')
        : '—'
    } else if (value !== undefined && value !== null) text = String(value)
    return h('span', { class: 'setting-value-readonly' }, text)
  }
  const input = h('input', {
    class: 'input',
    'aria-label': field.label,
    type: type === 'number' ? 'number' : 'text',
    value: value === undefined || value === null ? '' : String(value),
    disabled,
    ...(type === 'number' ? { min: field.min, max: field.max, step: field.step ?? 1 } : {}),
  })
  input.addEventListener('input', () => {
    if (type === 'number') {
      const parsed = input.value === '' ? undefined : Number(input.value)
      onChange(Number.isNaN(parsed) ? undefined : parsed)
    } else {
      onChange(input.value)
    }
  })
  return input
}

export function settingRow(field, value, onChange, { changed = false, disabled = false, restart = false } = {}) {
  const label = h('div', { class: 'setting-label' },
    h('span', {}, field.label),
    restart ? h('span', { class: 'badge badge-warn' }, tr('settings.restart')) : null,
  )
  const hint = field.hint
    ? h('span', { class: 'hint-ico', title: field.hint, 'aria-label': field.hint }, icon('info'))
    : null
  const labelWrap = h('div', {},
    h('div', { class: 'flex items-center gap-6' }, label, hint),
    h('div', { class: 'setting-path' }, field.path),
  )
  return h('div', { class: `setting-row${changed ? ' changed' : ''}` },
    labelWrap,
    h('div', { class: 'setting-control' }, fieldControl(field, value, onChange, { disabled })),
  )
}

export function copyButton(text, label) {
  return iconButton({
    iconName: 'copy',
    title: label ?? tr('common.copy'),
    label: label ?? tr('common.copy'),
    onClick: async () => {
      const ok = await copyText(String(text ?? ''))
      toast({ type: ok ? 'ok' : 'error', text: ok ? tr('toast.copied') : tr('toast.copyFailed') })
    },
  })
}

export function metricLine(label, value) {
  return h('div', { class: 'metric-line' },
    h('span', { class: 'muted' }, label),
    h('span', { class: 'v' }, value ?? '—'),
  )
}

export function toast({ title, text, type = 'info', duration = 4200 }) {
  const stack = document.getElementById('toasts')
  if (!stack) return
  const icons = { info: 'info', ok: 'check-circle', warn: 'alert', error: 'x-circle' }
  const el = h('div', { class: `toast ${type}`, role: 'status' })
  el.append(icon(icons[type] ?? 'info'))
  const body = h('div', { class: 'toast-body' },
    title ? h('div', { class: 'toast-title' }, title) : null,
    text ? h('div', { class: 'toast-text' }, text) : null,
  )
  el.append(body)
  const close = h('button', { class: 'toast-close', type: 'button', 'aria-label': tr('common.close') }, '×')
  close.addEventListener('click', () => el.remove())
  el.append(close)
  stack.append(el)
  if (duration > 0) setTimeout(() => el.remove(), duration)
}

let drawer = null

export function openDrawer({ title, sub, body, actions }) {
  closeDrawer()
  const backdrop = document.getElementById('backdrop')
  const el = h('aside', { class: 'drawer', role: 'dialog', 'aria-modal': 'true', 'aria-label': title })
  const closeButton = iconButton({ iconName: 'x', title: tr('common.close'), onClick: closeDrawer })
  el.append(h('div', { class: 'drawer-head' },
    h('div', { class: 'grow' },
      h('h2', { class: 'drawer-title' }, title),
      sub ? h('div', { class: 'drawer-sub' }, sub) : null,
    ),
    closeButton,
  ))
  el.append(h('div', { class: 'drawer-body' }, body))
  if (actions) el.append(h('div', { class: 'drawer-foot' }, actions))
  document.getElementById('overlays').append(el)
  if (backdrop) {
    backdrop.hidden = false
    requestAnimationFrame(() => {
      backdrop.classList.add('open')
      el.classList.add('open')
    })
  }
  document.body.classList.add('no-scroll')
  drawer = el
}

export function closeDrawer() {
  if (!drawer) return
  const el = drawer
  drawer = null
  el.classList.remove('open')
  const backdrop = document.getElementById('backdrop')
  backdrop?.classList.remove('open')
  document.body.classList.remove('no-scroll')
  setTimeout(() => {
    el.remove()
    if (backdrop && !document.querySelector('.layer, .palette-layer, .drawer.open')) backdrop.hidden = true
  }, 220)
}

export function hasOpenOverlay() {
  return Boolean(document.querySelector('.layer, .palette-layer, .drawer.open'))
}

export function closeOverlays() {
  closeDrawer()
  for (const el of document.querySelectorAll('.layer, .palette-layer')) el.remove()
  const backdrop = document.getElementById('backdrop')
  backdrop?.classList.remove('open')
  if (backdrop) backdrop.hidden = true
  document.body.classList.remove('no-scroll')
}

const closers = []

/**
 * Generic dialog. `onConfirm` may be async; throwing keeps the dialog open and
 * shows the message. `typedWord` requires the exact danger word.
 */
export function openModal({
  title,
  subtitle,
  body,
  confirmText,
  cancelText,
  danger = false,
  typedWord = null,
  onConfirm,
  onClose,
  validate,
  size,
  hideCancel = false,
}) {
  const layer = h('div', { class: 'layer', role: 'presentation' })
  const modal = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title })
  if (size === 'lg') modal.style.width = 'min(620px, 100%)'
  const error = h('div', { class: 'field-error', style: { marginTop: '10px' } })
  const input = typedWord
    ? h('input', { class: 'input confirm-input', type: 'text', autocomplete: 'off', 'aria-label': confirmText ?? 'confirm', placeholder: typedWord })
    : null

  const closeButton = iconButton({ iconName: 'x', title: tr('common.close') })
  const confirmButton = button({
    label: confirmText ?? tr('common.confirm'),
    variant: danger ? 'danger' : 'primary',
  })
  const cancelButton = hideCancel ? null : button({ label: cancelText ?? tr('common.cancel'), variant: 'ghost' })

  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    layer.remove()
    document.body.classList.remove('no-scroll')
    const index = closers.indexOf(api)
    if (index >= 0) closers.splice(index, 1)
    onClose?.()
  }
  const api = { close }

  closeButton.addEventListener('click', close)
  cancelButton?.addEventListener('click', close)
  layer.addEventListener('click', event => {
    if (event.target === layer) close()
  })
  closers.push(api)

  const setBusy = busy => {
    confirmButton.disabled = busy
    if (cancelButton) cancelButton.disabled = busy
    closeButton.disabled = busy
    confirmButton.textContent = ''
    if (busy) confirmButton.append(h('span', { class: 'spinner' }))
    else confirmButton.append(document.createTextNode(confirmText ?? tr('common.confirm')))
  }

  confirmButton.addEventListener('click', async () => {
    error.textContent = ''
    if (typedWord && input.value !== typedWord) {
      error.textContent = tr('common.confirmWord', { word: typedWord })
      input.focus()
      return
    }
    if (validate) {
      const message = validate()
      if (message) {
        error.textContent = message
        return
      }
    }
    try {
      setBusy(true)
      const result = await onConfirm?.({ close, input })
      if (result !== false) close()
    } catch (err) {
      error.textContent = err instanceof Error ? err.message : String(err)
    } finally {
      setBusy(false)
    }
  })

  const head = h('div', { class: 'modal-head' },
    h('div', { class: 'grow' },
      h('h3', { class: 'modal-title' }, title),
      subtitle ? h('p', { class: 'card-sub' }, subtitle) : null,
    ),
    closeButton,
  )
  const bodyEl = h('div', { class: 'modal-body' }, body, typedWord ? input : null, error)
  const foot = h('div', { class: 'modal-foot' }, cancelButton, confirmButton)
  modal.append(head, bodyEl, foot)
  layer.append(modal)
  document.getElementById('overlays').append(layer)
  document.body.classList.add('no-scroll')
  requestAnimationFrame(() => (typedWord ? input : confirmButton).focus())
  return api
}

/** Typed-confirm Promise around openModal: true only on explicit confirmation. */
export function confirmAction({ title, text, word, confirmText, danger = true, body }) {
  return new Promise(resolve => {
    let settled = false
    openModal({
      title,
      body: body ?? h('p', { class: 'muted', style: { margin: 0 } }, text),
      confirmText: confirmText ?? tr('common.confirm'),
      danger,
      typedWord: word ?? null,
      onConfirm: () => {
        settled = true
        resolve(true)
        return true
      },
      onClose: () => {
        if (!settled) resolve(false)
      },
    })
  })
}

/** Escape closes the topmost layer. Returns true when something was closed. */
export function closeTopOverlay() {
  if (closers.length) {
    closers[closers.length - 1].close()
    return true
  }
  if (document.querySelector('.palette-layer')) {
    document.querySelector('.palette-layer').remove()
    if (!document.querySelector('.drawer.open')) document.body.classList.remove('no-scroll')
    return true
  }
  if (drawer) {
    closeDrawer()
    return true
  }
  return false
}

export function actionButton(actionId, onClick, { size = '', variant = '' } = {}) {
  const action = app.sdk.locales[app.locale].actions.find(item => item.id === actionId)
  const label = action?.label ?? actionId
  return button({
    label,
    size,
    variant: variant || (action?.danger ? 'danger' : ''),
    iconName: action?.danger ? 'shield' : 'play',
    title: action?.hint ?? label,
    onClick,
  })
}

export { kindElement, fmtBytes, fmtNumber, timeAgo }
