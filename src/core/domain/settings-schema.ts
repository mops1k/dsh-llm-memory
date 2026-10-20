/**
 * Universal settings surface: the single source of truth for *what* every
 * harness panel shows — fields, groups and actions — independent of how a panel
 * looks. DSH renders it in its embedded client, Kilo in its standalone
 * dashboard, OpenCode/MCP in their own pages; a panel that adds or drops a
 * field/action is a parity defect (tests/settings-schema.test.ts enforces it).
 *
 * Paths are dotted keys of `MemoryConfig`, so a field maps 1:1 to the core
 * configuration and no adapter invents its own names.
 */

/** How a field is edited; panels map these to their own controls. */
export type SettingsFieldType = 'text' | 'textarea' | 'number' | 'boolean' | 'select' | 'list' | 'readonly'

export interface SettingsOption {
  value: string
  label: string
}

export interface SettingsField {
  /** Dotted path inside `MemoryConfig` (`embeddings.model`). */
  path: string
  /** Human label shown by every panel. */
  label: string
  /** Russian label for panels that render a Russian UI. */
  labelRu?: string
  /** One-line explanation of what the value does. */
  hint: string
  type: SettingsFieldType
  options?: readonly SettingsOption[]
  min?: number
  max?: number
  step?: number
  /** Takes effect only after the plugin restarts. */
  restartRequired?: boolean
}

export interface SettingsGroup {
  id: string
  title: string
  /** Russian title for panels that render a Russian UI. */
  titleRu?: string
  fields: readonly SettingsField[]
}

const PROVIDERS: readonly SettingsOption[] = [
  { value: 'off', label: 'off — lexical search only' },
  { value: 'local', label: 'local — on-device model' },
  { value: 'http', label: 'http — remote endpoint (reserved)' },
]

const BACKENDS: readonly SettingsOption[] = [
  { value: 'off', label: 'off' },
  { value: 'js', label: 'js — in-process scan' },
  { value: 'sqlite-vec', label: 'sqlite-vec' },
]

const QUANTIZATION: readonly SettingsOption[] = [
  { value: 'float', label: 'float32' },
  { value: 'int8', label: 'int8' },
  { value: 'bit', label: 'bit' },
]

const RECALL_FORMATS: readonly SettingsOption[] = [
  { value: 'markdown', label: 'markdown' },
  { value: 'table', label: 'table' },
  { value: 'timeline', label: 'timeline' },
  { value: 'json', label: 'json' },
]

const SCOPES: readonly SettingsOption[] = [
  { value: 'project', label: 'project + user layer' },
  { value: 'user', label: 'user layer only' },
  { value: 'all', label: 'all projects' },
]

const RULE_SCOPES: readonly SettingsOption[] = [
  { value: 'project', label: 'project' },
  { value: 'all', label: 'all' },
]

/** Groups rendered by every panel, in this order. */
export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  {
    id: 'storage',
    title: 'Storage & projects',
    fields: [
      {
        path: 'storageRoot',
        label: 'Storage root',
        hint: 'Directory of the store; empty falls back to $DSH_HOME/llm-memory (DSH) or the harness default.',
        type: 'text',
        restartRequired: true,
      },
      {
        path: 'projectRoots',
        label: 'Project roots (key -> absolute path)',
        hint: 'Registered project roots, read-only here; add projects through the host.',
        type: 'readonly',
      },
      {
        path: 'projectScanBudgetMs',
        label: 'Index pass budget (ms)',
        hint: 'Per-base-directory time budget of one index pass; 0 = unlimited.',
        type: 'number',
        min: 0,
        max: 600000,
        step: 100,
      },
      {
        path: 'webPath',
        label: 'WebUI base path',
        hint: 'Base HTTP path of the WebUI and API; takes effect after restart.',
        type: 'text',
        restartRequired: true,
      },
      {
        path: 'backupDir',
        label: 'Backup directory',
        hint: 'Directory for manual .llmmem backups; empty means <storageRoot>/backups.',
        type: 'text',
      },
    ],
  },
  {
    id: 'recall',
    title: 'Recall & context',
    fields: [
      {
        path: 'recallLimit',
        label: 'Recall entries',
        hint: 'Default number of entries returned by recall.',
        type: 'number',
        min: 1,
        max: 100,
        step: 1,
      },
      {
        path: 'recallTextChars',
        label: 'Entry budget (chars)',
        hint: 'Character budget of one entry body in digest rendering.',
        type: 'number',
        min: 200,
        max: 10000,
        step: 100,
      },
      {
        path: 'recallTotalChars',
        label: 'Total budget (chars)',
        hint: 'Hard character budget of a whole recall rendering.',
        type: 'number',
        min: 500,
        max: 100000,
        step: 500,
      },
      {
        path: 'recallFormat',
        label: 'Default format',
        hint: 'Format recall renders with when the caller does not ask for one.',
        type: 'select',
        options: RECALL_FORMATS,
      },
      {
        path: 'recallAllowFormatOverride',
        label: 'Allow per-call format',
        hint: 'When off, recall is pinned to the default format.',
        type: 'boolean',
      },
      {
        path: 'recallLiteralLookup',
        label: 'Literal lookup',
        hint: 'Let the lexical leg decide the order for error codes, versions, file names and ids.',
        type: 'boolean',
      },
      {
        path: 'recallScope',
        label: 'Default scope',
        hint: 'Scope recall uses when the caller does not pass one.',
        type: 'select',
        options: SCOPES,
      },
      {
        path: 'promptRulesLimit',
        label: 'Rules in prompt',
        hint: 'Maximum rules/preferences lines injected into the system prompt.',
        type: 'number',
        min: 0,
        max: 200,
        step: 1,
      },
      {
        path: 'rulesPromptScope',
        label: 'Rules scope',
        hint: 'Project reach of the rules digest.',
        type: 'select',
        options: RULE_SCOPES,
      },
      {
        path: 'sessionStartGuide',
        label: 'Session start guide',
        hint: 'Inject the short memory guide once at session start.',
        type: 'boolean',
      },
      {
        path: 'systemPrompt',
        label: 'System prompt guidance',
        hint: 'Guidance injected into the model context.',
        type: 'textarea',
      },
    ],
  },
  {
    id: 'embeddings',
    title: 'RAG (vector search)',
    fields: [
      {
        path: 'embeddings.provider',
        label: 'Embedding provider',
        hint: 'off keeps lexical search; local loads the on-device model.',
        type: 'select',
        options: PROVIDERS,
        restartRequired: true,
      },
      {
        path: 'embeddings.backend',
        label: 'Vector backend',
        hint: 'Where vectors live; off disables the vector leg.',
        type: 'select',
        options: BACKENDS,
        restartRequired: true,
      },
      {
        path: 'embeddings.quantization',
        label: 'Quantization',
        hint: 'Storage precision of the sqlite-vec table.',
        type: 'select',
        options: QUANTIZATION,
      },
      {
        path: 'embeddings.model',
        label: 'Model',
        hint: 'Model identifier passed to the provider and stored with every vector.',
        type: 'text',
        restartRequired: true,
      },
      {
        path: 'embeddings.dim',
        label: 'Dimensions',
        hint: 'Vector length of that model.',
        type: 'number',
        min: 1,
        max: 8192,
        step: 1,
      },
      {
        path: 'embeddings.topK',
        label: 'Vector neighbours',
        hint: 'Chunk hits requested from the vector leg before rank fusion.',
        type: 'number',
        min: 1,
        max: 100,
        step: 1,
      },
      {
        path: 'embeddings.minScore',
        label: 'Minimum similarity',
        hint: 'Minimum cosine similarity for a vector hit to count.',
        type: 'number',
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        path: 'embeddings.batchSize',
        label: 'Batch size',
        hint: 'Texts embedded per provider call.',
        type: 'number',
        min: 1,
        max: 256,
        step: 1,
      },
      {
        path: 'embeddings.chunkChars',
        label: 'Chunk size (chars)',
        hint: 'Target characters per indexed chunk.',
        type: 'number',
        min: 100,
        max: 8000,
        step: 50,
      },
      {
        path: 'embeddings.chunkOverlap',
        label: 'Chunk overlap',
        hint: 'Characters neighbouring chunks share.',
        type: 'number',
        min: 0,
        max: 4000,
        step: 10,
      },
      {
        path: 'embeddings.queryPrefix',
        label: 'Query prefix',
        hint: 'Prefix added to a search query before embedding.',
        type: 'text',
      },
      {
        path: 'embeddings.passagePrefix',
        label: 'Passage prefix',
        hint: 'Prefix added to a stored chunk before embedding.',
        type: 'text',
      },
      {
        path: 'embeddings.semanticEdgesPerEntry',
        label: 'Semantic edges per entry',
        hint: 'Semantic neighbours kept per entry in the knowledge graph.',
        type: 'number',
        min: 0,
        max: 50,
        step: 1,
      },
      {
        path: 'embeddings.semanticMaxEdges',
        label: 'Semantic edges cap',
        hint: 'Upper bound of semantic edges stored in the graph.',
        type: 'number',
        min: 0,
        max: 10000,
        step: 10,
      },
      {
        path: 'embeddings.prewarm',
        label: 'Prewarm model at startup',
        hint: 'Load the embedding model in the background at startup.',
        type: 'boolean',
      },
    ],
  },
  {
    id: 'maintenance',
    title: 'Lint & lifecycle',
    fields: [
      {
        path: 'lintOverlapMinCommonWords',
        label: 'Overlap minimum words',
        hint: 'Minimum significant common words for a lint overlap pair.',
        type: 'number',
        min: 1,
        max: 20,
        step: 1,
      },
      {
        path: 'lintMaxPairs',
        label: 'Overlap pairs limit',
        hint: 'Maximum overlap pairs reported by lint; 0 = unlimited.',
        type: 'number',
        min: 0,
        max: 10000,
        step: 1,
      },
      {
        path: 'autonomous',
        label: 'Autonomous memory',
        hint: 'Whether the assistant may manage memory without asking.',
        type: 'boolean',
      },
      {
        path: 'requireConfirmation',
        label: 'Confirm destructive operations',
        hint: 'Whether destructive memory operations must be confirmed by the user.',
        type: 'boolean',
      },
    ],
  },
]

/** Groups of actions every panel must expose, with their semantics. */
export type SettingsActionGroup = 'backup' | 'model' | 'maintenance' | 'index'

export interface SettingsAction {
  /** Stable id: panels map it to their transport, not to their own semantics. */
  id: string
  group: SettingsActionGroup
  label: string
  hint?: string
  /** Requires the user to confirm with this word before running. */
  confirm?: string
  danger?: boolean
  mode: 'read' | 'write'
}

export const SETTINGS_ACTIONS: readonly SettingsAction[] = [
  { id: 'backup.list', group: 'backup', label: 'List backups', mode: 'read' },
  { id: 'backup.create', group: 'backup', label: 'Create backup', mode: 'write' },
  { id: 'backup.verify', group: 'backup', label: 'Verify backup', mode: 'read' },
  {
    id: 'backup.restore',
    group: 'backup',
    label: 'Restore backup',
    hint: 'Replaces the live store with the archive contents.',
    confirm: 'RESTORE',
    danger: true,
    mode: 'write',
  },
  {
    id: 'backup.delete',
    group: 'backup',
    label: 'Delete backup',
    confirm: 'DELETE',
    danger: true,
    mode: 'write',
  },
  { id: 'model.status', group: 'model', label: 'Model status', mode: 'read' },
  { id: 'model.download', group: 'model', label: 'Download model', mode: 'write' },
  { id: 'model.remove', group: 'model', label: 'Remove model', confirm: 'DELETE', danger: true, mode: 'write' },
  { id: 'lint.run', group: 'maintenance', label: 'Lint', mode: 'read' },
  { id: 'heal.report', group: 'maintenance', label: 'Heal report', mode: 'read' },
  { id: 'heal.apply', group: 'maintenance', label: 'Heal apply', mode: 'write' },
  { id: 'vectors.rebuild', group: 'index', label: 'Rebuild vectors', mode: 'write' },
  { id: 'vectors.health', group: 'index', label: 'Vector health', mode: 'read' },
  { id: 'vectors.repair', group: 'index', label: 'Repair vectors', mode: 'write' },
  { id: 'vectors.embed', group: 'index', label: 'Embed pending entries', mode: 'write' },
]

/** Russian labels of the action registry, keyed by the same ids. */
const RU_ACTION_LABELS: Record<string, string> = {
  'backup.list': 'Список бэкапов',
  'backup.create': 'Создать бэкап',
  'backup.verify': 'Проверить бэкап',
  'backup.restore': 'Восстановить из бэкапа',
  'backup.delete': 'Удалить бэкап',
  'model.status': 'Статус модели',
  'model.download': 'Скачать модель',
  'model.remove': 'Удалить модель',
  'lint.run': 'Проверка',
  'heal.report': 'Отчёт оздоровления',
  'heal.apply': 'Оздоровление (применить)',
  'vectors.rebuild': 'Перестроить векторы',
  'vectors.health': 'Здоровье векторов',
  'vectors.repair': 'Оздоровление векторов',
  'vectors.embed': 'Доиндексировать',
}

/** Actions with the labels of the requested locale (English is the base). */
export function localizedActions(locale: 'en' | 'ru'): SettingsAction[] {
  if (locale === 'en') return SETTINGS_ACTIONS as SettingsAction[]
  return SETTINGS_ACTIONS.map(action => {
    const label = RU_ACTION_LABELS[action.id]
    return label === undefined ? action : { ...action, label }
  })
}

/** Read a dotted value out of a config-like object. */
export function readSettingValue(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((node, part) => {
    if (node === null || typeof node !== 'object') return undefined
    return (node as Record<string, unknown>)[part]
  }, source)
}

/**
 * Write a dotted value into a patch object, creating intermediate objects.
 * Used by panels to turn their form state into a core-config patch.
 */
export function writeSettingValue(patch: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.')
  let node = patch
  for (const part of parts.slice(0, -1)) {
    const next = node[part]
    if (next === null || typeof next !== 'object' || Array.isArray(next)) node[part] = {}
    node = node[part] as Record<string, unknown>
  }
  node[parts[parts.length - 1] as string] = value
}

/** All field paths in render order (used by parity tests and panels). */
export function settingsFieldPaths(): string[] {
  return SETTINGS_GROUPS.flatMap(group => group.fields.map(field => field.path))
}

/**
 * Config keys that deliberately have no panel control. Team sync is groundwork
 * only (ADR-006): enabling it must not be possible from a UI before a transport,
 * review flow and conflict handling exist, so the block stays out of
 * {@link SETTINGS_GROUPS} while remaining part of `MemoryConfig`.
 */
export const RESERVED_SETTING_PATHS: readonly string[] = ['sync.enabled', 'sync.team', 'sync.remote']

/** Russian panel labels, keyed by the same paths/groups as the schema. */
const RU_GROUP_TITLES: Record<string, string> = {
  storage: 'Хранилище и проекты',
  recall: 'Recall и контекст',
  embeddings: 'RAG (векторный поиск)',
  maintenance: 'Lint и жизненный цикл',
}

const RU_FIELD_LABELS: Record<string, string> = {
  storageRoot: 'Корень хранилища',
  projectRoots: 'Корни проектов (ключ -> путь)',
  projectScanBudgetMs: 'Бюджет прохода индексации (мс)',
  webPath: 'Базовый путь WebUI',
  backupDir: 'Каталог бэкапов',
  recallLimit: 'Записей в recall',
  recallTextChars: 'Бюджет записи (символов)',
  recallTotalChars: 'Общий бюджет (символов)',
  recallFormat: 'Формат по умолчанию',
  recallAllowFormatOverride: 'Разрешать формат в вызове',
  recallLiteralLookup: 'Литеральный поиск',
  recallScope: 'Область по умолчанию',
  promptRulesLimit: 'Правил в промпте',
  rulesPromptScope: 'Область правил',
  sessionStartGuide: 'Гайд при старте сессии',
  systemPrompt: 'Текст системного промпта',
  'embeddings.provider': 'Провайдер эмбеддингов',
  'embeddings.backend': 'Векторный бэкенд',
  'embeddings.quantization': 'Квантование',
  'embeddings.model': 'Модель',
  'embeddings.dim': 'Размерность',
  'embeddings.topK': 'Соседей в recall',
  'embeddings.minScore': 'Минимальная близость',
  'embeddings.batchSize': 'Размер батча',
  'embeddings.chunkChars': 'Размер чанка (символов)',
  'embeddings.chunkOverlap': 'Перекрытие чанков',
  'embeddings.queryPrefix': 'Префикс запроса',
  'embeddings.passagePrefix': 'Префикс пассажа',
  'embeddings.semanticEdgesPerEntry': 'Семантических связей на запись',
  'embeddings.semanticMaxEdges': 'Лимит семантических связей',
  'embeddings.prewarm': 'Прогрев модели при старте',
  lintOverlapMinCommonWords: 'Пересечение: минимум слов',
  lintMaxPairs: 'Пересечение: лимит пар',
  autonomous: 'Автономная память',
  requireConfirmation: 'Подтверждать разрушительные операции',
}

/** Groups with the labels of the requested locale (English is the base). */
export function localizedSettingsGroups(locale: 'en' | 'ru'): SettingsGroup[] {
  if (locale === 'en') return SETTINGS_GROUPS.map(group => group)
  return SETTINGS_GROUPS.map(group => ({
    ...group,
    title: group.titleRu ?? RU_GROUP_TITLES[group.id] ?? group.title,
    fields: group.fields.map(field => ({
      ...field,
      label: field.labelRu ?? RU_FIELD_LABELS[field.path] ?? field.label,
    })),
  }))
}
