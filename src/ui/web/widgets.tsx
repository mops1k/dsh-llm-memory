/**
 * Presentational building blocks of the schema-driven panel. Every host renders
 * these same components; only theme tokens and locale differ (ADR-004).
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

export function Loading({ t }: WidgetProps): React.ReactElement {
  return <p className="lm-empty">{t.t('panel.loading')}</p>
}

export function StatsView({
  metrics,
  payload,
}: { metrics: readonly UIMetric[]; payload: unknown }): React.ReactElement {
  const body = payloadBody(payload)
  return (
    <dl className="lm-stats">
      {metrics.map(metric => (
        <React.Fragment key={metric.path}>
          <dt>{metric.label}</dt>
          <dd>{stringValue(readPath(body, metric.path))}</dd>
        </React.Fragment>
      ))}
    </dl>
  )
}

export function TableView({
  columns,
  rows,
  pagination,
  page,
  pageSize,
  total,
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
  onPage?: (page: number) => void
  onPageSize?: (size: number) => void
  onOpen?: (id: string) => void
}): React.ReactElement {
  if (rows.length === 0) return <p className="lm-empty">{t.t('items.empty')}</p>
  const size = pageSize ?? pagination?.defaultPageSize ?? rows.length
  const current = page ?? 1
  const pages = pagination ? Math.max(1, Math.ceil((total ?? rows.length) / size)) : 1
  return (
    <>
      <table className="lm-table">
        <thead>
          <tr>
            {columns.map(column => (
              <th key={column.path}>{column.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={String(row['id'] ?? index)}
              onClick={onOpen && row['id'] !== undefined ? () => onOpen(String(row['id'])) : undefined}
            >
              {columns.map(column => (
                <td key={column.path}>{stringValue(readPath(row, column.path))}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {pagination ? (
        <div className="lm-pager">
          <button type="button" className="lm-btn" disabled={current <= 1} onClick={() => onPage?.(current - 1)}>
            ‹
          </button>
          <span className="lm-meta">
            {current} / {pages}
            {total !== undefined ? ` · ${t.t('items.total')}: ${total}` : ''}
          </span>
          <button type="button" className="lm-btn" disabled={current >= pages} onClick={() => onPage?.(current + 1)}>
            ›
          </button>
          <select value={size} onChange={event => onPageSize?.(Number(event.target.value))}>
            {pagination.pageSizes.map(size => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </div>
      ) : null}
    </>
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
      className="lm-search"
      onSubmit={event => {
        event.preventDefault()
        onSubmit()
      }}
    >
      <input
        type="search"
        value={value}
        placeholder={t.t('items.search')}
        onChange={event => onChange(event.target.value)}
      />
      <button type="submit" className="lm-btn">
        {t.t('items.search')}
      </button>
    </form>
  )
}

export function GraphView({ payload, t }: WidgetProps & { payload: unknown }): React.ReactElement {
  const body = (payloadBody(payload) ?? {}) as { entities?: unknown[]; edges?: unknown[] }
  const entities = Array.isArray(body.entities) ? body.entities : []
  const edges = Array.isArray(body.edges) ? body.edges : []
  return (
    <div className="lm-graph">
      <p className="lm-meta">
        {t.t('graph.entities')}: {entities.length} · {t.t('graph.edges')}: {edges.length}
      </p>
      <ul>
        {entities.slice(0, 50).map((entity, index) => {
          const record = (entity ?? {}) as Record<string, unknown>
          return (
            <li key={String(record['id'] ?? index)}>
              {stringValue(record['name'] ?? record['id'])} <span className="lm-meta">({stringValue(record['kind'])})</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

export function ReportView({
  title,
  payload,
  t,
}: WidgetProps & { title?: string; payload: unknown }): React.ReactElement {
  const text =
    typeof payload === 'string'
      ? payload
      : payload !== null && typeof payload === 'object' && typeof (payload as Record<string, unknown>)['report'] === 'string'
        ? String((payload as Record<string, unknown>)['report'])
        : JSON.stringify(payloadBody(payload), null, 2)
  return (
    <section className="lm-report">
      {title ? <h3>{title}</h3> : null}
      <pre>{text.length > 0 ? text : t.t('lint.ok')}</pre>
    </section>
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
    <div className="lm-actions">
      {ids.map(id => {
        const action = actions.find(item => item.id === id)
        const label = labels?.[id] ?? action?.label ?? id
        return (
          <button
            key={id}
            type="button"
            className={`lm-btn${action?.danger ? ' lm-danger' : ''}`}
            disabled={busy}
            title={action?.hint}
            onClick={() => onRun(id)}
          >
            {label}
          </button>
        )
      })}
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
}): React.ReactElement {
  const unsupportedSet = new Set(unsupported ?? [])
  return (
    <div className="lm-settings">
      {groups.map(group => (
        <fieldset key={group.id}>
          <legend>{group.title}</legend>
          {group.fields.map(field => (
            <SettingRow
              key={field.path}
              field={field}
              value={dirty[field.path] ?? values[field.path]}
              unsupported={unsupportedSet.has(field.path)}
              onChange={onChange}
            />
          ))}
        </fieldset>
      ))}
      <fieldset>
        <legend>{t.t('settings.locale')}</legend>
        <label className="lm-field">
          <span>{t.t('settings.locale')}</span>
          <select value={locale} onChange={event => onLocale?.(event.target.value === 'ru' ? 'ru' : 'en')}>
            <option value="ru">ru</option>
            <option value="en">en</option>
          </select>
        </label>
      </fieldset>
      <div className="lm-actions">
        <button type="button" className="lm-btn lm-primary" disabled={busy} onClick={onSave}>
          {t.t('panel.save')}
        </button>
      </div>
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
  return (
    <label className={`lm-field${unsupported ? ' lm-unsupported' : ''}`}>
      <span title={field.hint}>
        {field.label}
        {field.restartRequired ? ' *' : ''}
        {unsupported ? ' (—)' : ''}
      </span>
      {field.type === 'boolean' ? (
        <input
          type="checkbox"
          checked={Boolean(value)}
          disabled={disabled}
          onChange={event => onChange(field.path, event.target.checked)}
        />
      ) : field.type === 'select' ? (
        <select
          value={String(value ?? '')}
          disabled={disabled}
          onChange={event => onChange(field.path, event.target.value)}
        >
          {(field.options ?? []).map(option => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : field.type === 'number' ? (
        <input
          type="number"
          value={Number(value ?? 0)}
          min={field.min}
          max={field.max}
          step={field.step}
          disabled={disabled}
          onChange={event => onChange(field.path, Number(event.target.value))}
        />
      ) : field.type === 'textarea' ? (
        <textarea
          value={String(value ?? '')}
          disabled={disabled}
          rows={4}
          onChange={event => onChange(field.path, event.target.value)}
        />
      ) : (
        <input
          type="text"
          value={field.type === 'list' && Array.isArray(value) ? value.join('\n') : String(value ?? '')}
          disabled={disabled}
          onChange={event => onChange(field.path, event.target.value)}
        />
      )}
    </label>
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
  return (
    <div className="lm-editor">
      <div className="lm-load">
        <input
          type="text"
          value={id}
          placeholder={t.t('editor.id')}
          onChange={event => setId(event.target.value)}
        />
        <button type="button" className="lm-btn" disabled={busy || id.trim().length === 0} onClick={() => onLoad?.(id.trim())}>
          {t.t('editor.load')}
        </button>
        <button
          type="button"
          className="lm-btn"
          disabled={busy}
          onClick={() => {
            setValues({})
            setId('')
          }}
        >
          {t.t('editor.create')}
        </button>
      </div>
      {fields.map(field => (
        <label key={field.path} className="lm-field">
          <span>{field.label}</span>
          {field.type === 'textarea' ? (
            <textarea
              rows={6}
              value={String(values[field.path] ?? '')}
              onChange={event => setValues(previous => ({ ...previous, [field.path]: event.target.value }))}
            />
          ) : field.type === 'select' ? (
            <select
              value={String(values[field.path] ?? '')}
              onChange={event => setValues(previous => ({ ...previous, [field.path]: event.target.value }))}
            >
              <option value="">—</option>
              {(field.options ?? []).map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          ) : field.type === 'number' ? (
            <input
              type="number"
              value={Number(values[field.path] ?? 3)}
              onChange={event => setValues(previous => ({ ...previous, [field.path]: Number(event.target.value) }))}
            />
          ) : field.type === 'list' ? (
            <input
              type="text"
              value={Array.isArray(values[field.path]) ? (values[field.path] as unknown[]).join(', ') : String(values[field.path] ?? '')}
              onChange={event =>
                setValues(previous => ({
                  ...previous,
                  [field.path]: event.target.value
                    .split(',')
                    .map(part => part.trim())
                    .filter(part => part.length > 0),
                }))
              }
            />
          ) : (
            <input
              type="text"
              value={String(values[field.path] ?? '')}
              onChange={event => setValues(previous => ({ ...previous, [field.path]: event.target.value }))}
            />
          )}
        </label>
      ))}
      <div className="lm-actions">
        <button
          type="button"
          className="lm-btn lm-primary"
          disabled={busy}
          onClick={() => onSave({ ...values, ...(id.trim().length > 0 ? { id: id.trim() } : {}) })}
        >
          {t.t('editor.save')}
        </button>
        {id.trim().length > 0 && onForget ? (
          <button type="button" className="lm-btn" disabled={busy} onClick={() => onForget(id.trim())}>
            {t.t('editor.forget')}
          </button>
        ) : null}
        {id.trim().length > 0 && onDelete ? (
          <button type="button" className="lm-btn lm-danger" disabled={busy} onClick={() => onDelete(id.trim())}>
            {t.t('editor.delete')}
          </button>
        ) : null}
      </div>
    </div>
  )
}

export function VectorMapView({
  payload,
  t,
}: WidgetProps & { payload?: unknown }): React.ReactElement {
  const body = payloadBody(payload) as { reason?: string; map?: unknown } | undefined
  const reason = typeof body?.reason === 'string' ? body.reason : undefined
  if (!body?.map) {
    return <p className="lm-empty">{reason ?? t.t('map.unavailable')}</p>
  }
  return (
    <pre className="lm-map">{JSON.stringify(body.map, null, 2).slice(0, 4000)}</pre>
  )
}
