# Panel HTTP API (DSH и Kilo)

Справочник по HTTP-поверхности, которую отрисовывают панели. Ядро одно, поэтому семантика операций совпадает;
отличаются только базовые пути и форма ответа legacy-адаптера.

- DSH: база `/llm-memory` (настраивается `webPath`), API — `/llm-memory/api/*`.
- Kilo: страницы на `http://<host>:<port>/` — `/` общий schema-driven UI, `/legacy` прежний дашборд,
  `/web.js` бандл; API — `/api/legacy/*`.
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

Общая панель Kilo (`/`) — тот же React-рендерер, что у OpenCode/MCP: навигация и виджеты берутся из
`/api/legacy/ui/snapshot`, настройки — из `/api/legacy/settings/snapshot` (группы/поля/значения ядра),
действия — из реестра. Операция → маршрут:

| Операция | Маршрут |
|---|---|
| `ui.snapshot` | `GET /api/legacy/ui/snapshot` |
| `settings.snapshot` | `GET /api/legacy/settings/snapshot` |
| `status`, `items.list`, `items.get`, `graph`, `lint.report`, `health` | `GET /api/legacy/*` |
| `heal.report`, `heal.apply` | `POST /api/legacy/heal` (`{mode}`) |
| `items.save` / `items.update` / `items.forget` / `items.delete` | `POST|PUT|POST|DELETE /api/legacy/items[/{{id}}]` |
| `settings.save` | `PUT /api/legacy/settings` |
| `ui.locale.set` | `PUT /api/legacy/config` (`{uiLocale}`) |
| `action.backup.*`, `action.model.*` | `POST /api/legacy/{backups,model}/*` |

Смена языка (`ru`/`en`) сохраняется в `uiLocale` конфига Kilo и применяется к странице при следующей загрузке;
`?locale=ru` переопределяет её для одного запроса snapshot. RAG-карта пока показывает «недоступно» — ждёт
`VectorLeg` из плана `p_c7de70db394f`.

`PUT /api/legacy/settings` принимает **плоский патч dotted-путей**:

```json
{ "recallLimit": 12, "embeddings.topK": 10 }
```

Ответ:

```json
{ "ok": true, "applied": ["recallLimit"], "unsupported": ["embeddings.topK"], "config": { ... } }
```

`unsupported` — пути, которые Kilo-рантайм пока не применяет; они не сохраняются и показываются в панели disabled.
`PUT` сохраняет конфиг в `~/.config/kilo/llm-memory.json` (старый `kilo-memory.json` читается как fallback,
запись всегда в новый файл).

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
{ provider, model, configured, enabled, dir, cached, files, bytes, downloading, progress, error }
```

Кэш: `<store>/_models/<model>/` (голое имя вида `multilingual-e5-small` нормализуется в `Xenova/...`).

Если рантайм эмбеддингов в хосте недоступен (однофайловый Kilo-плагин), `model.download` переключается на
**скачивание файлов по HTTP** с Hugging Face прямо в кэш (выбирается квантованная ONNX-модель, прогресс и
резюмирование по `content-length`): файлы появляются на диске, статус `cached: true`, но `enabled` остаётся
`false` — загрузка модели и RAG требуют решения по упаковке (P4 плана). При `provider: "off"` скачивание
возвращает 400 с причиной
(«switch embeddings provider to local…»); статус при этом доступен всегда. Логика общая — core `ModelManager`.

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
