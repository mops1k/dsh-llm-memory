/** Entry drawer shared by the table, the palette, the graph and the map. */
import { navigate } from '../router.js'
import { app, dateText, tr } from '../state.js'
import {
  closeDrawer,
  confirmAction,
  copyButton,
  kindElement,
  openDrawer,
  statusPill,
  tagList,
  tierPill,
  toast,
} from '../ui.js'
import { h } from '../util.js'
import { refreshCurrent } from './shared.js'

function meta(label, value) {
  return h('div', {}, h('div', { class: 'k' }, label), h('div', { class: 'v' }, value ?? '—'))
}

function idChip(id, onClick) {
  const chip = h('button', { class: 'chip', type: 'button', title: id }, id.slice(0, 12))
  chip.addEventListener('click', () => onClick(id))
  return chip
}

export async function openEntry(input) {
  let entry = input
  if (typeof input === 'string') {
    try {
      entry = await app.api.item(input)
    } catch (error) {
      toast({ type: 'error', text: error instanceof Error ? error.message : String(error) })
      return
    }
  }
  if (!entry) return
  if (entry.text === undefined && entry.id) {
    try {
      entry = await app.api.item(entry.id)
    } catch {
      // keep the list payload; the drawer still shows metadata
    }
  }

  const body = h('div', {},
    h('p', { class: 'prose', style: { marginTop: 0 } }, entry.text || tr('entry.noText')),
    h('div', { class: 'meta-grid' },
      meta(tr('entry.project'), entry.project || '—'),
      meta(tr('entry.scope'), entry.scope),
      meta(tr('entry.kind'), kindElement(entry.kind)),
      meta(tr('entry.tier'), tierPill(entry.tier)),
      meta(tr('entry.importance'), `${entry.importance ?? 3}/5`),
      meta(tr('common.status'), statusPill(entry.status)),
      meta(tr('entry.created'), dateText(entry.createdAt, true)),
      meta(tr('entry.updated'), dateText(entry.updatedAt, true)),
    ),
    h('div', { class: 'mt-16' }, h('div', { class: 'k faint', style: { fontSize: '10.5px', textTransform: 'uppercase', letterSpacing: '.05em' } }, tr('entry.tags')), h('div', { class: 'mt-8' }, tagList(entry.tags))),
    entry.keywords
      ? h('div', { class: 'mt-12' }, h('div', { class: 'k faint', style: { fontSize: '10.5px', textTransform: 'uppercase', letterSpacing: '.05em' } }, tr('entry.keywords')), h('div', { class: 'mt-8 mono' }, entry.keywords))
      : null,
    entry.supersedes?.length
      ? h('div', { class: 'mt-12' }, h('div', { class: 'faint', style: { fontSize: '11.5px' } }, tr('entry.supersedes')), h('div', { class: 'chips mt-8' }, entry.supersedes.map(id => idChip(id, openEntry))))
      : null,
    entry.supersededBy?.length
      ? h('div', { class: 'mt-12' }, h('div', { class: 'faint', style: { fontSize: '11.5px' } }, tr('entry.supersededBy')), h('div', { class: 'chips mt-8' }, entry.supersededBy.map(id => idChip(id, openEntry))))
      : null,
    h('div', { class: 'mt-16 faint mono', style: { fontSize: '11px' } }, `ID: ${entry.id}`),
  )

  const edit = h('button', { class: 'btn btn-primary btn-sm', type: 'button' }, tr('entry.edit'))
  edit.addEventListener('click', () => {
    closeDrawer()
    navigate('editor', { id: entry.id })
  })

  const forget = h('button', { class: 'btn btn-sm', type: 'button' }, tr('entry.forget'))
  forget.addEventListener('click', async () => {
    const ok = await confirmAction({
      title: tr('entry.forgetTitle'),
      text: tr('entry.forgetText'),
      danger: false,
      confirmText: tr('entry.forget'),
    })
    if (!ok) return
    try {
      await app.api.forgetEntry(entry.id)
      closeDrawer()
      toast({ type: 'ok', text: tr('entry.forgotten') })
      refreshCurrent()
    } catch (error) {
      toast({ type: 'error', text: error instanceof Error ? error.message : String(error) })
    }
  })

  const remove = h('button', { class: 'btn btn-sm btn-danger', type: 'button' }, tr('entry.delete'))
  remove.addEventListener('click', async () => {
    const ok = await confirmAction({
      title: tr('entry.deleteTitle'),
      text: tr('entry.deleteText'),
      word: 'DELETE',
      confirmText: tr('entry.delete'),
    })
    if (!ok) return
    try {
      await app.api.deleteEntry(entry.id)
      closeDrawer()
      toast({ type: 'ok', text: tr('entry.deleted') })
      refreshCurrent()
    } catch (error) {
      toast({ type: 'error', text: error instanceof Error ? error.message : String(error) })
    }
  })

  openDrawer({
    title: entry.title,
    sub: h('div', { class: 'flex items-center gap-8' },
      kindElement(entry.kind),
      tierPill(entry.tier),
      statusPill(entry.status),
      entry.project ? h('span', { class: 'faint' }, entry.project) : null,
    ),
    body,
    actions: [copyButton(entry.id, tr('common.copy')), forget, remove, edit],
  })
}
