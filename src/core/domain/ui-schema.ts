/**
 * Universal UI schema: every screen a panel draws — dashboards, entry tables,
 * the editor, the graph, health reports, settings, backups, the model and the
 * RAG vector map — described once in the core and rendered by each harness in
 * its own design. Panels do not invent screens, columns or actions of their own.
 */
import { SETTINGS_ACTIONS } from './settings-schema.js'

export const UI_SCHEMA_VERSION = 1

/** Data operations a widget may read; the ids of the SDK surface. */
export type UIOperation =
  | 'status'
  | 'projects.list'
  | 'items.list'
  | 'items.get'
  | 'graph'
  | 'lint.report'
  | 'heal.report'
  | 'health'
  | 'backup.list'
  | 'model.status'
  | 'settings.snapshot'
  | 'vectors.health'
  | 'vectors.repair'
  | 'vectors.embed'
  | 'vectors.map'

/** All operations the schema is allowed to reference. */
export const UI_OPERATIONS: readonly UIOperation[] = [
  'status',
  'projects.list',
  'items.list',
  'items.get',
  'graph',
  'lint.report',
  'heal.report',
  'health',
  'backup.list',
  'model.status',
  'settings.snapshot',
  'vectors.health',
  'vectors.repair',
  'vectors.embed',
  'vectors.map',
]

export interface UISourceRef {
  operation: UIOperation
  /** Fixed query parameters the panel must send with the operation. */
  params?: Record<string, string>
}

export interface UIMetric {
  /** Dotted path inside the operation payload. */
  path: string
  label: string
  labelRu?: string
}

export interface UITableColumn {
  /** Dotted path inside an entry payload. */
  path: string
  label: string
  labelRu?: string
}

export interface UIEditorField {
  path: string
  label: string
  labelRu?: string
  type: 'text' | 'textarea' | 'number' | 'select' | 'list'
  options?: readonly { value: string; label: string }[]
}

export type UIWidget =
  | { kind: 'stats'; source: UISourceRef; metrics: readonly UIMetric[] }
  | {
      kind: 'table'
      source: UISourceRef
      columns: readonly UITableColumn[]
      /** Page navigation of the list; every panel renders the same sizes. */
      pagination?: { pageSizes: readonly number[]; defaultPageSize: number }
    }
  | { kind: 'graph'; source: UISourceRef }
  | { kind: 'report'; source: UISourceRef }
  | { kind: 'form'; source: UISourceRef }
  | { kind: 'actions'; actions: readonly string[] }
  | {
      kind: 'vector-map'
      source: UISourceRef
      /** Extra operations the map view also reads (health, stats). */
      extra?: readonly UISourceRef[]
      params?: readonly { name: string; label: string; min?: number; max?: number; step?: number }[]
    }
  | { kind: 'editor'; fields: readonly UIEditorField[] }
  | {
      kind: 'search'
      source: UISourceRef
      columns: readonly UITableColumn[]
      pagination?: { pageSizes: readonly number[]; defaultPageSize: number }
    }

export interface UIView {
  id: string
  title: string
  titleRu?: string
  widgets: readonly UIWidget[]
}

const ENTRY_COLUMNS: readonly UITableColumn[] = [
  { path: 'title', label: 'Title', labelRu: 'Заголовок' },
  { path: 'kind', label: 'Kind', labelRu: 'Категория' },
  { path: 'tier', label: 'Tier', labelRu: 'Уровень' },
  { path: 'scope', label: 'Scope', labelRu: 'Область' },
  { path: 'project', label: 'Project', labelRu: 'Проект' },
  { path: 'importance', label: 'Importance', labelRu: 'Важность' },
  { path: 'updatedAt', label: 'Updated', labelRu: 'Обновлено' },
]

/** Screens every panel must render, in navigation order. */
export const UI_VIEWS: readonly UIView[] = [
  {
    id: 'overview',
    title: 'Overview',
    titleRu: 'Обзор',
    widgets: [
      {
        kind: 'stats',
        source: { operation: 'status' },
        metrics: [
          { path: 'total', label: 'Entries', labelRu: 'Записей' },
          { path: 'active', label: 'Active', labelRu: 'Активных' },
          { path: 'byKind.rules', label: 'Rules', labelRu: 'Правил' },
          { path: 'byKind.preferences', label: 'Preferences', labelRu: 'Предпочтений' },
          { path: 'projects', label: 'Projects', labelRu: 'Проектов' },
        ],
      },
      { kind: 'actions', actions: ['lint.run', 'heal.report'] },
    ],
  },
  {
    id: 'items',
    title: 'Entries',
    titleRu: 'Записи',
    widgets: [
      {
        kind: 'table',
        source: { operation: 'items.list', params: { sort: 'updated' } },
        columns: ENTRY_COLUMNS,
        pagination: { pageSizes: [12, 24, 48, 96], defaultPageSize: 24 },
      },
    ],
  },
  {
    id: 'editor',
    title: 'Edit entry',
    titleRu: 'Редактирование',
    widgets: [
      {
        kind: 'editor',
        fields: [
          { path: 'title', label: 'Title', labelRu: 'Заголовок', type: 'text' },
          { path: 'text', label: 'Text', labelRu: 'Текст', type: 'textarea' },
          {
            path: 'kind',
            label: 'Kind',
            labelRu: 'Категория',
            type: 'select',
            options: [
              { value: 'rules', label: 'rules' },
              { value: 'preferences', label: 'preferences' },
              { value: 'decisions', label: 'decisions' },
              { value: 'facts', label: 'facts' },
              { value: 'architecture', label: 'architecture' },
              { value: 'concepts', label: 'concepts' },
            ],
          },
          {
            path: 'tier',
            label: 'Tier',
            labelRu: 'Уровень',
            type: 'select',
            options: [
              { value: 'normal', label: 'normal' },
              { value: 'important', label: 'important' },
              { value: 'immutable', label: 'immutable' },
            ],
          },
          { path: 'importance', label: 'Importance', labelRu: 'Важность', type: 'number' },
          { path: 'tags', label: 'Tags', labelRu: 'Теги', type: 'list' },
          { path: 'keywords', label: 'Keywords', labelRu: 'Ключевые слова', type: 'text' },
        ],
      },
    ],
  },
  {
    id: 'recall',
    title: 'Recall',
    titleRu: 'Поиск',
    widgets: [
      {
        kind: 'search',
        source: { operation: 'items.list' },
        columns: ENTRY_COLUMNS,
        pagination: { pageSizes: [10, 20, 50], defaultPageSize: 20 },
      },
    ],
  },
  {
    id: 'graph',
    title: 'Knowledge graph',
    titleRu: 'Граф знаний',
    widgets: [{ kind: 'graph', source: { operation: 'graph' } }],
  },
  {
    id: 'map',
    title: 'RAG map',
    titleRu: 'Карта RAG',
    widgets: [
      {
        kind: 'vector-map',
        source: { operation: 'vectors.map', params: { refresh: '1' } },
        extra: [{ operation: 'vectors.health' }, { operation: 'status' }],
        params: [
          { name: 'minScore', label: 'Minimum similarity', min: 0, max: 1, step: 0.01 },
          { name: 'topK', label: 'Neighbours', min: 1, max: 50, step: 1 },
        ],
      },
      { kind: 'actions', actions: ['vectors.rebuild'] },
    ],
  },
  {
    id: 'health',
    title: 'Health',
    titleRu: 'Здоровье',
    widgets: [
      { kind: 'report', source: { operation: 'lint.report' } },
      { kind: 'report', source: { operation: 'heal.report' } },
      { kind: 'actions', actions: ['lint.run', 'heal.report', 'heal.apply', 'vectors.health', 'vectors.repair', 'vectors.embed', 'vectors.rebuild'] },
    ],
  },
  {
    id: 'settings',
    title: 'Settings',
    titleRu: 'Настройки',
    widgets: [{ kind: 'form', source: { operation: 'settings.snapshot' } }],
  },
  {
    id: 'backup',
    title: 'Backups',
    titleRu: 'Бэкапы',
    widgets: [
      { kind: 'table', source: { operation: 'backup.list' }, columns: [
        { path: 'name', label: 'Archive', labelRu: 'Архив' },
        { path: 'createdAt', label: 'Created', labelRu: 'Создан' },
        { path: 'sizeBytes', label: 'Size', labelRu: 'Размер' },
      ] },
      { kind: 'actions', actions: ['backup.create', 'backup.verify', 'backup.restore', 'backup.delete'] },
    ],
  },
  {
    id: 'model',
    title: 'Embedding model',
    titleRu: 'Модель эмбеддингов',
    widgets: [
      {
        kind: 'stats',
        source: { operation: 'model.status' },
        metrics: [
          { path: 'model', label: 'Model', labelRu: 'Модель' },
          { path: 'cached', label: 'Cached', labelRu: 'В кэше' },
          { path: 'files', label: 'Files', labelRu: 'Файлов' },
          { path: 'bytes', label: 'Bytes', labelRu: 'Байт' },
          { path: 'dir', label: 'Directory', labelRu: 'Каталог' },
        ],
      },
      { kind: 'actions', actions: ['model.download', 'model.remove'] },
    ],
  },
]

/** Ids of all screens a panel must expose. */
export const UI_VIEW_IDS: readonly string[] = UI_VIEWS.map(view => view.id)

/** Ids of all operations referenced by the schema. */
export function uiReferencedOperations(): UIOperation[] {
  const operations = new Set<UIOperation>()
  for (const view of UI_VIEWS) {
    for (const widget of view.widgets) {
      if ('source' in widget && widget.source) operations.add(widget.source.operation)
      if (widget.kind === 'vector-map') for (const extra of widget.extra ?? []) operations.add(extra.operation)
    }
  }
  return [...operations]
}

/** Ids of all actions referenced by the schema. */
export function uiReferencedActions(): string[] {
  const actions = new Set<string>()
  for (const view of UI_VIEWS) {
    for (const widget of view.widgets) {
      if (widget.kind === 'actions') for (const action of widget.actions) actions.add(action)
    }
  }
  return [...actions]
}

/** Known action ids (the settings registry owns them). */
export const UI_KNOWN_ACTIONS: readonly string[] = SETTINGS_ACTIONS.map(action => action.id)


/** Localise a widget's own labels (columns, metrics, editor fields). */
function localizeWidget(widget: UIWidget): UIWidget {
  switch (widget.kind) {
    case 'stats':
      return { ...widget, metrics: widget.metrics.map(item => ({ ...item, label: item.labelRu ?? item.label })) }
    case 'table':
    case 'search':
      return { ...widget, columns: widget.columns.map(item => ({ ...item, label: item.labelRu ?? item.label })) }
    case 'editor':
      return {
        ...widget,
        fields: widget.fields.map(item => ({ ...item, label: item.labelRu ?? item.label })),
      }
    default:
      return widget
  }
}

/** Views with the titles and widget labels of the requested locale (English is the base). */
export function localizedViews(locale: 'en' | 'ru'): UIView[] {
  if (locale === 'en') return UI_VIEWS.map(view => view)
  return UI_VIEWS.map(view => ({
    ...view,
    title: view.titleRu ?? view.title,
    widgets: view.widgets.map(localizeWidget),
  }))
}
