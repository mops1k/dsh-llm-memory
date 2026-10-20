/**
 * Wire shapes the schema-driven panel renders. They mirror the core UI schema
 * (`src/core/domain/ui-schema.ts`) but stay local: the browser bundle must not
 * pull server-side modules.
 */

export interface UIMetric {
  path: string
  label: string
}

export interface UITableColumn {
  path: string
  label: string
}

export interface UIOption {
  value: string
  label: string
}

export interface UIEditorField {
  path: string
  label: string
  type: 'text' | 'textarea' | 'number' | 'select' | 'list'
  options?: readonly UIOption[]
}

export interface UISourceRef {
  operation: string
  params?: Record<string, string>
}

export interface UIPagination {
  pageSizes: readonly number[]
  defaultPageSize: number
}

export type UIWidget =
  | { kind: 'stats'; source: UISourceRef; metrics: readonly UIMetric[] }
  | { kind: 'table'; source: UISourceRef; columns: readonly UITableColumn[]; pagination?: UIPagination }
  | { kind: 'graph'; source: UISourceRef }
  | { kind: 'report'; source: UISourceRef }
  | { kind: 'form'; source: UISourceRef }
  | { kind: 'actions'; actions: readonly string[] }
  | {
      kind: 'vector-map'
      source: UISourceRef
      extra?: readonly UISourceRef[]
      params?: readonly { name: string; label: string; min?: number; max?: number; step?: number }[]
    }
  | { kind: 'editor'; fields: readonly UIEditorField[] }
  | { kind: 'search'; source: UISourceRef; columns: readonly UITableColumn[]; pagination?: UIPagination }

export interface UIView {
  id: string
  title: string
  widgets: readonly UIWidget[]
}

export interface UISettingsField {
  path: string
  label: string
  hint?: string
  type: 'text' | 'textarea' | 'number' | 'boolean' | 'select' | 'list' | 'readonly'
  options?: readonly UIOption[]
  min?: number
  max?: number
  step?: number
  restartRequired?: boolean
}

export interface UISettingsGroup {
  id: string
  title: string
  fields: readonly UISettingsField[]
}

export interface UISettingsAction {
  id: string
  label: string
  group: string
  hint?: string
  confirm?: string
  danger?: boolean
  mode?: 'read' | 'write'
}

/** `panelSnapshot()` payload from the core (screens and callable actions). */
export interface PanelSnapshot {
  version: number
  views: readonly UIView[]
  actions: readonly UISettingsAction[]
  operations: readonly string[]
}

/** `settingsSnapshot()` payload from the core. */
export interface SettingsSnapshot {
  version: number
  groups: readonly UISettingsGroup[]
  actions: readonly UISettingsAction[]
  values: Record<string, unknown>
}

/** What `GET .../settings/snapshot` returns in the Kilo compatibility layer. */
export interface SettingsSnapshotResponse {
  ok?: boolean
  snapshot?: SettingsSnapshot
  groups?: readonly UISettingsGroup[]
  actions?: readonly UISettingsAction[]
  values?: Record<string, unknown>
  unsupported?: string[]
  locale?: 'en' | 'ru'
}

/** Read a dotted path from a JSON payload. */
export function readPath(source: unknown, path: string): unknown {
  let node: unknown = source
  for (const part of path.split('.')) {
    if (node === null || typeof node !== 'object') return undefined
    node = (node as Record<string, unknown>)[part]
  }
  return node
}

/** Rows of a list/table payload, unwrapping the known response envelopes. */
export function payloadRows(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) return payload as Record<string, unknown>[]
  if (payload === null || typeof payload !== 'object') return []
  const record = payload as Record<string, unknown>
  for (const key of ['items', 'backups', 'rows', 'entries']) {
    const value = record[key]
    if (Array.isArray(value)) return value as Record<string, unknown>[]
  }
  const data = record['data']
  if (Array.isArray(data)) return data as Record<string, unknown>[]
  return []
}

/** Unwrap `{ ok, status }` / `{ ok, item }` envelopes used by the adapters. */
export function payloadBody(payload: unknown): unknown {
  if (payload === null || typeof payload !== 'object') return payload
  const record = payload as Record<string, unknown>
  if (record['status'] !== undefined && typeof record['status'] === 'object') return record['status']
  if (record['item'] !== undefined && typeof record['item'] === 'object') return record['item']
  return payload
}

export function stringValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}
