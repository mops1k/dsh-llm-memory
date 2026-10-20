/**
 * Demo transport: the same operations and payload shapes the real adapters
 * return, backed by a deterministic in-memory store. Nothing here touches the
 * user's memory; the "Demo" badge in the sidebar says so.
 */
import { hashSeed, rng, sleep } from './util.js'

const DAY = 86400000
const HOUR = 3600000
const PROJECTS = [
  'dsh-llm-memory',
  'VoiceTyper',
  'BookShelf',
  'dsh-agent-score',
  'Zapret-DPI-Manager',
  'dsh-plan-store',
  'dsh-jetbrains',
]

const SEED = [
  {
    p: 'dsh-llm-memory', k: 'rules', t: 'immutable', i: 5, title: 'Настройки и действия — часть ядра, панели только рендерят',
    text: 'Схема настроек и реестр действий живут в core/domain. Панель не добавляет свои поля, экраны и колонки: расхождение — дефект паритета, его ловят тесты.',
    tags: ['settings', 'core', 'parity'], kw: 'settings actions core parity', days: 5,
  },
  {
    p: 'dsh-llm-memory', k: 'architecture', t: 'important', i: 5, title: 'UI SDK: ядро отдаёт API, UI отрисовывает, харнесс только монтирует',
    text: 'Экраны, виджеты, операции и снимки описаны в ui-schema.ts и ui-contract.ts. DSH, Kilo, OpenCode и MCP рендерят один контракт в своём дизайне.',
    tags: ['ui-sdk', 'architecture', 'contract'], kw: 'ui sdk snapshot contract widgets', days: 6,
  },
  {
    p: 'dsh-llm-memory', k: 'decisions', t: 'important', i: 5, title: 'Векторный recall: эмбеддинг в worker-потоке, три ноги RRF',
    text: 'BM25, вектор и метаданные объединяются reciprocal rank fusion. Эмбеддинг считается в worker_threads, поэтому recall остаётся асинхронным.',
    tags: ['rag', 'vectors', 'rrf'], kw: 'vector recall embeddings rrf bm25', days: 9,
  },
  {
    p: 'dsh-llm-memory', k: 'facts', t: 'normal', i: 4, title: 'Хранилище памяти: ~/.dsh/llm-memory, страницы по проектам и слой _user',
    text: 'БД в _db/memory.db, страницы проектов в отдельных каталогах, общесистемные факты — в слое _user.',
    tags: ['storage', 'layout'], kw: 'storage pages projects user layer', days: 12,
  },
  {
    p: 'dsh-llm-memory', k: 'architecture', t: 'important', i: 4, title: 'Слоистая структура памяти: проект + _user, реестр projects.json',
    text: 'Поиск по умолчанию идёт по текущему проекту и слою _user; scope=all расширяет его на все проекты.',
    tags: ['storage', 'scope', 'recall'], kw: 'scope project user projects.json', days: 13,
  },
  {
    p: 'dsh-llm-memory', k: 'decisions', t: 'important', i: 4, title: 'Импорт памяти удалён полностью',
    text: 'Фича признана ненужной: удалены core-модуль, HTTP-API, UI, команда /memory import и настройки.',
    tags: ['import', 'removed'], kw: 'import removed cleanup', days: 20,
  },
  {
    p: 'dsh-llm-memory', k: 'facts', t: 'normal', i: 3, title: 'ADR-009: одно дерево src/, без packages/*, сборка в lib/',
    text: 'Плагин — один пакет: слои core/, ui/ и adapters/. Импорты относительные, сборка tsc в lib/.',
    tags: ['adr', 'structure', 'build'], kw: 'adr-009 src flat build lib', days: 25,
  },
  {
    p: 'dsh-llm-memory', k: 'facts', t: 'normal', i: 3, title: 'Пагинация списков приходит из схемы: [12,24,48,96] и [10,20,50]',
    text: 'Записи листаются по 12/24/48/96, поиск — по 10/20/50. Панель не хардкодит размеры страниц.',
    tags: ['ui', 'pagination'], kw: 'pagination page sizes ui', days: 26,
  },
  {
    p: 'dsh-llm-memory', k: 'rules', t: 'important', i: 4, title: 'Карта RAG обязательна в обеих панелях',
    text: 'Экран map ссылается на vectors.map и vectors.health, параметры minScore/topK приходят из схемы.',
    tags: ['ui', 'rag', 'map'], kw: 'rag map vector map pca', days: 28,
  },
  {
    p: 'dsh-llm-memory', k: 'facts', t: 'normal', i: 3, title: 'Kilo production cutover выполнен: плагин установлен, recall на живом сторе',
    text: 'Старый дашборд остался на /legacy, корень отдаёт schema-driven панель.',
    tags: ['kilo', 'cutover'], kw: 'kilo cutover production panel', days: 30,
  },
  {
    p: 'dsh-llm-memory', k: 'architecture', t: 'important', i: 3, title: 'Формат бэкапа .llmmem: магия LLMMEM1, ZIP и manifest с sha256',
    text: 'Опционально AES-256-GCM. Перед восстановлением создаётся pre-restore копия.',
    tags: ['backup', 'format'], kw: 'backup llmmem zip manifest', days: 32,
  },
  {
    p: 'dsh-llm-memory', k: 'concepts', t: 'normal', i: 3, title: 'RRF объединяет BM25, вектор и метаданные без калибровки скоров',
    text: 'Ранжирование по сумме 1/(k+rank): разные шкалы не нужно нормализовать вручную.',
    tags: ['rag', 'rrf', 'recall'], kw: 'rrf fusion ranking retrieval', days: 33,
  },
  {
    p: 'dsh-llm-memory', k: 'decisions', t: 'normal', i: 3, title: 'Язык панели задаётся uiLocale, снимок можно запросить с ?locale=',
    text: 'Русские подписи приходят из схемы: labelRu/titleRu и localizedActions.',
    tags: ['ui', 'locale'], kw: 'locale ui ru en', days: 35,
  },
  {
    p: 'dsh-llm-memory', k: 'facts', t: 'normal', i: 4, title: 'Модель Xenova/multilingual-e5-small, dim 384, кэш в <store>/_models',
    text: 'Готовность считается по целостности: веса .onnx, config.json и токенизатор. Неполный кэш отдаётся в missing.',
    tags: ['embeddings', 'model'], kw: 'model e5 dim cache onnx', days: 36,
  },
  {
    p: 'dsh-llm-memory', k: 'preferences', t: 'normal', i: 2, title: 'Светлая тема удобнее для длинных таблиц и настроек',
    text: 'Тёмная тема нужна для вечерней работы; переключатель должен помнить выбор.',
    tags: ['ui', 'theme'], kw: 'theme light dark ui', days: 38,
  },
  {
    p: 'dsh-llm-memory', k: 'architecture', t: 'normal', i: 4, title: 'Транспорт панели: DSH — /api/*, Kilo/OpenCode/MCP — /api/legacy/*',
    text: 'Семантика операций одна, отличаются базовые пути и форма ответа legacy-адаптера.',
    tags: ['api', 'transport'], kw: 'api transport legacy dsh', days: 40,
  },
  {
    p: 'dsh-llm-memory', k: 'facts', t: 'normal', i: 4, title: 'UI-схема: 10 экранов, 4 группы настроек, 35 полей и 13 действий',
    text: 'Версии контракта: UI_SCHEMA_VERSION=1, UI_CONTRACT_VERSION=1. При несовместимом изменении версия увеличивается.',
    tags: ['ui-sdk', 'schema'], kw: 'schema version fields actions', days: 41,
  },
  {
    p: 'dsh-llm-memory', k: 'decisions', t: 'important', i: 4, title: 'Дизайн панели живёт отдельно от схемы: один panel.html на все HTTP-хосты',
    text: 'Хост передаёт window.__LM_PANEL__ (apiBase, kind, locale), из схемы берутся вкладки, настройки и действия.',
    tags: ['ui', 'design', 'panel'], kw: 'panel design html host', days: 44,
  },
  {
    p: 'VoiceTyper', k: 'facts', t: 'normal', i: 4, title: 'Windows: вставка через WM_CHAR проверяется чтением поля',
    text: 'Подтверждённая доставка считается успешной, только если текст появился в поле; иначе он уходит в буфер обмена.',
    tags: ['windows', 'insertion'], kw: 'wm_char paste windows verification', days: 3,
  },
  {
    p: 'VoiceTyper', k: 'decisions', t: 'normal', i: 4, title: 'Неподтверждённая доставка не теряется: уходит в буфер обмена',
    text: 'Пользователь всегда может вставить текст вручную; лог содержит причину.',
    tags: ['windows', 'clipboard'], kw: 'clipboard fallback windows', days: 7,
  },
  {
    p: 'VoiceTyper', k: 'preferences', t: 'normal', i: 3, title: 'Старт диктовки — Pause/Break, стоп — повторное нажатие',
    text: 'Горячая клавиша не конфликтует с IDE и работает в любом фокусе.',
    tags: ['hotkey', 'ux'], kw: 'hotkey pause break dictation', days: 11,
  },
  {
    p: 'VoiceTyper', k: 'facts', t: 'normal', i: 4, title: 'WSL2 с mirrored-сетью: Windows localhost доступен напрямую',
    text: 'Серверы разработки не требуют проброса портов; из WSL виден Windows localhost.',
    tags: ['wsl', 'network'], kw: 'wsl2 mirrored localhost network', days: 15,
  },
  {
    p: 'VoiceTyper', k: 'concepts', t: 'normal', i: 3, title: 'VAD: порог 0.45, окно 30 мс, гистерезис 120 мс',
    text: 'Порог подобран на живых записях: не режет начало фразы и не ловит шум.',
    tags: ['audio', 'vad'], kw: 'vad threshold audio', days: 21,
  },
  {
    p: 'VoiceTyper', k: 'architecture', t: 'important', i: 3, title: 'Whisper.cpp локально, облачный fallback при лагах',
    text: 'Локальная расшифровка по умолчанию; облако включается только при перегрузке.',
    tags: ['asr', 'whisper'], kw: 'whisper local cloud fallback', days: 24,
  },
  {
    p: 'VoiceTyper', k: 'facts', t: 'normal', i: 3, title: 'Notepad — основной сценарий приёмки вставки',
    text: 'Самый строгий приёмник: проверка идёт по реальному содержимому поля.',
    tags: ['testing', 'notepad'], kw: 'notepad acceptance test', days: 29,
  },
  {
    p: 'BookShelf', k: 'rules', t: 'immutable', i: 5, title: 'TDD обязателен: тест до кода (ADR-012)',
    text: 'Источник — ADR-012 и docs/tdd.md: цикл red → green → refactor, свои типы не мокаются.',
    tags: ['tdd', 'process'], kw: 'tdd adr-012 tests', days: 2,
  },
  {
    p: 'BookShelf', k: 'facts', t: 'normal', i: 4, title: 'JDK 21 для Gradle: ~/.local/share/dsh-jetbrains/jdk-21',
    text: 'Сборка Gradle идёт на JetBrains-рантайме, поэтому отдельный JDK не нужен.',
    tags: ['jdk', 'gradle'], kw: 'jdk gradle jetbrains', days: 8,
  },
  {
    p: 'BookShelf', k: 'architecture', t: 'important', i: 3, title: 'Каталог книг: SQLite + FTS5, поиск по авторам и сериям',
    text: 'Индекс перестраивается из OPF-метаданных; пользовательские полки хранятся отдельно.',
    tags: ['sqlite', 'fts5', 'catalog'], kw: 'sqlite fts5 books catalog', days: 14,
  },
  {
    p: 'BookShelf', k: 'decisions', t: 'normal', i: 3, title: 'Свои типы не мокаются: тесты работают с реальными структурами',
    text: 'Мок разрешён только для внешних границ — файловой системы и сети.',
    tags: ['tdd', 'testing'], kw: 'testing mocks types', days: 17,
  },
  {
    p: 'BookShelf', k: 'facts', t: 'normal', i: 2, title: 'Android Gradle Plugin 8.7.3, compileSdk 35',
    text: 'Обновление AGP требует синхронного обновления JDK и Gradle wrapper.',
    tags: ['android', 'gradle'], kw: 'agp android sdk gradle', days: 27,
  },
  {
    p: 'dsh-agent-score', k: 'architecture', t: 'normal', i: 4, title: 'Оценка задачи через userQuestions-диалог вместо ручной строки',
    text: 'Диалог спрашивает балл и комментарий; ответ уходит только вызывающему, модель его не видит.',
    tags: ['userquestions', 'dialog'], kw: 'userquestions score dialog', days: 4,
  },
  {
    p: 'dsh-agent-score', k: 'facts', t: 'normal', i: 3, title: 'M2.1: интерактивная оценка задачи в диалоге',
    text: 'Экран показывает историю оценок и средний балл по проекту.',
    tags: ['m2.1', 'score'], kw: 'score history average', days: 10,
  },
  {
    p: 'dsh-agent-score', k: 'preferences', t: 'normal', i: 3, title: 'Оценка 1–5, при 1–2 комментарий обязателен',
    text: 'Без пояснения низкая оценка не сохраняется.',
    tags: ['ux', 'score'], kw: 'rating comment validation', days: 18,
  },
  {
    p: 'dsh-agent-score', k: 'decisions', t: 'normal', i: 3, title: 'scoreHigh выставляется при оценке ≥4',
    text: 'Порог вынесен в конфиг, чтобы менять без релиза.',
    tags: ['score', 'config'], kw: 'score high threshold', days: 23,
  },
  {
    p: 'Zapret-DPI-Manager', k: 'facts', t: 'normal', i: 3, title: 'Репозиторий переименован в Zapret-DPI-Manager',
    text: 'Старые ссылки редиректят; релизные артефакты сохранили имена.',
    tags: ['rename', 'release'], kw: 'rename zapret manager', days: 31,
  },
  {
    p: 'Zapret-DPI-Manager', k: 'architecture', t: 'normal', i: 3, title: 'Загрузка файлов GitHub: raw → api.github.com → codeload → зеркало → кэш',
    text: 'Пять уровней fallback, чтобы обновления работали при блокировках.',
    tags: ['github', 'network', 'updates'], kw: 'github raw codeload mirror cache', days: 34,
  },
  {
    p: 'dsh-plan-store', k: 'facts', t: 'normal', i: 4, title: 'Планы живут в SQLite, .md — только экспорт',
    text: 'Источник истины — БД плагина; .dsh/plans/*.md не редактируются руками.',
    tags: ['plans', 'sqlite'], kw: 'plans sqlite export', days: 16,
  },
  {
    p: 'dsh-plan-store', k: 'rules', t: 'important', i: 4, title: 'Не редактировать .dsh/plans вручную',
    text: 'После изменений план экспортируется из хранилища, иначе экспорт и БД расходятся.',
    tags: ['plans', 'rule'], kw: 'plans export rule', days: 19,
  },
  {
    p: 'dsh-plan-store', k: 'facts', t: 'normal', i: 3, title: 'plan_status показывает устаревшие планы и счётчики',
    text: 'Устаревшим считается план без движения дольше настроенного порога.',
    tags: ['plans', 'status'], kw: 'plan status stale', days: 22,
  },
  {
    p: 'dsh-jetbrains', k: 'facts', t: 'normal', i: 3, title: 'JetBrains IDE: ACP-агенты и MCP-сервер в PHPStorm',
    text: 'Плагин поднимает ACP-агента и MCP-сервер, конфиг общий с остальными хостами.',
    tags: ['jetbrains', 'acp', 'mcp'], kw: 'jetbrains acp mcp phpstorm', days: 37,
  },
  {
    p: 'dsh-jetbrains', k: 'concepts', t: 'normal', i: 2, title: 'JDK 21 из JetBrains-рантайма переиспользуется Gradle',
    text: 'Не нужно ставить отдельный JDK на Windows.',
    tags: ['jdk', 'jetbrains'], kw: 'jdk jetbrains gradle', days: 42,
  },
  {
    p: '', s: 'user', k: 'preferences', t: 'normal', i: 4, title: 'Ответы кратко, без туториалов и повторов',
    text: 'Полнота важнее краткости только там, где без неё нельзя проверить результат.',
    tags: ['communication', 'style'], kw: 'style concise answers', days: 1,
  },
  {
    p: '', s: 'user', k: 'rules', t: 'immutable', i: 5, title: 'Секреты и локальные конфиги не попадают в коммиты',
    text: 'Проверка перед коммитом: .env, ключи, машинные пути.',
    tags: ['git', 'security'], kw: 'secrets commits security', days: 39,
  },
  {
    p: '', s: 'user', k: 'facts', t: 'normal', i: 3, title: 'Windows-хост 10.0.26200, WSL2 Ubuntu, Node 24',
    text: 'Сборка и тесты идут в WSL, IDE — на Windows.',
    tags: ['windows', 'wsl', 'environment'], kw: 'windows wsl node environment', days: 43,
  },
  {
    p: 'dsh-llm-memory', k: 'facts', t: 'normal', i: 3, title: 'Kilo: старый дашборд как основной UI',
    text: 'Заменён schema-driven панелью; остался на /legacy.', status: 'superseded',
    tags: ['kilo', 'legacy'], kw: 'kilo dashboard legacy', days: 50, supersededByTitle: 'Kilo production cutover выполнен: плагин установлен, recall на живом сторе',
  },
  {
    p: 'dsh-llm-memory', k: 'decisions', t: 'normal', i: 3, title: 'Экспорт AGENTS.md из памяти',
    text: 'Фича удалена из UI, API и команд.', status: 'superseded',
    tags: ['agents', 'removed'], kw: 'agents export removed', days: 47, supersededByTitle: 'Импорт памяти удалён полностью',
  },
  {
    p: 'dsh-llm-memory', k: 'preferences', t: 'normal', i: 2, title: 'Светлая тема удобнее для длинных таблиц',
    text: 'Дубликат более ранней заметки о теме.', status: 'active',
    tags: ['ui', 'theme'], kw: 'theme light dark ui', days: 37,
  },
]

function idFor(title) {
  return `m_${hashSeed(title).toString(16).padStart(8, '0')}${(hashSeed(`id:${title}`) % 0xffff).toString(16).padStart(4, '0')}`
}

const entries = SEED.map(source => {
  const random = rng(hashSeed(source.title))
  const created = Date.now() - source.days * DAY - Math.floor(random() * 20) * HOUR
  const updated = created + Math.floor(random() * 30) * HOUR
  return {
    id: idFor(source.title),
    scope: source.s ?? 'project',
    project: source.p,
    kind: source.k,
    tier: source.t,
    status: source.status ?? 'active',
    title: source.title,
    text: source.text,
    tags: source.tags ?? [],
    keywords: source.kw ?? '',
    importance: source.i ?? 3,
    supersedes: [],
    supersededBy: [],
    related: [],
    createdAt: new Date(created).toISOString(),
    updatedAt: new Date(updated).toISOString(),
  }
})

// Link superseded entries to their replacements so the drawer can show the chain.
for (const source of SEED) {
  if (!source.supersededByTitle) continue
  const entry = entries.find(item => item.title === source.title)
  const target = entries.find(item => item.title === source.supersededByTitle)
  if (entry && target) {
    entry.supersededBy = [target.id]
    target.supersedes = [...target.supersedes, entry.id]
  }
}

const duplicate = entries.find(item => item.title === 'Светлая тема удобнее для длинных таблиц')
const original = entries.find(item => item.title === 'Светлая тема удобнее для длинных таблиц и настроек')

const backups = [
  {
    archive: 'llmmem-2026-10-19T18-40-12.llmmem',
    createdAt: new Date(Date.now() - 18 * HOUR).toISOString(),
    harness: 'dsh',
    schemaVersion: 1,
    bytes: 21_330_118,
    encrypted: false,
  },
  {
    archive: 'llmmem-2026-10-17T09-05-44.llmmem',
    createdAt: new Date(Date.now() - 3 * DAY - 4 * HOUR).toISOString(),
    harness: 'dsh',
    schemaVersion: 1,
    bytes: 20_118_402,
    encrypted: true,
  },
  {
    archive: 'llmmem-2026-10-12T21-31-09.llmmem',
    createdAt: new Date(Date.now() - 8 * DAY).toISOString(),
    harness: 'dsh',
    schemaVersion: 1,
    bytes: 18_774_921,
    encrypted: false,
  },
]

const model = {
  provider: 'local',
  model: 'Xenova/multilingual-e5-small',
  configured: true,
  enabled: true,
  dir: '~/.dsh/llm-memory/_models/Xenova/multilingual-e5-small',
  cached: true,
  files: 4,
  bytes: 135_392_016,
  downloading: false,
  progress: null,
  error: null,
  runtime: {
    present: true,
    installing: false,
    error: null,
    dir: '~/.config/kilo/node_modules',
    command: 'npm install @huggingface/transformers',
  },
}

const MAP_CENTERS = {
  rules: [-0.62, -0.35],
  preferences: [-0.35, 0.55],
  decisions: [0.1, -0.6],
  facts: [0.5, 0.15],
  architecture: [0.15, 0.55],
  concepts: [0.65, -0.3],
}

const mapPoints = entries.map(entry => {
  const random = rng(hashSeed(`map:${entry.id}`))
  const center = MAP_CENTERS[entry.kind] ?? [0, 0]
  return {
    id: entry.id,
    title: entry.title,
    x: Number((center[0] + (random() - 0.5) * 0.5).toFixed(4)),
    y: Number((center[1] + (random() - 0.5) * 0.5).toFixed(4)),
    kind: entry.kind,
    project: entry.project,
    scope: entry.scope,
    tier: entry.tier,
    status: entry.status,
    chunks: 1 + Math.floor(random() * 3),
  }
})

let lint = null
let healReport = null

function activeEntries() {
  return entries.filter(entry => entry.status === 'active')
}

function computeStatus(project = null) {
  const byKind = {}
  const byScope = {}
  const byStatus = {}
  const byProject = {}
  const scoped = project ? entries.filter(entry => entry.project === project) : entries
  for (const entry of scoped) {
    byKind[entry.kind] = (byKind[entry.kind] ?? 0) + 1
    byScope[entry.scope] = (byScope[entry.scope] ?? 0) + 1
    byStatus[entry.status] = (byStatus[entry.status] ?? 0) + 1
    if (entry.project) byProject[entry.project] = (byProject[entry.project] ?? 0) + 1
  }
  const chunks = mapPoints.reduce((sum, point) => sum + point.chunks, 0)
  return {
    root: '~/.dsh/llm-memory',
    dbPath: '~/.dsh/llm-memory/_db/memory.db',
    dbSizeBytes: 21_889_024,
    total: scoped.length,
    active: byStatus.active ?? 0,
    byStatus,
    byScope,
    byKind,
    byProject,
    projects: Object.keys(byProject).length,
    updatedAt: scoped.length ? new Date(Math.max(...scoped.map(entry => new Date(entry.updatedAt).getTime()))).toISOString() : null,
    vectors: {
      model: model.model,
      backend: 'js',
      chunks,
      entries: entries.length,
      bytes: chunks * 1536,
      pending: 0,
      embedded: chunks,
      running: vectorsState.running,
      disabled: false,
      lastError: null,
    },
  }
}

const vectorsState = { running: false, lastRebuild: null }

function matches(entry, query) {
  if (!query) return true
  const haystack = `${entry.title} ${entry.text} ${entry.tags.join(' ')} ${entry.keywords}`.toLowerCase()
  return query.toLowerCase().split(/\s+/).filter(Boolean).every(token => haystack.includes(token))
}

function scoreEntry(entry, query) {
  if (!query) return 0
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!tokens.length) return 0
  const title = entry.title.toLowerCase()
  const text = entry.text.toLowerCase()
  const tags = entry.tags.join(' ').toLowerCase()
  let score = 0
  for (const token of tokens) {
    if (title.includes(token)) score += 4
    if (tags.includes(token)) score += 2
    if (text.includes(token)) score += 1
  }
  return score
}

function filteredEntries(params = {}) {
  const project = params.project && params.project !== 'all' ? params.project : null
  let list = entries.filter(entry => {
    if (project && entry.project !== project) return false
    if (params.kind && entry.kind !== params.kind) return false
    if (params.tier && entry.tier !== params.tier) return false
    if (params.scope && entry.scope !== params.scope) return false
    if (params.status && entry.status !== params.status) return false
    if (params.query && !matches(entry, params.query)) return false
    return true
  })
  const sort = params.sort ?? 'updated'
  list = [...list].sort((a, b) => {
    if (sort === 'created') return new Date(b.createdAt) - new Date(a.createdAt)
    if (sort === 'importance') return b.importance - a.importance || new Date(b.updatedAt) - new Date(a.updatedAt)
    return new Date(b.updatedAt) - new Date(a.updatedAt)
  })
  return list
}

function buildLint() {
  const list = activeEntries()
  const byTag = new Map()
  for (const entry of list) {
    for (const tag of entry.tags) {
      if (!byTag.has(tag)) byTag.set(tag, [])
      byTag.get(tag).push(entry)
    }
  }
  const pairs = new Map()
  for (const group of byTag.values()) {
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const [a, b] = [group[i], group[j]]
        const key = [a.id, b.id].sort().join('|')
        pairs.set(key, (pairs.get(key) ?? 0) + 1)
      }
    }
  }
  const overlaps = [...pairs.entries()]
    .filter(([, shared]) => shared >= 2)
    .map(([key, shared]) => {
      const [aId, bId] = key.split('|')
      const a = entries.find(entry => entry.id === aId)
      const b = entries.find(entry => entry.id === bId)
      return { a: aId, b: bId, aTitle: a?.title ?? aId, bTitle: b?.title ?? bId, sharedTags: shared }
    })
    .slice(0, 6)
  const stale = list.filter(entry => Date.now() - new Date(entry.updatedAt).getTime() > 180 * DAY)
  const brokenLinks = [
    { from: idFor('Хранилище памяти: ~/.dsh/llm-memory, страницы по проектам и слой _user'), to: 'm_dead0000beef', label: 'удалённая запись о кэше' },
    { from: idFor('Пагинация списков приходит из схемы: [12,24,48,96] и [10,20,50]'), to: 'm_dead0001beef', label: 'устаревшая ссылка на экран' },
  ]
  return {
    totalCount: entries.length,
    activeCount: list.length,
    brokenLinks,
    overlaps,
    overlapsHidden: 0,
    stale: stale.map(entry => ({ id: entry.id, title: entry.title, updatedAt: entry.updatedAt })),
    staleDays: 180,
    duplicates: duplicate && original
      ? [{ id: duplicate.id, title: duplicate.title, duplicateId: original.id, duplicateTitle: original.title }]
      : [],
    promptDigestChars: 1171,
  }
}

function buildHealReport() {
  const report = {
    removedLinks: 2,
    addedBacklinks: 4,
    reindexed: entries.length,
    brokenBefore: 2,
    brokenAfter: 0,
    vectors: {
      checked: entries.length,
      orphansRemoved: 0,
      metadataFixed: 3,
      badRemoved: 0,
      foreignRemoved: 0,
      queued: 0,
      tempFilesSwept: 1,
    },
  }
  healReport = report
  return report
}

function addBackup() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const record = {
    archive: `llmmem-${stamp}.llmmem`,
    createdAt: new Date().toISOString(),
    harness: 'dsh',
    schemaVersion: 1,
    bytes: 21_889_024 + Math.floor(Math.random() * 400_000),
    encrypted: false,
  }
  backups.unshift(record)
  return record
}

export function createDemoApi() {
  lint = buildLint()
  healReport = buildHealReport()

  const delay = () => sleep(110 + Math.random() * 190)

  const api = {
    mode: 'demo',
    source: 'demo',
    settingsReadonly: false,

    async status(params = {}) {
      await delay()
      return computeStatus(params.project && params.project !== 'all' ? params.project : null)
    },
    async projects() {
      await delay()
      const status = computeStatus()
      return Object.keys(status.byProject).sort()
    },
    async items(params = {}) {
      await delay()
      const limit = Math.max(1, Number(params.limit) || 24)
      const offset = Math.max(0, Number(params.offset) || 0)
      const list = filteredEntries(params)
      return { items: structuredClone(list.slice(offset, offset + limit)), total: list.length, limit, offset, query: params.query ?? '' }
    },
    async item(id) {
      await delay()
      const entry = entries.find(item => item.id === id)
      if (!entry) throw new Error(`entry not found: ${id}`)
      return structuredClone(entry)
    },
    async saveItem(payload) {
      await delay()
      const now = new Date().toISOString()
      const existing = payload.id ? entries.find(entry => entry.id === payload.id) : null
      if (existing) {
        Object.assign(existing, payload, { updatedAt: now })
        lint = buildLint()
        return structuredClone(existing)
      }
      const entry = {
        id: idFor(`${payload.title}:${now}`),
        scope: payload.scope ?? 'project',
        project: payload.project ?? '',
        kind: payload.kind ?? 'facts',
        tier: payload.tier ?? 'normal',
        status: 'active',
        title: payload.title ?? 'Без заголовка',
        text: payload.text ?? '',
        tags: payload.tags ?? [],
        keywords: payload.keywords ?? '',
        importance: Number(payload.importance) || 3,
        supersedes: [],
        supersededBy: [],
        related: [],
        createdAt: now,
        updatedAt: now,
      }
      entries.unshift(entry)
      mapPoints.push({ id: entry.id, title: entry.title, x: 0, y: 0, kind: entry.kind, project: entry.project, scope: entry.scope, tier: entry.tier, status: entry.status, chunks: 1 })
      lint = buildLint()
      return structuredClone(entry)
    },
    async forgetEntry(id) {
      await delay()
      const entry = entries.find(item => item.id === id)
      if (!entry) throw new Error(`entry not found: ${id}`)
      entry.status = 'superseded'
      entry.updatedAt = new Date().toISOString()
      lint = buildLint()
      return structuredClone(entry)
    },
    async deleteEntry(id) {
      await delay()
      const index = entries.findIndex(item => item.id === id)
      if (index === -1) throw new Error(`entry not found: ${id}`)
      entries.splice(index, 1)
      lint = buildLint()
      return { ok: true }
    },
    async graph(params = {}) {
      await delay()
      const project = params.project && params.project !== 'all' ? params.project : null
      const list = activeEntries().filter(entry => !project || entry.project === project)
      const entities = list.map(entry => ({ id: entry.id, name: entry.title, kind: entry.kind }))
      const edges = []
      const seen = new Set()
      for (let i = 0; i < list.length; i += 1) {
        for (let j = i + 1; j < list.length; j += 1) {
          const shared = list[i].tags.filter(tag => list[j].tags.includes(tag))
          if (!shared.length) continue
          const key = [list[i].id, list[j].id].sort().join('|')
          if (seen.has(key)) continue
          seen.add(key)
          edges.push({ source: list[i].id, target: list[j].id, type: 'tag', label: shared[0] })
        }
      }
      return { entities, edges: edges.slice(0, 140) }
    },
    async lint(params = {}) {
      await delay()
      const project = params.project && params.project !== 'all' ? params.project : null
      if (!project) return structuredClone(lint)
      const ids = new Set(activeEntries().filter(entry => entry.project === project).map(entry => entry.id))
      return structuredClone({
        ...lint,
        brokenLinks: lint.brokenLinks.filter(link => ids.has(link.from)),
        overlaps: lint.overlaps.filter(pair => ids.has(pair.a) && ids.has(pair.b)),
        duplicates: lint.duplicates.filter(pair => ids.has(pair.id)),
        totalCount: entries.length,
      })
    },
    async heal(mode = 'report') {
      await delay()
      if (mode === 'apply-safe' || mode === 'apply') {
        lint = { ...lint, overlaps: [], duplicates: [], brokenLinks: [], stale: [] }
        return structuredClone(buildHealReport())
      }
      return structuredClone(healReport ?? buildHealReport())
    },
    async backups() {
      await delay()
      return structuredClone(backups)
    },
    async createBackup() {
      await sleep(760)
      const record = addBackup()
      return { archive: record.archive, bytes: record.bytes, manifest: 47, encrypted: false }
    },
    async verifyBackup(name) {
      await sleep(380)
      return { ok: true, archive: name, errors: [], manifest: 47 }
    },
    async restoreBackup(name) {
      await sleep(1200)
      return { restored: true, counts: { entries: entries.length, vectors: mapPoints.length }, integrityCheck: 'ok', preRestoreBackup: `pre-restore-${Date.now()}.llmmem`, rolledBack: false, archive: name }
    },
    async deleteBackup(name) {
      await sleep(320)
      const index = backups.findIndex(record => record.archive === name)
      if (index >= 0) backups.splice(index, 1)
      return { deleted: true, archive: name }
    },
    async modelStatus() {
      await delay()
      return structuredClone(model)
    },
    async downloadModel() {
      if (model.downloading) return structuredClone(model)
      model.downloading = true
      model.progress = 0
      for (let step = 0; step <= 100; step += 4) {
        await sleep(85)
        model.progress = Math.min(100, step + Math.round(Math.random() * 3))
      }
      model.downloading = false
      model.progress = null
      model.cached = true
      model.files = 4
      model.bytes = 135_392_016
      return structuredClone(model)
    },
    async removeModel() {
      await sleep(500)
      model.cached = false
      model.files = 0
      model.bytes = 0
      model.enabled = false
      return structuredClone(model)
    },
    async vectorsHealth() {
      await delay()
      return {
        health: {
          checked: entries.length,
          orphans: [],
          metadataStale: [],
          missing: [],
          partial: [],
          foreign: [],
          badDim: [],
          broken: [],
        },
        checked: entries.length,
      }
    },
    async vectorsMap(params = {}) {
      await delay()
      if (model.provider === 'off') return { map: null, query: null }
      const topK = Math.max(1, Number(params.topK) || 5)
      const project = params.project && params.project !== 'all' ? params.project : null
      const points = mapPoints.filter(point => !project || point.project === project)
      const map = {
        model: model.model,
        dim: 384,
        backend: 'js',
        entries: points.length,
        chunks: points.reduce((sum, point) => sum + point.chunks, 0),
        explained: [0.2138, 0.1476],
        points,
        cached: true,
      }
      let query = null
      const text = String(params.q ?? '').trim()
      if (text) {
        const hits = entries
          .filter(entry => entry.status === 'active' && (!project || entry.project === project))
          .map(entry => ({ entry, score: scoreEntry(entry, text) }))
          .filter(hit => hit.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, topK)
        const nearest = hits.map(hit => ({
          id: hit.entry.id,
          title: hit.entry.title,
          score: Number(Math.min(0.98, 0.42 + hit.score * 0.04).toFixed(3)),
          kind: hit.entry.kind,
        }))
        const anchor = points.find(point => point.id === nearest[0]?.id)
        query = {
          text,
          x: anchor ? anchor.x + 0.06 : 0.1,
          y: anchor ? anchor.y - 0.05 : 0.1,
          nearest,
        }
      }
      return { map, query }
    },
    async rebuildVectors() {
      vectorsState.running = true
      vectorsState.lastRebuild = new Date().toISOString()
      setTimeout(() => { vectorsState.running = false }, 2200)
      await sleep(420)
      return { ok: true, status: computeStatus().vectors }
    },
    async recall(query, params = {}) {
      await delay()
      const limit = Math.max(1, Number(params.limit) || 20)
      const project = params.project && params.project !== 'all' ? params.project : null
      const tokens = String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean)
      const scored = entries
        .filter(entry => entry.status === 'active' && (!project || entry.project === project))
        .map(entry => ({ entry, score: scoreEntry(entry, query) }))
        .filter(hit => hit.score > 0)
        .sort((a, b) => b.score - a.score)
      const items = scored.slice(0, limit).map((hit, index) => {
        const sources = ['bm25']
        if (index % 2 === 0 || hit.score >= 8) sources.push('vector')
        if (project || hit.entry.tier === 'important' || hit.entry.importance >= 4) sources.push('metadata')
        return {
          ...structuredClone(hit.entry),
          score: Number(Math.min(0.99, 0.35 + hit.score * 0.05).toFixed(3)),
          sources,
        }
      })
      const vectorHits = items.filter(item => item.sources.includes('vector')).length
      return {
        items,
        total: items.length,
        text: tokens.length
          ? `Гибридный поиск «${tokens.join(' ')}»: ${items.length} совпадений; BM25 + вектор (${vectorHits} через RRF), фильтр проекта: ${project ?? 'все'}.`
          : 'Пустой запрос: возвращены последние записи.',
        sources: Object.fromEntries(items.map(item => [item.id, item.sources])),
      }
    },
    async settingsSnapshot() {
      await delay()
      return null
    },
    async updateSettings(patch) {
      await delay()
      return { applied: Object.keys(patch).length, demo: true }
    },
  }
  return api
}

export const DEMO_PROJECTS = PROJECTS
