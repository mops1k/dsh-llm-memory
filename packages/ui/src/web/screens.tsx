/**
 * Shared web screens (Kilo, OpenCode, MCP). One implementation per screen:
 * hosts differ by theme and locale only (ADR-004).
 */
import * as React from 'react'

import type { Translator } from '../headless/i18n.js'
import { RESTORE_CONFIRMATION, DELETE_CONFIRMATION, type BackupSummary } from '../headless/backup.js'
import type {
  GraphVm,
  HealthVm,
  LintVm,
  SettingsVm,
  StatusVm,
  ItemRowVm,
} from '../headless/viewmodels.js'

export interface ScreenProps {
  t: Translator
}

export function StatusScreen({ vm }: ScreenProps & { vm: StatusVm }): React.ReactElement {
  return (
    <section className="lm-screen lm-status">
      <h2>{vm.title}</h2>
      <dl>
        {vm.rows.map(row => (
          <React.Fragment key={row.label}>
            <dt>{row.label}</dt>
            <dd>{row.value}</dd>
          </React.Fragment>
        ))}
      </dl>
    </section>
  )
}

export function ItemsScreen({
  rows,
  selected,
  onSelect,
  t,
}: ScreenProps & { rows: ItemRowVm[]; selected?: string; onSelect?: (id: string) => void }): React.ReactElement {
  return (
    <section className="lm-screen lm-items">
      <h2>{t.t('nav.items')}</h2>
      {rows.length === 0 ? (
        <p className="lm-empty">{t.t('items.empty')}</p>
      ) : (
        <ul>
          {rows.map(row => (
            <li key={row.id} className={row.id === selected ? 'lm-selected' : undefined}>
              <button type="button" onClick={() => onSelect?.(row.id)}>
                {row.title}
              </button>
              <span className="lm-meta">
                {row.scope}/{row.kind}/{row.tier} · {row.status} · {row.updatedAt}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function ItemScreen({ row, t }: ScreenProps & { row?: ItemRowVm }): React.ReactElement {
  if (!row) {
    return (
      <section className="lm-screen lm-item">
        <p className="lm-empty">{t.t('items.notFound')}</p>
      </section>
    )
  }
  return (
    <section className="lm-screen lm-item">
      <h2>{row.title}</h2>
      <p className="lm-meta">
        {row.id} · {row.scope}/{row.kind} · {row.status} · importance {row.importance}
      </p>
    </section>
  )
}

export function GraphScreen({ vm, t }: ScreenProps & { vm: GraphVm }): React.ReactElement {
  return (
    <section className="lm-screen lm-graph">
      <h2>{t.t('nav.graph')}</h2>
      <p className="lm-meta">
        {t.t('graph.entities')}: {vm.entities} · {t.t('graph.edges')}: {vm.edges}
      </p>
      <h3>{t.t('graph.hubs')}</h3>
      <ol>
        {vm.hubs.map(hub => (
          <li key={hub.id}>
            {hub.name} <span className="lm-meta">({hub.degree})</span>
          </li>
        ))}
      </ol>
    </section>
  )
}

export function LintScreen({ vm, t }: ScreenProps & { vm: LintVm }): React.ReactElement {
  return (
    <section className="lm-screen lm-lint">
      <h2>{t.t('nav.lint')}</h2>
      {vm.ok ? (
        <p className="lm-ok">{t.t('lint.ok')}</p>
      ) : (
        <ul>
          {vm.issues.map((issue, index) => (
            <li key={`${issue.entryId}-${index}`}>
              <span className="lm-severity">{issue.severity}</span> {issue.message}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function HealthScreen({ vm, t }: ScreenProps & { vm: HealthVm }): React.ReactElement {
  return (
    <section className="lm-screen lm-health">
      <h2>{t.t('nav.health')}</h2>
      <dl>
        <dt>{vm.labels.vectors}</dt>
        <dd>{vm.vectors}</dd>
        <dt>{vm.labels.model}</dt>
        <dd>{vm.model}</dd>
        <dt>{vm.labels.ports}</dt>
        <dd>{vm.ports.map(port => `${port.port}:${port.state}`).join(', ') || '—'}</dd>
      </dl>
    </section>
  )
}

export function SettingsScreen({
  vm,
  onChange,
  saved,
  t,
}: ScreenProps & {
  vm: SettingsVm
  onChange?: (key: string, value: string | number | boolean) => void
  saved?: boolean
}): React.ReactElement {
  return (
    <section className="lm-screen lm-settings">
      <h2>{t.t('nav.settings')}</h2>
      {saved ? <p className="lm-ok">{t.t('settings.saved')}</p> : null}
      {vm.sections.map(section => (
        <fieldset key={section.id}>
          <legend>{section.title}</legend>
          {section.fields.map(field => (
            <label key={field.key} className="lm-field">
              <span>{field.label}</span>
              {field.kind === 'boolean' ? (
                <input
                  type="checkbox"
                  checked={Boolean(field.value)}
                  onChange={event => onChange?.(field.key, event.target.checked)}
                />
              ) : field.kind === 'enum' ? (
                <select value={String(field.value)} onChange={event => onChange?.(field.key, event.target.value)}>
                  {(field.options ?? []).map(option => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : field.kind === 'number' ? (
                <input
                  type="number"
                  value={Number(field.value)}
                  min={field.min}
                  max={field.max}
                  step={field.step}
                  onChange={event => onChange?.(field.key, Number(event.target.value))}
                />
              ) : (
                <input type="text" value={String(field.value)} onChange={event => onChange?.(field.key, event.target.value)} />
              )}
            </label>
          ))}
        </fieldset>
      ))}
    </section>
  )
}

export function BackupScreen({
  backups,
  onCreate,
  onVerify,
  onRestore,
  onDelete,
  t,
}: ScreenProps & {
  backups: BackupSummary[]
  onCreate?: () => void
  onVerify?: (name: string) => void
  onRestore?: (name: string) => void
  onDelete?: (name: string) => void
}): React.ReactElement {
  return (
    <section className="lm-screen lm-backup">
      <h2>{t.t('nav.backup')}</h2>
      <button type="button" onClick={() => onCreate?.()}>
        {t.t('backup.create')}
      </button>
      <p className="lm-meta" title={`${RESTORE_CONFIRMATION} / ${DELETE_CONFIRMATION}`}>
        {t.t('backup.locked')}
      </p>
      {backups.length === 0 ? (
        <p className="lm-empty">{t.t('backup.list')}: 0</p>
      ) : (
        <ul>
          {backups.map(backup => (
            <li key={backup.name}>
              <strong>{backup.name}</strong>
              <span className="lm-meta">
                {' '}
                {backup.createdAt} · {backup.entries ?? 0} · {backup.includesVectors ? 'vectors' : 'no-vectors'}
              </span>
              <button type="button" onClick={() => onVerify?.(backup.name)}>
                {t.t('backup.verify')}
              </button>
              <button type="button" onClick={() => onRestore?.(backup.name)}>
                {t.t('backup.restore')}
              </button>
              <button type="button" onClick={() => onDelete?.(backup.name)}>
                {t.t('backup.delete')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
