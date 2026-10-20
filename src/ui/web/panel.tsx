/**
 * Schema-driven panel: navigation and every screen come from the core UI
 * snapshot, so Kilo, OpenCode and MCP render the same screens with their own
 * design (ADR-004). Data operations are ordinary host requests.
 */
import * as React from 'react'

import type { UiHost } from '../headless/host.js'
import { createTranslator } from '../headless/i18n.js'
import { themeVars } from './styles.js'
import {
  payloadBody,
  payloadRows,
  type PanelSnapshot,
  type SettingsSnapshotResponse,
  type UISettingsAction,
  type UISettingsGroup,
  type UIView,
} from './types.js'
import {
  ActionBar,
  EditorForm,
  GraphView,
  Loading,
  ReportView,
  SearchBar,
  SettingsForm,
  StatsView,
  TableView,
  VectorMapView,
} from './widgets.js'

export interface MemoryPanelProps {
  host: UiHost
  snapshot: PanelSnapshot
  /** Used by tests to render a screen without fetching. */
  initialView?: string
}

interface SettingsState {
  groups: readonly UISettingsGroup[]
  values: Record<string, unknown>
  unsupported: string[]
}

function settingsFromPayload(payload: SettingsSnapshotResponse): SettingsState {
  const nested = payload.snapshot
  return {
    groups: nested?.groups ?? payload.groups ?? [],
    values: (nested?.values ?? payload.values ?? {}) as Record<string, unknown>,
    unsupported: payload.unsupported ?? [],
  }
}

function actionInput(id: string, action: UISettingsAction | undefined): Record<string, unknown> | undefined {
  if (id === 'heal.apply') return { mode: 'apply-safe' }
  if (id === 'heal.report') return { mode: 'report' }
  if (id === 'backup.verify' || id === 'backup.restore' || id === 'backup.delete') {
    const name = typeof window !== 'undefined' ? window.prompt('Archive file name') : null
    if (!name) return undefined
    const input: Record<string, unknown> = { name }
    if (action?.confirm) {
      const confirm = typeof window !== 'undefined' ? window.prompt(`Type ${action.confirm}`) : null
      if (confirm !== action.confirm) return undefined
      input['confirm'] = confirm
    }
    return input
  }
  return undefined
}

export function MemoryPanel({ host, snapshot, initialView }: MemoryPanelProps): React.ReactElement {
  const t = createTranslator(host.locale())
  const views = snapshot.views.filter(view => view.id !== 'map')
  const [viewId, setViewId] = React.useState<string>(initialView ?? views[0]?.id ?? snapshot.views[0]?.id ?? 'overview')
  const view = snapshot.views.find(item => item.id === viewId) ?? snapshot.views[0]
  const [data, setData] = React.useState<Record<string, unknown>>({})
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [notice, setNotice] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState<number | undefined>(undefined)
  const [query, setQuery] = React.useState('')
  const [queryDraft, setQueryDraft] = React.useState('')
  const [selected, setSelected] = React.useState<Record<string, unknown> | undefined>(undefined)
  const [settings, setSettings] = React.useState<SettingsState>({ groups: [], values: {}, unsupported: [] })
  const [dirty, setDirty] = React.useState<Record<string, string | number | boolean>>({})
  const [revision, setRevision] = React.useState(0)

  React.useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      if (!view) return
      setLoading(true)
      setError(null)
      try {
        const next: Record<string, unknown> = {}
        for (const widget of view.widgets) {
          if (widget.kind === 'form') {
            const payload = await host.request<SettingsSnapshotResponse>('settings.snapshot')
            if (cancelled) return
            next[widget.source.operation] = payload
            setSettings(settingsFromPayload(payload))
            setDirty({})
            continue
          }
          if (!('source' in widget) || !widget.source) continue
          const input: Record<string, unknown> = { ...widget.source.params }
          if (widget.kind === 'table' || widget.kind === 'search') {
            const size = pageSize ?? widget.pagination?.defaultPageSize
            if (size !== undefined) input['limit'] = size
            if (size !== undefined) input['offset'] = (page - 1) * size
            if (query.length > 0) input['query'] = query
          }
          if (widget.kind === 'vector-map') input['refresh'] = '1'
          next[widget.source.operation] = await host.request(widget.source.operation, input)
        }
        if (!cancelled) setData(next)
      } catch (failure) {
        if (!cancelled) setError(failure instanceof Error ? failure.message : String(failure))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [host, viewId, page, pageSize, query, revision])

  const reload = (): void => setRevision(value => value + 1)

  const runSettingsSave = async (): Promise<void> => {
    setBusy(true)
    setNotice(null)
    try {
      const patch: Record<string, unknown> = { ...dirty }
      await host.request('settings.save', patch)
      setNotice(t.t('settings.saved'))
      setDirty({})
      reload()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }

  const changeLocale = async (locale: 'en' | 'ru'): Promise<void> => {
    setBusy(true)
    try {
      await host.request('ui.locale.set', { uiLocale: locale })
      if (typeof location !== 'undefined') location.reload()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
      setBusy(false)
    }
  }

  const runAction = async (id: string): Promise<void> => {
    const action = snapshot.actions.find(item => item.id === id)
    const input = actionInput(id, action)
    if (action?.confirm && id !== 'backup.verify' && input === undefined) return
    setBusy(true)
    setNotice(null)
    try {
      const result = await host.request(`action.${id}`, input)
      const payload = payloadBody(result)
      if (typeof payload === 'string') setNotice(payload.slice(0, 400))
      else setNotice(JSON.stringify(payload).slice(0, 400))
      reload()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }

  const loadEntry = async (id: string): Promise<void> => {
    setBusy(true)
    try {
      const result = await host.request('items.get', { id })
      setSelected((payloadBody(result) ?? {}) as Record<string, unknown>)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }

  const saveEntry = async (values: Record<string, unknown>): Promise<void> => {
    setBusy(true)
    setNotice(null)
    try {
      const id = typeof values['id'] === 'string' ? values['id'] : ''
      if (id.length > 0) await host.request('items.update', values)
      else await host.request('items.save', values)
      setNotice(t.t('settings.saved'))
      setSelected(undefined)
      reload()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }

  const forgetEntry = async (id: string): Promise<void> => {
    setBusy(true)
    try {
      await host.request('items.forget', { id })
      setSelected(undefined)
      setNotice(t.t('settings.saved'))
      reload()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }

  const deleteEntry = async (id: string): Promise<void> => {
    const confirm = typeof window !== 'undefined' ? window.prompt('Type DELETE') : null
    if (confirm !== 'DELETE') return
    setBusy(true)
    try {
      await host.request('items.delete', { id, confirm })
      setSelected(undefined)
      setNotice(t.t('settings.saved'))
      reload()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }

  const renderWidget = (widget: UIView['widgets'][number], index: number): React.ReactNode => {
    switch (widget.kind) {
      case 'stats':
        return <StatsView key={index} t={t} metrics={widget.metrics} payload={data[widget.source.operation]} />
      case 'table':
      case 'search': {
        const payload = data[widget.source.operation]
        const rows = payloadRows(payload)
        const total =
          payload !== null && typeof payload === 'object' && typeof (payload as Record<string, unknown>)['total'] === 'number'
            ? Number((payload as Record<string, unknown>)['total'])
            : undefined
        return (
          <React.Fragment key={index}>
            {widget.kind === 'search' ? (
              <SearchBar
                t={t}
                value={queryDraft}
                onChange={setQueryDraft}
                onSubmit={() => {
                  setPage(1)
                  setQuery(queryDraft.trim())
                }}
              />
            ) : null}
            <TableView
              t={t}
              columns={widget.columns}
              rows={rows}
              {...(widget.pagination ? { pagination: widget.pagination } : {})}
              page={page}
              {...(pageSize !== undefined ? { pageSize } : {})}
              {...(total !== undefined ? { total } : {})}
              onPage={setPage}
              onPageSize={size => {
                setPageSize(size)
                setPage(1)
              }}
              onOpen={id => {
                setViewId('editor')
                void loadEntry(id)
              }}
            />
          </React.Fragment>
        )
      }
      case 'graph':
        return <GraphView key={index} t={t} payload={data[widget.source.operation]} />
      case 'report':
        return <ReportView key={index} t={t} payload={data[widget.source.operation]} />
      case 'form':
        return (
          <SettingsForm
            key={index}
            t={t}
            groups={settings.groups}
            values={settings.values}
            unsupported={settings.unsupported}
            dirty={dirty}
            busy={busy}
            locale={host.locale()}
            onLocale={locale => void changeLocale(locale)}
            onChange={(path, value) => setDirty(previous => ({ ...previous, [path]: value }))}
            onSave={() => void runSettingsSave()}
          />
        )
      case 'actions':
        return (
          <ActionBar
            key={index}
            t={t}
            ids={widget.actions}
            actions={snapshot.actions}
            busy={busy}
            onRun={id => void runAction(id)}
          />
        )
      case 'editor':
        return (
          <EditorForm
            key={index}
            t={t}
            fields={widget.fields}
            {...(selected !== undefined ? { item: selected } : {})}
            busy={busy}
            onLoad={id => void loadEntry(id)}
            onSave={values => void saveEntry(values)}
            onForget={id => void forgetEntry(id)}
            onDelete={id => void deleteEntry(id)}
          />
        )
      case 'vector-map':
        return <VectorMapView key={index} t={t} payload={data[widget.source.operation]} />
      default:
        return null
    }
  }

  return (
    <div className="lm-app" data-host={host.kind} style={themeVars(host.theme()) as unknown as React.CSSProperties}>
      <header className="lm-head">
        <strong>LLM Memory</strong>
        <span className="lm-meta">{host.kind}</span>
        <span className="lm-spacer" />
        <button type="button" className="lm-btn" disabled={loading} onClick={reload}>
          {t.t('panel.refresh')}
        </button>
      </header>
      <nav className="lm-nav">
        {snapshot.views.map(item => (
          <button
            key={item.id}
            type="button"
            aria-current={item.id === viewId ? 'page' : undefined}
            onClick={() => {
              setViewId(item.id)
              setPage(1)
              setQuery('')
              setQueryDraft('')
            }}
          >
            {item.title}
          </button>
        ))}
      </nav>
      <main className="lm-screen" aria-busy={loading}>
        <h2>{view?.title}</h2>
        {error ? <p className="lm-error">{t.t('panel.failed')}: {error}</p> : null}
        {notice ? <p className="lm-ok">{notice}</p> : null}
        {loading ? <Loading t={t} /> : null}
        {!loading && view ? view.widgets.map((widget, index) => renderWidget(widget, index)) : null}
      </main>
    </div>
  )
}
