# Panel HTTP API (DSH и Kilo)

Справочник по HTTP-поверхности, которую отрисовывают панели. Ядро одно, поэтому семантика операций совпадает;
отличаются только базовые пути и форма ответа legacy-адаптера.

- DSH: база `/llm-memory` (настраивается `webPath`), API — `/llm-memory/api/*`.
- Kilo: страница на `http://<host>:<port>/` отдаёт общий дизайн панели (`src/ui/design/panel.html`),
  тот же файл будет у OpenCode/MCP; API — `/api/legacy/*`.
- Все ответы — JSON (`content-type: application/json`), ошибки — `{ "error": "..." }` с 4xx.
- DSH-web принимает только loopback (`127.0.0.1/::1`), иначе 403.

## 1. Экраны и настройки

| Операция | DSH | Kilo |
|---|---|---|
| снимок экранов | `GET /api/ui/snapshot` | `GET /api/legacy/ui/snapshot[?locale=ru]` |
| схема настроек + значения | `GET /api/settings/schema` | `GET /api/legacy/settings/snapshot` |
| сохранить настройки | через settings-сервис DSH | `PUT /api/legacy/settings` |
| сырой конфиг | — | `GET|PUT /api/legacy/config` |

Подробная форма полей/экранов — в [ui-sdk.md](ui-sdk.md).

Дизайн панели живёт отдельно от схемы: один файл `src/ui/design/panel.html` (CSS + разметка + JS) для
Kilo/OpenCode/MCP, хост передаёт ему `window.__LM_PANEL__` (`apiBase`, `kind`, `locale`). Из схемы дизайн берёт:

- вкладки, порядок и заголовки — `ui.snapshot.views`;
- настройки — `settings.snapshot` (группы/поля/значения, `unsupported`);
- действия — `ui.snapshot.actions` (метки с локалью) и `actions`-виджеты экранов (видимость/порядок);
- пагинацию и колонки — `pagination` и `table.columns`;
- KPI обзора — `stats.metrics`, данные — `source.operation`.

Кастомные блоки дизайна (фильтры, график с зумом, карта RAG) остаются его собственной логикой поверх этих данных.
RAG-карта показывает «недоступно» — ждёт `VectorLeg` из плана `p_c7de70db394f`.

## 2. Данные

### Список записей

DSH: `GET /api/items?query=&kind=&scope=&status=&project=&limit=&offset=`
Kilo: `GET /api/legacy/items?q=&project=&kind=&scope=&status=&tier=&limit=&offset=&sort=`

- `limit` по умолчанию 50 (DSH) / 24 (Kilo), `offset` — смещение; `project=all`/пусто — без фильтра.
- `query`/`q` — полнотекстовый фильтр (title + text + tags + keywords).
- Ответ: `{ items: MemoryEntry[], total, limit, offset, query }`.
  При заданном `query` `total` — число совпадений (DSH), иначе — общее число по фильтру.
- `sort`: `updated` (по умолчанию), `created`, `importance`.

### Одна запись

DSH: `GET /api/item?id=...` → `{ item }`; 404 — нет записи.
Kilo: `GET /api/legacy/items/:id` → `{ ok, item }`.

### Создание/правка/удаление

DSH: `POST /api/save` (полный объект записи), `POST /api/forget` (id), `POST /api/delete` (id).
Kilo: `POST /api/legacy/items` (создание/upsert), `POST /api/legacy/items/:id/forget`, `POST /api/legacy/items/:id/delete`.

### Граф / проверки / здоровье

DSH: `GET /api/graph`, `GET /api/lint`, `POST /api/heal` (`{ mode: "report" | "apply-safe" }`), `GET /api/vectors/health`.
Kilo: `GET /api/legacy/graph`, `GET /api/legacy/lint`, `POST /api/legacy/heal` (`{ mode }`), `GET /api/legacy/health`.

Отчёты `lint`/`heal` в Kilo — **markdown-строки** (как в прежнем дашборде), в DSH — структурированные объекты.
Фильтр `?project=` применяется к `/items`, `/status`, `/graph`, `/lint`, `/heal`.

### Векторы и RAG (Kilo)

Векторная нога общая (`VectorLeg` ядра); эндпоинты отдают её состояние, карту и очередь:

- `GET /api/legacy/vectors/status` → `{ ok, status: EmbeddingQueueStatus | null }` — индекс, очередь,
  последний сбой; `null` — нога выключена (provider `off`, нет рантайма или модели).
- `GET /api/legacy/vectors/health` → `{ ok, health: VectorHealth | null }` — сверка `memory_vectors` со
  страницами: `orphans`, `missing`, `partial`, `stale`-метаданные, `foreign`, `badDim`, `broken`.
- `GET /api/legacy/vectors/map?refresh=1&q=<текст>&limit=5` → `{ ok, map: VectorMap | null, query }` —
  PCA-проекция векторов записей (кэшируется по счётчикам индекса) и позиция запроса с ближайшими id.
- `POST /api/legacy/vectors/rebuild` → `{ ok, status }` — очистить кэш векторов и поставить полный
  backfill в фоновую очередь.
- `POST /api/legacy/vectors/embed` → `{ ok, status }` — довести очередь до конца (maintenance/тесты).
- `GET /api/legacy/recall?q=<текст>&limit=20` → `{ ok, items, text, sources }` — гибридный поиск:
  лексическая нога (FTS5) + семантическая (RRF), `sources[id] = ["bm25","vector","metadata"]`.
  Панель «Поиск» ходит сюда, а не в `/items?q=` — иначе семантика не видна.

Карта в панели рисуется из `vectors/map` (SVG-проекция, маркер запроса), кнопка «Перестроить векторы»
активна, когда нога жива. При выключенной ноге эндпоинты отвечают `200` с `null` и текстовой причиной.

### Проекты

Kilo: `GET /api/legacy/projects` → `{ ok: true, projects: string[] }` — ключи проектов, извлечённые из store
(плюс зарегистрированные roots). Пустой список раньше ломал панель: все записи показывались как один проект.
DSH: проекты приходят в `GET /api/status` (`byProject`, `projects`).

## 3. Бэкапы

Kilo:

| Запрос | Тело | Ответ |
|---|---|---|
| `GET /api/legacy/backups` | — | `{ ok, backups: BackupRecord[] }` |
| `POST /api/legacy/backups/create` | `{}` | `{ ok, report: { archive, bytes, manifest, encrypted } }` |
| `POST /api/legacy/backups/verify` | `{ name }` | `{ ok, report: { ok, archive, errors, manifest } }` |
| `POST /api/legacy/backups/restore` | `{ name, confirm: "RESTORE" }` | `{ ok, report: { restored, counts, integrityCheck, preRestoreBackup, rolledBack } }` |
| `POST /api/legacy/backups/delete` | `{ name, confirm: "DELETE" }` | `{ ok, deleted }` |

DSH: `GET /api/backup` (список) и `POST /api/backup` c `{ operation, archive?, name?, confirm? }`, где
`operation` ∈ `backup.create|backup.list|backup.verify|backup.restore|backup.delete`.

`memory.backupDir`: пусто → `<store>/backups`; **относительный** путь (`"backups"`) разрешается от store, а не от
cwd процесса; абсолютный Windows (`C:\...`), UNC и Linux (`/...`) — как есть. Ответы содержат `backupsDir`,
а панель показывает точный путь архива после создания и в списке (кнопка «Копировать путь»).

Формат архива `.llmmem`: магия `LLMMEM1` + ZIP (stored) + `manifest.json` с sha256 по каждому файлу;
опционально AES-256-GCM. Имя архива в Kilo принимается только как basename — пути извне отклоняются.
Перед восстановлением создаётся pre-restore копия; в Kilo store на время restore закрывается и открывается заново.

## 4. Модель эмбеддингов

Kilo: `GET /api/legacy/model/status`, `POST /api/legacy/model/download`, `POST /api/legacy/model/remove`.
DSH: `GET /api/model/status`, `POST /api/model/download`, `POST /api/model/remove`.

Ответ — `ModelStatus`:

```ts
{ provider, model, configured, enabled, dir, cached, files, bytes, downloading, progress, error,
  missing?: string[],                       // каких файлов не хватает (config.json, токенизатор, веса)
  runtime?: { present, installing, error, dir, command } }  // только Kilo: рантайм эмбеддингов
```

Кэш: `<store>/_models/<model>/` (голое имя вида `multilingual-e5-small` нормализуется в `Xenova/...`);
на обеих платформах путь один и тот же, модель переносится вместе со стором (ADR-010).

Готовность считается по **целостности**, а не по наличию одного файла: `inspectModelCache` требует веса
`.onnx`, `config.json` и токенизатор; неполный кэш отдаётся в `missing`, а `enabled` остаётся `false`.

Kilo: однофайловый плагин без общего `node_modules`. При явном `model.download` сначала (если пакета нет)
ставится рантайм `@huggingface/transformers` в `~/.config/kilo/node_modules` через npm, затем качаются веса
(или используются уже лежащие в сторе) — `runtime.installing/progress` видны в панели, при неудаче приходит
команда для ручной установки. На старте плагина установка не запускается. Если рантайма нет и поставить его
нельзя, остаётся **скачивание только файлов** по HTTP (квантованная ONNX-модель, прогресс и резюмирование по
`content-length`): `cached: true`, `enabled: false`. При `provider: "off"` скачивание возвращает 400
(«switch embeddings provider to local…»); статус доступен всегда. DSH использует общий optional-пакет
`@huggingface/transformers` и воркер, поэтому `runtime` не отдаёт.

## 5. Именование и пути

- Продукт: **LLM Memory** (оба харнесса); инструменты — `llm_memory_*`.
- Kilo-плагин: `~/.config/kilo/plugin/llm-memory.js` (старый `kilo-memory.js` не создаётся).
- Конфиг Kilo: `~/.config/kilo/llm-memory.json`; fallback на чтение `kilo-memory.json`.
- Store Kilo: `<storageRoot>` (по умолчанию `~/.config/kilo/memory`), БД `<store>/db/memory.db`, страницы
  `<repo>/.kilo/memory`, бэкапы `<store>/backups`.
- Store DSH: `$DSH_HOME/llm-memory` (по умолчанию `~/.dsh/llm-memory`).

## 6. Что исправлено (журнал)

| Симптом | Причина | Исправление |
|---|---|---|
| `[object Object]` в отчётах Kilo | старый дашборд ждёт markdown-строку, отдавался объект | `/lint`, `/heal` возвращают markdown |
| Все проекты смешаны в один | `/projects` отдавал `[]`, `/items` игнорировал `?project=` | проекты из store; фильтр в items/status/graph/lint/heal |
| Пустые настройки в Kilo | рендер падал: GET уходил с телом | `api()` без body для GET; схема-рендер |
| Пустая панель DSH (старый баг) | бандл по неверному пути | `import(base + '/ui/web-ui.js')` |
| `Illegal invocation` на fetch | оторванный `fetch` | `fetch.bind(globalThis)` |
| Ложные «полные настройки» в Kilo | проверялась только страница | задача возвращена в `blocked`, паритет по схеме |
| Экспорт `AGENTS.md` | устаревшая фича | удалён из UI/API/команд/конфига |
| Бэкап отдельным пунктом меню DSH | решение без согласования | перенесён в карточку настроек над кнопками сохранения |
| Модель: нет кнопок в Kilo | не был подключён `ModelManager` | общий `ModelManager` + `/model/*` + карточка |
| Пагинация не по схеме | размеры были захардкожены | `pagination` в схеме, обе панели из неё |
| Импорт памяти | фича признана ненужной | удалён полностью: core-модуль, API, UI, команда `/memory import`, настройки |
| Kilo-панель: свой дашборд | дублировал экраны/настройки | `/` рендерит общий schema-driven UI, прежний дашборд остался на `/legacy` |
| Язык панели Kilo | локаль была захардкожена | `uiLocale` в конфиге, переключатель в панели, `?locale=` для snapshot |
