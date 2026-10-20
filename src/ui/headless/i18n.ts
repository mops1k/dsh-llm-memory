/**
 * Shared UI localisation. Locale is chosen on first start and stored by the
 * adapter; a skipped choice falls back to `en` (ADR-004).
 */
export const UI_LOCALES = ['ru', 'en'] as const
export type UiLocale = (typeof UI_LOCALES)[number]

export function isUiLocale(value: unknown): value is UiLocale {
  return value === 'ru' || value === 'en'
}

/** Locale resolution: explicit choice wins, then host locale, then `en`. */
export function resolveLocale(stored?: string | null, hostLocale?: string | null): UiLocale {
  if (isUiLocale(stored)) return stored
  if (hostLocale && hostLocale.toLowerCase().startsWith('ru')) return 'ru'
  return 'en'
}

const EN = {
  'nav.status': 'Status',
  'nav.items': 'Entries',
  'nav.graph': 'Graph',
  'nav.lint': 'Lint',
  'nav.health': 'Health',
  'nav.settings': 'Settings',
  'nav.backup': 'Backup',
  'status.entries': 'Entries',
  'status.active': 'Active',
  'status.scopes': 'Scopes',
  'status.projects': 'Projects',
  'status.lastUpdated': 'Last update',
  'items.search': 'Search',
  'items.empty': 'No entries',
  'items.notFound': 'Entry not found',
  'graph.entities': 'Entities',
  'graph.edges': 'Edges',
  'graph.hubs': 'Hubs',
  'lint.ok': 'No issues',
  'lint.issues': 'Issues',
  'health.vectors': 'Vectors',
  'health.model': 'Model',
  'health.ports': 'Ports',
  'settings.saved': 'Saved',
  'settings.invalid': 'Check the highlighted fields',
  'settings.locale': 'Interface language',
  'settings.storageRoot': 'Memory root',
  'settings.recallLimit': 'Recall limit',
  'settings.recallFormat': 'Recall format',
  'settings.autonomous': 'Autonomous writes',
  'settings.vectors': 'Embeddings provider',
  'backup.create': 'Create backup',
  'backup.list': 'Backups',
  'backup.verify': 'Verify',
  'backup.restore': 'Restore',
  'backup.delete': 'Delete',
  'backup.restoreConfirm': 'Type RESTORE to confirm',
  'backup.deleteConfirm': 'Type DELETE to confirm',
  'backup.locked': 'Restore and delete are user-only actions',
  'panel.loading': 'Loading…',
  'panel.failed': 'Request failed',
  'panel.refresh': 'Refresh',
  'panel.save': 'Save',
  'panel.cancel': 'Cancel',
  'editor.id': 'Entry id',
  'editor.load': 'Load',
  'editor.create': 'New entry',
  'editor.save': 'Save entry',
  'editor.forget': 'Forget',
  'editor.delete': 'Delete',
  'settings.unsupported': 'Not applied by this harness',
  'map.unavailable': 'Vector search is not enabled in this harness',
  'items.total': 'Total',
} as const

export type MessageKey = keyof typeof EN

const RU: Record<MessageKey, string> = {
  'nav.status': 'Статус',
  'nav.items': 'Записи',
  'nav.graph': 'Граф',
  'nav.lint': 'Проверка',
  'nav.health': 'Здоровье',
  'nav.settings': 'Настройки',
  'nav.backup': 'Резервные копии',
  'status.entries': 'Записей',
  'status.active': 'Активных',
  'status.scopes': 'Скоупы',
  'status.projects': 'Проекты',
  'status.lastUpdated': 'Последнее обновление',
  'items.search': 'Поиск',
  'items.empty': 'Записей нет',
  'items.notFound': 'Запись не найдена',
  'graph.entities': 'Сущности',
  'graph.edges': 'Связи',
  'graph.hubs': 'Хабы',
  'lint.ok': 'Проблем нет',
  'lint.issues': 'Проблемы',
  'health.vectors': 'Векторы',
  'health.model': 'Модель',
  'health.ports': 'Порты',
  'settings.saved': 'Сохранено',
  'settings.invalid': 'Проверь подсвеченные поля',
  'settings.locale': 'Язык интерфейса',
  'settings.storageRoot': 'Корень памяти',
  'settings.recallLimit': 'Лимит recall',
  'settings.recallFormat': 'Формат recall',
  'settings.autonomous': 'Автономная запись',
  'settings.vectors': 'Провайдер эмбеддингов',
  'backup.create': 'Создать копию',
  'backup.list': 'Резервные копии',
  'backup.verify': 'Проверить',
  'backup.restore': 'Восстановить',
  'backup.delete': 'Удалить',
  'backup.restoreConfirm': 'Введи RESTORE для подтверждения',
  'backup.deleteConfirm': 'Введи DELETE для подтверждения',
  'backup.locked': 'Восстановление и удаление — только действие пользователя',
  'panel.loading': 'Загрузка…',
  'panel.failed': 'Ошибка запроса',
  'panel.refresh': 'Обновить',
  'panel.save': 'Сохранить',
  'panel.cancel': 'Отмена',
  'editor.id': 'Id записи',
  'editor.load': 'Загрузить',
  'editor.create': 'Новая запись',
  'editor.save': 'Сохранить запись',
  'editor.forget': 'Забыть',
  'editor.delete': 'Удалить',
  'settings.unsupported': 'Не применяется этим харнессом',
  'map.unavailable': 'Векторный поиск в этом харнессе не включён',
  'items.total': 'Всего',
}

export interface Translator {
  readonly locale: UiLocale
  t(key: MessageKey): string
}

export function createTranslator(locale: UiLocale): Translator {
  const table = locale === 'ru' ? RU : EN
  return { locale, t: key => table[key] ?? EN[key] ?? key }
}

export const MESSAGE_KEYS = Object.keys(EN) as MessageKey[]
