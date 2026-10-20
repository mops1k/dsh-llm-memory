/** Backups: list, create, verify, typed-confirm restore and delete. */
import { app, dateText, tr, viewDef } from '../state.js'
import {
  button,
  card,
  closeDrawer,
  confirmAction,
  copyButton,
  dataTable,
  emptyState,
  errorPanel,
  metricLine,
  openDrawer,
  openModal,
  pageHead,
  skeletonTable,
  toast,
} from '../ui.js'
import { basename, fmtBytes, h } from '../util.js'

function recordName(record) {
  return record.name ?? basename(record.archive)
}

function backupsDir() {
  return `${app.status?.root ?? '~/.dsh/llm-memory'}/backups`
}

export async function mount(container) {
  const view = viewDef('backup')
  const tableWidget = view.widgets.find(widget => widget.kind === 'table')
  const restoreWord = app.sdk.locales[app.locale].actions.find(action => action.id === 'backup.restore')?.confirm ?? 'RESTORE'
  const deleteWord = app.sdk.locales[app.locale].actions.find(action => action.id === 'backup.delete')?.confirm ?? 'DELETE'

  const root = h('div', { class: 'page' })
  container.append(root)

  let createButton = null
  async function create() {
    if (createButton) createButton.disabled = true
    try {
      const report = await app.api.createBackup()
      toast({ type: 'ok', text: tr('backup.created'), duration: 5000 })
      if (report?.archive) toast({ type: 'info', text: report.archive })
      await load()
    } catch (error) {
      toast({ type: 'error', title: tr('backup.failed'), text: error instanceof Error ? error.message : String(error) })
    } finally {
      if (createButton) createButton.disabled = false
    }
  }

  createButton = button({ label: tr('backup.create'), iconName: 'plus', variant: 'primary', onClick: create })
  root.append(pageHead({ title: view.title, sub: tr('backup.subtitle'), actions: createButton }))

  const dirLine = h('div', { class: 'notice', style: { marginBottom: '14px' } },
    h('div', { class: 'grow flex items-center gap-8' },
      h('span', { class: 'truncate mono', title: backupsDir() }, `${tr('backup.dir')}: ${backupsDir()}`),
    ),
    copyButton(backupsDir()),
  )
  root.append(dirLine)
  const host = h('div')
  root.append(host)

  async function verify(record) {
    try {
      const report = await app.api.verifyBackup(recordName(record))
      toast({ type: 'ok', text: tr('backup.verifyDone') })
      openModal({
        title: tr('backup.verifyTitle'),
        confirmText: tr('common.close'),
        hideCancel: true,
        body: h('div', {},
          metricLine('archive', report?.archive ?? recordName(record)),
          metricLine('ok', String(report?.ok ?? true)),
          metricLine('errors', String(report?.errors?.length ?? 0)),
          metricLine('manifest', String(report?.manifest ?? '—')),
        ),
        onConfirm: () => true,
      })
    } catch (error) {
      toast({ type: 'error', title: tr('backup.failed'), text: error instanceof Error ? error.message : String(error) })
    }
  }

  async function restore(record) {
    const ok = await confirmAction({
      title: tr('backup.restoreTitle'),
      text: tr('backup.restoreText'),
      word: restoreWord,
      confirmText: tr('common.restore'),
    })
    if (!ok) return
    try {
      await app.api.restoreBackup(recordName(record))
      toast({ type: 'ok', text: tr('backup.restoreDone'), duration: 5000 })
      closeDrawer()
      await load()
    } catch (error) {
      toast({ type: 'error', title: tr('backup.failed'), text: error instanceof Error ? error.message : String(error) })
    }
  }

  async function remove(record) {
    const ok = await confirmAction({
      title: tr('backup.deleteTitle'),
      text: tr('backup.deleteText'),
      word: deleteWord,
      confirmText: tr('common.delete'),
    })
    if (!ok) return
    try {
      await app.api.deleteBackup(recordName(record))
      toast({ type: 'ok', text: tr('backup.deleted') })
      closeDrawer()
      await load()
    } catch (error) {
      toast({ type: 'error', title: tr('backup.failed'), text: error instanceof Error ? error.message : String(error) })
    }
  }

  function openBackup(record) {
    const name = recordName(record)
    const actions = h('div', { class: 'flex gap-6' },
      copyButton(`${backupsDir()}/${name}`),
      button({ label: tr('common.verify'), size: 'sm', onClick: () => verify(record) }),
      button({ label: tr('common.restore'), size: 'sm', variant: 'danger', onClick: () => restore(record) }),
      button({ label: tr('common.delete'), size: 'sm', variant: 'danger', onClick: () => remove(record) }),
    )
    openDrawer({
      title: name,
      sub: `${dateText(record.createdAt, true)} · ${fmtBytes(record.sizeBytes ?? record.bytes)}`,
      body: h('div', {},
        metricLine('archive', h('span', { class: 'mono' }, name)),
        metricLine(tr('common.date'), dateText(record.createdAt, true)),
        metricLine(tr('common.size'), fmtBytes(record.sizeBytes ?? record.bytes)),
        metricLine('harness', record.harness ?? '—'),
        metricLine('schemaVersion', record.schemaVersion ?? '—'),
        metricLine(tr('backup.encrypted'), record.encrypted ? tr('common.ok') : tr('common.off')),
        metricLine(tr('backup.dir'), backupsDir()),
      ),
      actions,
    })
  }

  async function load() {
    host.replaceChildren(card({ body: skeletonTable(4) }))
    try {
      const list = await app.api.backups()
      if (!list.length) {
        host.replaceChildren(card({
          body: emptyState({
            iconName: 'archive',
            title: tr('backup.empty'),
            text: tr('backup.emptyText'),
            action: button({ label: tr('backup.create'), iconName: 'plus', variant: 'primary', onClick: create }),
          }),
        }))
        return
      }
      host.replaceChildren(dataTable({
        title: `${tr('nav.backup')} · ${list.length}`,
        sub: tr('backup.rowHint'),
        columns: tableWidget.columns,
        rows: list,
        hideFoot: true,
        onRow: openBackup,
        renderCell: (row, column) => {
          if (column.path === 'name') {
            return h('div', { class: 'flex items-center gap-8' },
              h('span', { class: 'mono' }, recordName(row)),
              row.encrypted ? h('span', { class: 'badge badge-accent' }, tr('backup.encrypted')) : null,
            )
          }
          if (column.path === 'createdAt') return h('span', { class: 'muted' }, dateText(row.createdAt, true))
          if (column.path === 'sizeBytes') return fmtBytes(row.sizeBytes ?? row.bytes)
          return String(row[column.path] ?? '—')
        },
      }))
    } catch (error) {
      host.replaceChildren(card({ body: errorPanel(error, load) }))
    }
  }

  app.refresh = load
  await load()
}
