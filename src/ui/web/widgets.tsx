/**
 * Presentational building blocks of the schema-driven panel. The design is the
 * accepted shared panel design (`src/ui/design/panel/styles/`), so the markup
 * and CSS class names match the Kilo/OpenCode page. Only data flow differs.
 */
import * as React from 'react'

import type { Translator } from '../headless/i18n.js'
import {
  payloadBody,
  readPath,
  stringValue,
  type UIEditorField,
  type UIMetric,
  type UIPagination,
  type UISettingsAction,
  type UISettingsField,
  type UISettingsGroup,
  type UITableColumn,
} from './types.js'

export interface WidgetProps {
  t: Translator
}

/* ------------------------------------------------------------------ *
 * icons (the same strokes as the shared panel sprite)
 * ------------------------------------------------------------------ */

const ICON_PATHS: Record<string, React.ReactNode> = {
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  list: <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />,
  search: (
    <>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </>
  ),
  graph: (
    <>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="m8.6 13.5 7 4M15.4 6.5l-7 4" />
    </>
  ),
  map: (
    <>
      <circle cx="5" cy="7" r="1.6" />
      <circle cx="9" cy="5" r="1.6" />
      <circle cx="7" cy="12" r="1.6" />
      <circle cx="13" cy="9" r="1.6" />
      <circle cx="17" cy="6" r="1.6" />
      <circle cx="15" cy="14" r="1.6" />
      <circle cx="6" cy="17" r="1.6" />
      <circle cx="11" cy="19" r="1.6" />
      <circle cx="18" cy="17" r="1.6" />
    </>
  ),
  pulse: <path d="M22 12h-4l-3 9L9 3l-3 9H2" />,
  sliders: (
    <>
      <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3" />
      <circle cx="4" cy="12" r="2" />
      <circle cx="12" cy="10" r="2" />
      <circle cx="20" cy="14" r="2" />
    </>
  ),
  archive: (
    <>
      <rect x="3" y="4" width="18" height="4" rx="1.5" />
      <path d="M5 8v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8" />
      <path d="M10 12h4" />
    </>
  ),
  cpu: (
    <>
      <rect x="5" y="5" width="14" height="14" rx="2" />
      <rect x="9" y="9" width="6" height="6" rx="1" />
      <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
    </>
  ),
  edit: (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </>
  ),
  layers: (
    <>
      <path d="M12 2 3 7l9 5 9-5-9-5Z" />
      <path d="m3 12 9 5 9-5" />
      <path d="m3 17 9 5 9-5" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5v14a9 3 0 0 0 18 0V5" />
      <path d="M3 12a9 3 0 0 0 18 0" />
    </>
  ),
  'check-circle': (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  shield: (
    <>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  tag: (
    <>
      <path d="M20.6 13.4 12 22l-9-9V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z" />
      <path d="M7 7h.01" />
    </>
  ),
  menu: <path d="M3 6h18M3 12h18M3 18h18" />,
  refresh: (
    <>
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  moon: <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />,
  monitor: (
    <>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </>
  ),
  alert: (
    <>
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4M12 17h.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4M12 8h.01" />
    </>
  ),
  'chevron-left': <path d="m15 18-6-6 6-6" />,
  'chevron-right': <path d="m9 18 6-6-6-6" />,
  play: <path d="M6 3l14 9-14 9V3Z" />,
  x: <path d="M18 6 6 18M6 6l12 12" />,
}

export function Icon({ name, className }: { name: string; className?: string }): React.ReactElement {
  return (
    <svg
      className={`ic${className ? ` ${className}` : ''}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICON_PATHS[name] ?? ICON_PATHS['grid']}
    </svg>
  )
}

/* ------------------------------------------------------------------ *
 * shell primitives
 * ------------------------------------------------------------------ */

export function Button({
  label,
  icon,
  variant,
  size,
  disabled,
  title,
  onClick,
  type = 'button',
  extraClass,
}: {
  label?: string
  icon?: string
  variant?: 'primary' | 'ghost' | 'subtle' | 'danger'
  size?: 'sm'
  disabled?: boolean
  title?: string
  onClick?: () => void
  type?: 'button' | 'submit'
  extraClass?: string
}): React.ReactElement {
  const classes = ['btn', variant ? `btn-${variant}` : '', size ? `btn-${size}` : '', extraClass ?? '']
    .filter(Boolean)
    .join(' ')
  return (
    <button
      type={type}
      className={classes}
      disabled={disabled}
      title={title ?? label ?? ''}
      onClick={disabled ? undefined : onClick}
    >
      {icon ? <Icon name={icon} /> : null}
      {label ? <span>{label}</span> : null}
    </button>
  )
}

export function PageHead({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle?: string
  actions?: React.ReactNode
}): React.ReactElement {
  return (
    <div className="page-head">
      <div className="grow">
        <h1 className="page-title">{title}</h1>
        {subtitle ? <p className="page-sub">{subtitle}</p> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </div>
  )
}

export function Card({
  title,
  subtitle,
  actions,
  children,
  foot,
  flush = false,
  extraClass,
}: {
  title?: string
  subtitle?: string
  actions?: React.ReactNode
  children?: React.ReactNode
  foot?: React.ReactNode
  flush?: boolean
  extraClass?: string
}): React.ReactElement {
  return (
    <section className={`card${extraClass ? ` ${extraClass}` : ''}`}>
      {title || actions ? (
        <div className="card-head">
          <div className="grow">
            {title ? <h2 className="card-title">{title}</h2> : null}
            {subtitle ? <p className="card-sub">{subtitle}</p> : null}
          </div>
          {actions ? <div className="flex items-center gap-8">{actions}</div> : null}
        </div>
      ) : null}
      <div className={`card-body${flush ? ' flush' : ''}`}>{children}</div>
      {foot ? <div className="card-foot">{foot}</div> : null}
    </section>
  )
}

export function EmptyState({
  title,
  text,
  icon = 'search',
  action,
}: {
  title: string
  text?: string
  icon?: string
  action?: React.ReactNode
}): React.ReactElement {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon name={icon} />
      </div>
      <div className="empty-title">{title}</div>
      {text ? <p className="empty-text">{text}</p> : null}
      {action ? <div className="empty-action">{action}</div> : null}
    </div>
  )
}

export function Loading({ t }: WidgetProps): React.ReactElement {
  return (
    <div className="empty">
      <div className="spinner lg" style={{ margin: '0 auto 12px' }} />
      <div className="empty-text">{t.t('panel.loading')}</div>
    </div>
  )
}

export function ErrorBox({ message, retry, t }: WidgetProps & { message: string; retry?: () => void }): React.ReactElement {
  return (
    <div className="error-box">
      <Icon name="alert" />
      <div className="grow">
        <div>{message}</div>
        {retry ? (
          <div className="mt-8">
            <Button label={t.t('panel.retry')} size="sm" onClick={retry} />
          </div>
        ) : null}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * data widgets
 * ------------------------------------------------------------------ */

const STAT_ICONS = ['database', 'check-circle', 'shield', 'tag', 'layers']

export function StatsView({
  metrics,
  payload,
}: {
  metrics: readonly UIMetric[]
  payload: unknown
}): React.ReactElement {
  const body = payloadBody(payload)
  const byProject = body !== null && typeof body === 'object' ? (body as Record<string, unknown>)['byProject'] : undefined
  const projectCount = byProject !== null && typeof byProject === 'object' ? Object.keys(byProject).length : undefined
  const value = (metric: UIMetric): unknown =>
    metric.path === 'projects' ? (readPath(body, metric.path) ?? projectCount) : readPath(body, metric.path)
  return (
    <div className="grid-kpi">
      {metrics.map((metric, index) => (
        <div key={metric.path} className="stat">
          <div className="stat-top">
            <span className="stat-label">{metric.label}</span>
            <span className="stat-ico">
              <Icon name={STAT_ICONS[index % STAT_ICONS.length] ?? 'grid'} />
            </span>
          </div>
          <div className="stat-value">{stringValue(value(metric))}</div>
        </div>
      ))}
    </div>
  )
}

function dateText(value: unknown, locale: 'en' | 'ru'): string {
  if (typeof value !== 'string' || value.length === 0) return '—'
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return value
  return new Date(time).toLocaleString(locale === 'ru' ? 'ru-RU' : 'en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function bytesText(value: unknown): string {
  const bytes = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(bytes) || bytes <= 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let size = bytes
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024
    unit += 1
  }
  return `${size >= 10 || unit === 0 ? Math.round(size) : size.toFixed(1)} ${units[unit]}`
}

const KIND_LABELS: Record<string, string> = {
  rules: 'rules',
  preferences: 'preferences',
  decisions: 'decisions',
  facts: 'facts',
  architecture: 'architecture',
  concepts: 'concepts',
}

function Cell({ column, row, t }: { column: UITableColumn; row: Record<string, unknown>; t: Translator }): React.ReactElement {
  const value = readPath(row, column.path)
  if (column.path === 'title') {
    const meta = [row['project'], row['scope']].filter(part => typeof part === 'string' && part.length > 0).join(' · ')
    return (
      <div className="cell-title">
        <div className="t">{stringValue(value)}</div>
        {meta ? <div className="s">{meta}</div> : null}
      </div>
    )
  }
  if (column.path === 'kind') {
    const kind = String(value ?? 'facts')
    return (
      <span className="flex items-center gap-8">
        <span className="kind-dot" data-kind={kind} style={{ background: `var(--k-${kind}, var(--text-3))` }} />
        <span>{KIND_LABELS[kind] ?? kind}</span>
      </span>
    )
  }
  if (column.path === 'tier') {
    const tier = String(value ?? 'normal')
    const tone = tier === 'immutable' ? ' badge-danger' : tier === 'important' ? ' badge-warn' : ''
    return <span className={`badge${tone}`}>{tier}</span>
  }
  if (column.path === 'status') {
    const status = String(value ?? 'active')
    const tone = status === 'active' ? ' badge-ok' : status === 'deleted' ? ' badge-danger' : ''
    return <span className={`badge${tone}`}>{status}</span>
  }
  if (column.path === 'importance') return <span className="badge">{`${String(value ?? 3)}/5`}</span>
  if (column.path.endsWith('At')) return <span className="muted nowrap">{dateText(value, t.locale)}</span>
  if (column.path === 'sizeBytes' || column.path === 'bytes') return <span>{bytesText(value)}</span>
  return <span>{value === undefined || value === null || value === '' ? '—' : stringValue(value)}</span>
}

export function TableView({
  columns,
  rows,
  pagination,
  page,
  pageSize,
  total,
  title,
  subtitle,
  onPage,
  onPageSize,
  onOpen,
  t,
}: WidgetProps & {
  columns: readonly UITableColumn[]
  rows: readonly Record<string, unknown>[]
  pagination?: UIPagination
  page?: number
  pageSize?: number
  total?: number
  title?: string
  subtitle?: string
  onPage?: (page: number) => void
  onPageSize?: (size: number) => void
  onOpen?: (id: string) => void
}): React.ReactElement {
  const size = pageSize ?? pagination?.defaultPageSize ?? Math.max(rows.length, 1)
  const current = page ?? 1
  const count = total ?? rows.length
  const pages = Math.max(1, Math.ceil(count / size))
  const from = count === 0 ? 0 : (current - 1) * size + 1
  const to = Math.min(current * size, count)

  const pager = pagination ? (
    <div className="table-foot">
      <div className="table-info">
        {t.t('panel.showing')} {from}–{to} / {count} · {current} / {pages}
      </div>
      <div className="flex items-center gap-12">
        <label className="page-size">
          {t.t('panel.pageSize')}
          <select className="select" value={size} onChange={event => onPageSize?.(Number(event.target.value))}>
            {pagination.pageSizes.map(option => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <div className="pager">
          <Button icon="chevron-left" size="sm" variant="ghost" title={t.t('panel.prev')} disabled={current <= 1} onClick={() => onPage?.(current - 1)} />
          <Button label={String(current)} size="sm" variant="primary" />
          <Button icon="chevron-right" size="sm" variant="ghost" title={t.t('panel.next')} disabled={current >= pages} onClick={() => onPage?.(current + 1)} />
        </div>
      </div>
    </div>
  ) : null

  return (
    <Card {...(title ? { title } : {})} {...(subtitle ? { subtitle } : {})} flush {...(pager ? { foot: pager } : {})}>
      {rows.length === 0 ? (
        <EmptyState title={t.t('items.empty')} text={t.t('panel.empty')} icon="list" />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                {columns.map(column => (
                  <th key={column.path} scope="col">
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const id = row['id']
                const clickable = onOpen && id !== undefined ? ' clickable' : ''
                return (
                  <tr
                    key={String(id ?? index)}
                    className={clickable ? 'clickable' : undefined}
                    tabIndex={clickable ? 0 : undefined}
                    onClick={clickable ? () => onOpen?.(String(id)) : undefined}
                    onKeyDown={
                      clickable
                        ? event => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              onOpen?.(String(id))
                            }
                          }
                        : undefined
                    }
                  >
                    {columns.map(column => (
                      <td key={column.path}>
                        <Cell column={column} row={row} t={t} />
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

export function SearchBar({
  value,
  onChange,
  onSubmit,
  t,
}: WidgetProps & { value: string; onChange: (value: string) => void; onSubmit: () => void }): React.ReactElement {
  return (
    <form
      className="toolbar"
      onSubmit={event => {
        event.preventDefault()
        onSubmit()
      }}
    >
      <div className="input-wrap grow">
        <Icon name="search" />
        <input
          className="input"
          type="search"
          value={value}
          placeholder={t.t('panel.searchPlaceholder')}
          onChange={event => onChange(event.target.value)}
        />
      </div>
      <Button type="submit" label={t.t('items.search')} />
    </form>
  )
}

export function ActionBar({
  ids,
  actions,
  labels,
  busy,
  onRun,
}: {
  ids: readonly string[]
  actions: readonly UISettingsAction[]
  labels?: Record<string, string>
  busy?: boolean
  onRun: (id: string) => void
}): React.ReactElement {
  return (
    <div className="flex gap-8" style={{ flexWrap: 'wrap' }}>
      {ids.map(id => {
        const action = actions.find(item => item.id === id)
        const label = labels?.[id] ?? action?.label ?? id
        return (
          <Button
            key={id}
            label={label}
            variant={action?.danger ? 'danger' : action?.mode === 'write' ? 'primary' : ''}
            {...(action?.danger ? { extraClass: 'lm-danger' } : {})}
            disabled={busy}
            title={action?.hint ?? label}
            onClick={() => onRun(id)}
          />
        )
      })}
    </div>
  )
}

function SettingRow({
  field,
  value,
  unsupported,
  onChange,
}: {
  field: UISettingsField
  value: unknown
  unsupported: boolean
  onChange: (path: string, value: string | number | boolean) => void
}): React.ReactElement {
  const disabled = field.type === 'readonly'
  const input = (() => {
    if (field.type === 'boolean') {
      return (
        <input
          type="checkbox"
          checked={Boolean(value)}
          disabled={disabled}
          onChange={event => onChange(field.path, event.target.checked)}
        />
      )
    }
    if (field.type === 'select') {
      return (
        <select className="select" value={String(value ?? '')} disabled={disabled} onChange={event => onChange(field.path, event.target.value)}>
          {(field.options ?? []).map(option => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )
    }
    if (field.type === 'number') {
      return (
        <input
          className="input"
          type="number"
          value={Number(value ?? 0)}
          {...(field.min !== undefined ? { min: field.min } : {})}
          {...(field.max !== undefined ? { max: field.max } : {})}
          {...(field.step !== undefined ? { step: field.step } : {})}
          disabled={disabled}
          onChange={event => onChange(field.path, Number(event.target.value))}
        />
      )
    }
    if (field.type === 'textarea' || field.type === 'list') {
      const text = field.type === 'list' && Array.isArray(value) ? (value as unknown[]).join('\n') : String(value ?? '')
      return (
        <textarea
          className="textarea"
          rows={field.type === 'list' ? 3 : 4}
          value={text}
          disabled={disabled}
          onChange={event => onChange(field.path, event.target.value)}
        />
      )
    }
    return (
      <input
        className="input"
        type="text"
        value={String(value ?? '')}
        disabled={disabled}
        onChange={event => onChange(field.path, event.target.value)}
      />
    )
  })()

  return (
    <div className={`setting-row${unsupported ? ' lm-unsupported' : ''}`}>
      <div className="setting-label">
        <div className="flex items-center gap-6">
          <span>{field.label}</span>
          {field.restartRequired ? <span className="badge badge-warn">restart</span> : null}
          {unsupported ? <span className="badge">{'—'}</span> : null}
        </div>
        <div className="setting-path">{field.path}</div>
        {field.hint ? <div className="field-hint">{field.hint}</div> : null}
      </div>
      <div className="setting-control">{input}</div>
    </div>
  )
}

export function SettingsForm({
  groups,
  values,
  unsupported,
  dirty,
  busy,
  locale,
  onLocale,
  onChange,
  onSave,
  onReset,
  t,
}: WidgetProps & {
  groups: readonly UISettingsGroup[]
  values: Record<string, unknown>
  unsupported?: readonly string[]
  dirty: Record<string, string | number | boolean>
  busy?: boolean
  locale: 'en' | 'ru'
  onLocale?: (locale: 'en' | 'ru') => void
  onChange: (path: string, value: string | number | boolean) => void
  onSave: () => void
  onReset?: () => void
}): React.ReactElement {
  const unsupportedSet = new Set(unsupported ?? [])
  const changed = Object.keys(dirty).length

  return (
    <div className="stack">
      {groups.map(group => (
        <Card key={group.id} title={group.title} subtitle={`${group.fields.length} ${t.t('settings.fields')}`}>
          {group.fields.map(field => (
            <SettingRow
              key={field.path}
              field={field}
              value={dirty[field.path] ?? values[field.path]}
              unsupported={unsupportedSet.has(field.path)}
              onChange={onChange}
            />
          ))}
        </Card>
      ))}
      <Card title={t.t('settings.locale')}>
        <label className="field">
          <span className="field-label">{t.t('settings.locale')}</span>
          <select className="select" value={locale} onChange={event => onLocale?.(event.target.value === 'ru' ? 'ru' : 'en')}>
            <option value="ru">ru</option>
            <option value="en">en</option>
          </select>
        </label>
      </Card>
      {changed > 0 ? (
        <div className="savebar accent">
          <span className="grow">
            <strong>{changed}</strong> {t.t('settings.fields')}
          </span>
          <Button label={t.t('panel.cancel')} variant="ghost" size="sm" onClick={onReset} />
          <Button label={t.t('panel.save')} variant="primary" size="sm" disabled={busy} onClick={onSave} />
        </div>
      ) : null}
    </div>
  )
}

export function EditorForm({
  fields,
  item,
  busy,
  onLoad,
  onSave,
  onForget,
  onDelete,
  t,
}: WidgetProps & {
  fields: readonly UIEditorField[]
  item?: Record<string, unknown>
  busy?: boolean
  onLoad?: (id: string) => void
  onSave: (values: Record<string, unknown>) => void
  onForget?: (id: string) => void
  onDelete?: (id: string) => void
}): React.ReactElement {
  const [values, setValues] = React.useState<Record<string, unknown>>(item ?? {})
  const [id, setId] = React.useState<string>(typeof item?.['id'] === 'string' ? item['id'] : '')
  React.useEffect(() => {
    if (item) {
      setValues(item)
      setId(String(item['id'] ?? ''))
    }
  }, [item])

  const field = (entry: UIEditorField): React.ReactNode => {
    if (entry.type === 'textarea') {
      return (
        <textarea
          className="textarea"
          rows={8}
          value={String(values[entry.path] ?? '')}
          onChange={event => setValues(previous => ({ ...previous, [entry.path]: event.target.value }))}
        />
      )
    }
    if (entry.type === 'select') {
      return (
        <select
          className="select"
          value={String(values[entry.path] ?? '')}
          onChange={event => setValues(previous => ({ ...previous, [entry.path]: event.target.value }))}
        >
          <option value="">—</option>
          {(entry.options ?? []).map(option => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      )
    }
    if (entry.type === 'number') {
      return (
        <input
          className="input"
          type="number"
          value={Number(values[entry.path] ?? 3)}
          onChange={event => setValues(previous => ({ ...previous, [entry.path]: Number(event.target.value) }))}
        />
      )
    }
    if (entry.type === 'list') {
      return (
        <input
          className="input"
          type="text"
          value={Array.isArray(values[entry.path]) ? (values[entry.path] as unknown[]).join(', ') : String(values[entry.path] ?? '')}
          onChange={event =>
            setValues(previous => ({
              ...previous,
              [entry.path]: event.target.value
                .split(',')
                .map(part => part.trim())
                .filter(part => part.length > 0),
            }))
          }
        />
      )
    }
    return (
      <input
        className="input"
        type="text"
        value={String(values[entry.path] ?? '')}
        onChange={event => setValues(previous => ({ ...previous, [entry.path]: event.target.value }))}
      />
    )
  }

  return (
    <div className="stack">
      <Card title={id ? `${t.t('editor.save')} · ${id}` : t.t('editor.create')}>
        <div className="toolbar" style={{ marginBottom: 0 }}>
          <div className="input-wrap grow">
            <Icon name="search" />
            <input
              className="input"
              type="text"
              value={id}
              placeholder={t.t('editor.id')}
              onChange={event => setId(event.target.value)}
            />
          </div>
          <Button label={t.t('editor.load')} disabled={busy || id.trim().length === 0} onClick={() => onLoad?.(id.trim())} />
          <Button
            label={t.t('editor.create')}
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setValues({})
              setId('')
            }}
          />
        </div>
      </Card>
      <Card>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          {fields.map(entry => (
            <label key={entry.path} className="field">
              <span className="field-label">{entry.label}</span>
              {field(entry)}
            </label>
          ))}
        </div>
      </Card>
      <div className="flex gap-8" style={{ flexWrap: 'wrap' }}>
        <Button
          label={t.t('editor.save')}
          variant="primary"
          disabled={busy}
          onClick={() => onSave({ ...values, ...(id.trim().length > 0 ? { id: id.trim() } : {}) })}
        />
        {id.trim().length > 0 && onForget ? (
          <Button label={t.t('editor.forget')} disabled={busy} onClick={() => onForget(id.trim())} />
        ) : null}
        {id.trim().length > 0 && onDelete ? (
          <Button label={t.t('editor.delete')} variant="danger" disabled={busy} onClick={() => onDelete(id.trim())} />
        ) : null}
      </div>
    </div>
  )
}

export function ReportView({
  title,
  payload,
  t,
}: WidgetProps & { title?: string; payload: unknown }): React.ReactElement {
  const body = payloadBody(payload)
  const text =
    typeof payload === 'string'
      ? payload
      : payload !== null && typeof payload === 'object' && typeof (payload as Record<string, unknown>)['report'] === 'string'
        ? String((payload as Record<string, unknown>)['report'])
        : body === undefined
          ? ''
          : JSON.stringify(body, null, 2)
  const record = body !== null && typeof body === 'object' ? (body as Record<string, unknown>) : undefined
  const isLint = record !== undefined && Array.isArray(record['brokenLinks'])
  const isHeal = record !== undefined && (typeof record['reindexed'] === 'number' || typeof record['removedLinks'] === 'number')

  if (isLint) {
    const list = (key: string): Record<string, unknown>[] =>
      Array.isArray(record[key]) ? (record[key] as Record<string, unknown>[]) : []
    const chips: Array<[string, unknown, string]> = [
      [t.t('report.entries'), record['totalCount'], ''],
      [t.t('report.active'), record['activeCount'], ''],
      [t.t('report.brokenLinks'), list('brokenLinks').length, list('brokenLinks').length > 0 ? ' danger' : ''],
      [t.t('report.stale'), list('stale').length, list('stale').length > 0 ? ' warn' : ''],
      [t.t('report.overlaps'), list('overlaps').length, list('overlaps').length > 0 ? ' warn' : ''],
      [t.t('report.duplicates'), list('duplicates').length, list('duplicates').length > 0 ? ' warn' : ''],
    ]
    const issues = [
      ...list('stale').map(item => ({ title: String(item['title'] ?? item['id'] ?? ''), meta: 'stale' })),
      ...list('brokenLinks').map(link => ({
        title: `${String(link['title'] ?? link['id'] ?? '')} → ${String(link['missingId'] ?? '')}`,
        meta: String(link['field'] ?? ''),
      })),
      ...list('overlaps').map(pair => ({
        title: `${String(pair['aTitle'] ?? pair['a'] ?? '')} ↔ ${String(pair['bTitle'] ?? pair['b'] ?? '')}`,
        meta: `${Math.round(Number(pair['score'] ?? 0) * 100)}%`,
      })),
    ]
    return (
      <Card title={title} flush>
        <div className="report-summary">
          {chips.map(([label, value, tone]) => (
            <span key={label} className={`chip${tone}`}>
              <span className="faint">{label}</span>
              <strong>{stringValue(value)}</strong>
            </span>
          ))}
        </div>
        {issues.length === 0 ? (
          <EmptyState title={t.t('report.clean')} icon="check-circle" />
        ) : (
          <div className="issue-list">
            {issues.map((issue, index) => (
              <div key={`${issue.title}-${index}`} className="issue">
                <div className="issue-title">{issue.title}</div>
                {issue.meta ? <div className="issue-meta">{issue.meta}</div> : null}
              </div>
            ))}
          </div>
        )}
      </Card>
    )
  }

  if (isHeal) {
    const vectors = record['vectors'] !== null && typeof record['vectors'] === 'object' ? (record['vectors'] as Record<string, unknown>) : {}
    const lines: Array<[string, unknown]> = [
      [t.t('report.removedLinks'), record['removedLinks'] ?? 0],
      [t.t('report.addedBacklinks'), record['addedBacklinks'] ?? 0],
      [t.t('report.reindexed'), record['reindexed'] ?? 0],
      [t.t('report.brokenLinks'), `${stringValue(record['brokenBefore'] ?? 0)} → ${stringValue(record['brokenAfter'] ?? 0)}`],
      [t.t('report.checked'), vectors['checked'] ?? 0],
    ]
    return (
      <Card title={title}>
        <div>
          {lines.map(([label, value]) => (
            <div key={label} className="metric-line">
              <span className="muted">{label}</span>
              <span className="v">{stringValue(value)}</span>
            </div>
          ))}
        </div>
      </Card>
    )
  }

  return (
    <Card title={title}>
      <pre className="report" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
        {text.length > 0 ? text : t.t('lint.ok')}
      </pre>
    </Card>
  )
}

export function GraphView({ payload, t }: WidgetProps & { payload: unknown }): React.ReactElement {
  const body = (payloadBody(payload) ?? {}) as { entities?: unknown[]; edges?: unknown[] }
  const rawEntities = Array.isArray(body.entities) ? body.entities : []
  const rawEdges = Array.isArray(body.edges) ? body.edges : []
  const entities = rawEntities.slice(0, 120).map((value, index) => {
    const record = (value ?? {}) as Record<string, unknown>
    return {
      id: String(record['id'] ?? index),
      name: stringValue(record['name'] ?? record['id']),
      kind: String(record['kind'] ?? 'facts'),
    }
  })
  const ids = new Set(entities.map(entity => entity.id))
  const edges = rawEdges
    .map(value => (value ?? {}) as Record<string, unknown>)
    .map(edge => ({ source: String(edge['source'] ?? ''), target: String(edge['target'] ?? '') }))
    .filter(edge => ids.has(edge.source) && ids.has(edge.target))

  const width = 900
  const height = 520
  const centerX = width / 2
  const centerY = height / 2
  const radius = Math.min(width, height) * 0.4
  const position = new Map<string, { x: number; y: number }>()
  entities.forEach((entity, index) => {
    const angle = (index / Math.max(entities.length, 1)) * Math.PI * 2 - Math.PI / 2
    position.set(entity.id, {
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius,
    })
  })

  const kinds = [...new Set(entities.map(entity => entity.kind))]

  return (
    <Card
      title={`${t.t('graph.entities')}: ${entities.length} · ${t.t('graph.edges')}: ${edges.length}`}
      subtitle={rawEntities.length > entities.length ? `${t.t('graph.capped')} ${entities.length} / ${rawEntities.length}` : undefined}
      flush
    >
      <div className="viz">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t.t('nav.graph')}>
          {edges.map((edge, index) => {
            const from = position.get(edge.source)
            const to = position.get(edge.target)
            if (!from || !to) return null
            return <line key={index} x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="var(--border-strong)" strokeWidth={1} opacity={0.55} />
          })}
          {entities.map(entity => {
            const point = position.get(entity.id)
            if (!point) return null
            return (
              <g key={entity.id} className="graph-node">
                <circle cx={point.x} cy={point.y} r={7} fill={`var(--k-${entity.kind}, var(--text-3))`} stroke="var(--surface)" strokeWidth={2} />
                <text className="graph-label" x={point.x + 10} y={point.y + 3}>
                  {entity.name.length > 24 ? `${entity.name.slice(0, 23)}…` : entity.name}
                </text>
              </g>
            )
          })}
        </svg>
        <div className="viz-legend">
          {kinds.map(kind => (
            <span key={kind} className="chip">
              <span className="kind-dot" style={{ background: `var(--k-${kind}, var(--text-3))` }} />
              {kind}
            </span>
          ))}
        </div>
      </div>
    </Card>
  )
}

export function VectorMapView({
  payload,
  t,
}: WidgetProps & { payload?: unknown }): React.ReactElement {
  const body = payloadBody(payload) as { reason?: string; map?: { points?: unknown[]; entries?: number } } | undefined
  const reason = typeof body?.reason === 'string' ? body.reason : undefined
  const points = Array.isArray(body?.map?.points) ? body.map.points : []
  if (!body?.map) {
    return (
      <Card>
        <EmptyState title={t.t('map.unavailable')} text={reason} icon="map" />
      </Card>
    )
  }
  if (points.length === 0) {
    return (
      <Card>
        <EmptyState title={t.t('panel.empty')} icon="map" />
      </Card>
    )
  }

  const parsed = points.slice(0, 400).map((value, index) => {
    const point = (value ?? {}) as Record<string, unknown>
    return {
      id: String(point['id'] ?? index),
      x: Number(point['x'] ?? 0),
      y: Number(point['y'] ?? 0),
      kind: String(point['kind'] ?? 'facts'),
    }
  })
  const xs = parsed.map(point => point.x)
  const ys = parsed.map(point => point.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const width = 900
  const height = 520
  const pad = 40
  const scaleX = (value: number): number => pad + ((value - minX) / (maxX - minX || 1)) * (width - pad * 2)
  const scaleY = (value: number): number => height - pad - ((value - minY) / (maxY - minY || 1)) * (height - pad * 2)
  const kinds = [...new Set(parsed.map(point => point.kind))]

  return (
    <Card
      title={`${t.t('map.points')}: ${parsed.length}`}
      subtitle={typeof body.map.entries === 'number' ? `${t.t('nav.items')}: ${body.map.entries}` : undefined}
      flush
    >
      <div className="viz">
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t.t('nav.map')}>
          <g className="map-axes">
            <line x1={pad - 12} x2={pad - 12} y1={pad} y2={height - pad} />
            <line x1={pad - 12} x2={width - pad} y1={height - pad} y2={height - pad} />
            <text x={width - pad - 28} y={height - pad - 8}>
              PC1
            </text>
            <text x={pad - 30} y={pad + 14}>
              PC2
            </text>
          </g>
          {parsed.map(point => (
            <circle
              key={point.id}
              className="map-point"
              cx={scaleX(point.x)}
              cy={scaleY(point.y)}
              r={4}
              fill={`var(--k-${point.kind}, var(--text-3))`}
              opacity={0.82}
            />
          ))}
        </svg>
        <div className="viz-legend">
          {kinds.map(kind => (
            <span key={kind} className="chip">
              <span className="kind-dot" style={{ background: `var(--k-${kind}, var(--text-3))` }} />
              {kind}
            </span>
          ))}
        </div>
      </div>
    </Card>
  )
}
