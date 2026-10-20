/**
 * Schema-driven panel: navigation and every screen come from the core UI
 * snapshot, rendered in the accepted shared design (ADR-004). Data operations
 * are ordinary host requests; the CSS and markup are the same as the
 * Kilo/OpenCode page.
 */
import * as React from 'react'

import type { UiHost } from '../headless/host.js'
import { createTranslator, type MessageKey } from '../headless/i18n.js'
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
  Button,
  Card,
  EditorForm,
  ErrorBox,
  GraphView,
  Icon,
  Loading,
  PageHead,
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

type ThemePref = 'system' | 'light' | 'dark'

const NAV_GROUPS: readonly { label: MessageKey | null; ids: readonly string[] }[] = [
  { label: null, ids: ['overview'] },
  { label: 'nav.group.data', ids: ['items', 'recall'] },
  { label: 'nav.group.analysis', ids: ['graph', 'map'] },
  { label: 'nav.group.system', ids: ['health', 'settings', 'backup', 'model'] },
]

const VIEW_ICONS: Record<string, string> = {
  overview: 'grid',
  items: 'list',
  recall: 'search',
  graph: 'graph',
  map: 'map',
  health: 'pulse',
  settings: 'sliders',
  backup: 'archive',
  model: 'cpu',
  editor: 'edit',
}

const THEME_ORDER: readonly ThemePref[] = ['system', 'light', 'dark']
const THEME_ICON: Record<ThemePref, string> = { system: 'monitor', light: 'sun', dark: 'moon' }

function themeKey(kind: string): string {
  return `llm-memory:${kind}:theme`
}

function readThemePref(kind: string): ThemePref {
  if (typeof localStorage === 'undefined') return 'system'
  try {
    const value = localStorage.getItem(themeKey(kind))
    return value === 'light' || value === 'dark' || value === 'system' ? value : 'system'
  } catch {
    return 'system'
  }
}

function resolvedTheme(pref: ThemePref): 'light' | 'dark' {
  if (pref !== 'system') return pref
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
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

function viewSubtitle(view: UIView): MessageKey | undefined {
  const key = `view.${view.id}.subtitle`
  return key as MessageKey
}

export function MemoryPanel({ host, snapshot, initialView }: MemoryPanelProps): React.ReactElement {
  const t = createTranslator(host.locale())
  const views = snapshot.views
  const [viewId, setViewId] = React.useState<string>(initialView ?? views[0]?.id ?? 'overview')
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
  const [menuOpen, setMenuOpen] = React.useState(false)
  const [themePref, setThemePref] = React.useState<ThemePref>(() => readThemePref(host.kind))

  React.useEffect(() => {
    if (typeof document === 'undefined') return
    document.documentElement.dataset['theme'] = resolvedTheme(themePref)
    document.documentElement.dataset['themePref'] = themePref
    try {
      localStorage.setItem(themeKey(host.kind), themePref)
    } catch {
      // Storage can be unavailable (private mode); the theme still applies.
    }
  }, [themePref, host.kind])

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
          if (widget.kind === 'vector-map' && widget.extra) {
            for (const extra of widget.extra) {
              next[extra.operation] = await host.request(extra.operation, { ...extra.params })
            }
          }
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
  }, [host, view, page, pageSize, query, revision])

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

  const openEntry = (id: string): void => {
    setViewId('editor')
    setPage(1)
    setQuery('')
    setQueryDraft('')
    setMenuOpen(false)
    void loadEntry(id)
  }

  const openEditor = (): void => {
    setSelected(undefined)
    setViewId('editor')
    setPage(1)
    setMenuOpen(false)
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

  const selectView = (id: string): void => {
    setViewId(id)
    setPage(1)
    setQuery('')
    setQueryDraft('')
    setMenuOpen(false)
  }

  const navGroups = React.useMemo(() => {
    const known = new Set(NAV_GROUPS.flatMap(group => group.ids))
    const extra = snapshot.views
      .filter(item => !known.has(item.id) && item.id !== 'editor')
      .map(item => item.id)
      .map(id => snapshot.views.find(item => item.id === id))
      .filter((item): item is UIView => item !== undefined)
    const groups = NAV_GROUPS.map(group => ({
      label: group.label,
      views: group.ids
        .map(id => snapshot.views.find(item => item.id === id))
        .filter((item): item is UIView => item !== undefined),
    }))
    if (extra.length > 0) groups.push({ label: 'nav.group.system' as MessageKey, views: extra })
    return groups.filter(group => group.views.length > 0)
  }, [snapshot])

  const renderWidget = (widget: UIView['widgets'][number], index: number): React.ReactNode => {
    switch (widget.kind) {
      case 'stats':
        return <StatsView key={index} metrics={widget.metrics} payload={data[widget.source.operation]} />
      case 'table':
      case 'search': {
        const payload = data[widget.source.operation]
        const rows = payloadRows(payload)
        const total =
          payload !== null && typeof payload === 'object' && typeof (payload as Record<string, unknown>)['total'] === 'number'
            ? Number((payload as Record<string, unknown>)['total'])
            : undefined
        const title = widget.kind === 'search' ? t.t('nav.recall') : view?.title
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
            ) : view?.id === 'items' ? (
              <form
                className="toolbar"
                onSubmit={event => {
                  event.preventDefault()
                  setPage(1)
                  setQuery(queryDraft.trim())
                }}
              >
                <div className="input-wrap grow">
                  <Icon name="search" />
                  <input
                    className="input"
                    type="search"
                    value={queryDraft}
                    placeholder={t.t('panel.searchPlaceholder')}
                    onChange={event => setQueryDraft(event.target.value)}
                  />
                </div>
                <Button type="submit" label={t.t('items.search')} />
              </form>
            ) : null}
            <TableView
              t={t}
              columns={widget.columns}
              rows={rows}
              {...(widget.pagination ? { pagination: widget.pagination } : {})}
              page={page}
              {...(pageSize !== undefined ? { pageSize } : {})}
              {...(total !== undefined ? { total } : {})}
              {...(title ? { title } : {})}
              onPage={setPage}
              onPageSize={size => {
                setPageSize(size)
                setPage(1)
              }}
              onOpen={openEntry}
            />
          </React.Fragment>
        )
      }
      case 'graph':
        return <GraphView key={index} t={t} payload={data[widget.source.operation]} />
      case 'report': {
        const key = widget.source.operation === 'lint.report' ? 'health.lint' : widget.source.operation === 'heal.report' ? 'health.heal' : undefined
        return <ReportView key={index} t={t} title={key ? t.t(key) : undefined} payload={data[widget.source.operation]} />
      }
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
            onReset={() => setDirty({})}
          />
        )
      case 'actions':
        return (
          <Card key={index} title={t.t('panel.actions')}>
            <ActionBar t={t} ids={widget.actions} actions={snapshot.actions} busy={busy} onRun={id => void runAction(id)} />
          </Card>
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

  const locale = host.locale()
  const pageActions =
    view?.id === 'items' ? (
      <Button label={t.t('panel.newEntry')} icon="plus" variant="primary" onClick={openEditor} />
    ) : view?.id === 'editor' ? (
      <Button label={t.t('panel.backToEntries')} icon="chevron-left" variant="ghost" onClick={() => selectView('items')} />
    ) : undefined

  return (
    <div className="app" data-host={host.kind}>
      <aside className={`sidebar${menuOpen ? ' open' : ''}`} id="sidebar" aria-label={t.t('panel.menu')}>
        <div className="brand">
          <span className="brand-mark">
            <Icon name="layers" />
          </span>
          <span className="brand-text">
            <span className="brand-name">LLM Memory</span>
            <span className="brand-sub">{host.kind}</span>
          </span>
        </div>
        <nav className="nav">
          {navGroups.map((group, index) => (
            <div key={`${group.label ?? 'root'}-${index}`} className="nav-group">
              {group.label ? <div className="nav-label">{t.t(group.label)}</div> : null}
              {group.views.map(item => (
                <button
                  key={item.id}
                  type="button"
                  className={`nav-item${item.id === viewId ? ' active' : ''}`}
                  aria-current={item.id === viewId ? 'page' : undefined}
                  onClick={() => selectView(item.id)}
                >
                  <Icon name={VIEW_ICONS[item.id] ?? 'grid'} />
                  <span className="nav-text">{item.title}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className="mode-chip live">
            <span className="dot" />
            <span>{t.t('panel.live')}</span>
          </span>
          <span className="sdk-version">UI SDK v{snapshot.version}</span>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button
            type="button"
            className="icon-btn mobile-only"
            aria-label={t.t('panel.menu')}
            title={t.t('panel.menu')}
            onClick={() => setMenuOpen(open => !open)}
          >
            <Icon name="menu" />
          </button>
          <span className="badge badge-accent">{host.kind}</span>
          <div className="topbar-actions">
            <button type="button" className="icon-btn" title={t.t('panel.refresh')} aria-label={t.t('panel.refresh')} disabled={loading} onClick={reload}>
              <Icon name="refresh" />
            </button>
            <button
              type="button"
              className="icon-btn"
              title={t.t('panel.theme')}
              aria-label={t.t('panel.theme')}
              onClick={() => {
                const index = THEME_ORDER.indexOf(themePref)
                setThemePref(THEME_ORDER[(index + 1) % THEME_ORDER.length] ?? 'system')
              }}
            >
              <Icon name={THEME_ICON[themePref]} />
            </button>
            {host.kind === 'dsh' ? null : (
              <button
                type="button"
                className="icon-btn lang-btn"
                title={t.t('panel.language')}
                aria-label={t.t('panel.language')}
                disabled={busy}
                onClick={() => void changeLocale(locale === 'ru' ? 'en' : 'ru')}
              >
                {locale.toUpperCase()}
              </button>
            )}
          </div>
        </header>

        <main className="content" id="view" aria-busy={loading}>
          {view ? (
            <PageHead
              title={view.title}
              subtitle={viewSubtitle(view) ? t.t(viewSubtitle(view) as MessageKey) : undefined}
              {...(pageActions ? { actions: pageActions } : {})}
            />
          ) : null}
          {error ? <ErrorBox t={t} message={`${t.t('panel.failed')}: ${error}`} retry={reload} /> : null}
          {notice ? <div className="notice">{notice}</div> : null}
          {loading ? (
            <Loading t={t} />
          ) : view ? (
            <div className="stack">{view.widgets.map((widget, index) => renderWidget(widget, index))}</div>
          ) : null}
        </main>
      </div>

      {menuOpen ? (
        <div
          className="backdrop open"
          onClick={() => setMenuOpen(false)}
          role="presentation"
        />
      ) : null}
    </div>
  )
}
