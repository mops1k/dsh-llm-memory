# Universal UI SDK (LLM Memory)

Ядро описывает **весь интерфейс** — экраны, настройки, действия и источники данных, — а панель харнесса только
отрисовывает снимок в своём дизайне и своим способом встраивания (слоты DSH, отдельная страница Kilo/OpenCode/MCP).
Панель не добавляет свои поля, экраны, колонки или действия: расхождение — дефект паритета, его ловят тесты.

- `src/core/domain/settings-schema.ts` — настройки и реестр действий.
- `src/core/domain/ui-schema.ts` — экраны, виджеты, операции, пагинация.
- `src/core/domain/ui-contract.ts` — снимки для панелей и версия контракта.
- `src/core/domain/settings-schema.ts` (`localizedSettingsGroups`) и `ui-schema.ts` (`localizedViews`) — локализация.

Версии: `UI_SCHEMA_VERSION = 1`, `UI_CONTRACT_VERSION = 1`. При несовместимом изменении формы снимка версия
увеличивается, а панель обязана проверить поле `version`.

## 1. Схема настроек

`SETTINGS_GROUPS` — 5 групп, 40 полей. Пути (`path`) — **dotted-пути `MemoryConfig`**, поэтому поле 1:1
соответствует конфигу ядра и не требует собственных имён в адаптерах.

| Группа | Поля (path) |
|---|---|
| `storage` | `storageRoot`, `projectRoots` (readonly), `projectScanBudgetMs`, `webPath`, `backupDir` |
| `recall` | `recallLimit`, `recallTextChars`, `recallTotalChars`, `recallFormat`, `recallAllowFormatOverride`, `recallLiteralLookup`, `recallScope`, `promptRulesLimit`, `rulesPromptScope`, `sessionStartGuide`, `systemPrompt` |
| `embeddings` | `embeddings.provider`, `.backend`, `.quantization`, `.model`, `.dim`, `.topK`, `.minScore`, `.batchSize`, `.chunkChars`, `.chunkOverlap`, `.queryPrefix`, `.passagePrefix`, `.semanticEdgesPerEntry`, `.semanticMaxEdges`, `.prewarm` |
| `maintenance` | `lintOverlapMinCommonWords`, `lintMaxPairs`, `autonomous`, `requireConfirmation` |

Поле (`SettingsField`) принимает:

```ts
{
  path: string          // dotted-путь в MemoryConfig
  label: string         // английская подпись (базовая)
  labelRu?: string      // русская подпись
  hint: string          // пояснение (английское)
  type: 'text' | 'textarea' | 'number' | 'boolean' | 'select' | 'list' | 'readonly'
  options?: { value: string; label: string }[]   // для select
  min?: number; max?: number; step?: number      // для number
  restartRequired?: boolean                      // применяется после рестарта плагина
}
```

Значения по умолчанию — `DEFAULT_CONFIG` из `@llm-memory/core/domain/config`; схема не дублирует defaults,
тест сверяет покрытие: каждый ключ `DEFAULT_CONFIG` обязан иметь поле.

**Список значений** (`list`) — массив строк; панель редактирует его как многострочный текст.
`readonly` — показывается, но не редактируется (`projectRoots`).

Хелперы: `readSettingValue(source, path)`, `writeSettingValue(patch, path, value)` — безопасно читают/пишут
вложенные значения и создают промежуточные объекты.

## 2. Реестр действий

`SETTINGS_ACTIONS` — 14 действий. Панель обязана уметь все; действие адресуется `id`, транспорт — свойство адаптера.

| id | group | mode | confirm / danger |
|---|---|---|---|
| `backup.list` | backup | read | — |
| `backup.create` | backup | write | — |
| `backup.verify` | backup | read | — |
| `backup.restore` | backup | write | `RESTORE`, danger |
| `backup.delete` | backup | write | `DELETE`, danger |
| `model.status` | model | read | — |
| `model.download` | model | write | — |
| `model.remove` | model | write | `DELETE`, danger |
| `lint.run` | maintenance | read | — |
| `heal.report` | maintenance | read | — |
| `heal.apply` | maintenance | write | — |
| `vectors.rebuild` | index | write | — |
| `vectors.health` | index | read | — |

`UI_ACTION_NAMES` и `isUIAction(name)` — guard: панель вызывает только действия реестра.

## 3. Схема интерфейса (экраны и виджеты)

`UI_VIEWS` — 10 экранов в порядке навигации:

| id | Назначение | Виджеты |
|---|---|---|
| `overview` | сводка | `stats` (total/active/byKind/projects), `actions` (lint/heal report) |
| `items` | записи | `table` (колонки + пагинация) |
| `editor` | создание/правка | `editor` (поля записи) |
| `recall` | поиск | `search` (запрос + результаты, пагинация) |
| `graph` | граф знаний | `graph` |
| `map` | **карта RAG** | `vector-map` (vectors.map + vectors.health + status, параметры minScore/topK), `actions` (vectors.rebuild) |
| `health` | здоровье | `report` (lint), `report` (heal), `actions` (lint.run/heal.apply) |
| `settings` | настройки | `form` (settings.snapshot) |
| `backup` | бэкапы | `table` (архивы), `actions` (create/verify/restore/delete) |
| `model` | модель эмбеддингов | `stats` (model.status), `actions` (download/remove) |

Виджеты (`UIWidget`):

```ts
{ kind: 'stats';  source: UISourceRef; metrics: { path; label; labelRu? }[] }
{ kind: 'table';  source: UISourceRef; columns: { path; label; labelRu? }[]; pagination?: Pagination }
{ kind: 'search'; source: UISourceRef; columns; pagination? }
{ kind: 'graph';  source: UISourceRef }
{ kind: 'report'; source: UISourceRef }        // markdown-строка в ответе
{ kind: 'form';   source: UISourceRef }        // группы настроек
{ kind: 'actions'; actions: string[] }         // id из SETTINGS_ACTIONS
{ kind: 'vector-map'; source; extra?: UISourceRef[]; params?: {name;label;min?;max?;step?}[] }
{ kind: 'editor'; fields: UIEditorField[] }
```

`UISourceRef = { operation: UIOperation; params?: Record<string,string> }` — какие параметры панель обязана
передать с запросом. Разрешённые операции (`UI_OPERATIONS`):
`status`, `projects.list`, `items.list`, `items.get`, `graph`, `lint.report`, `heal.report`, `health`,
`backup.list`, `model.status`, `settings.snapshot`, `vectors.health`, `vectors.map`.

**Пагинация списков** (общая для всех панелей):

```ts
pagination: { pageSizes: number[]; defaultPageSize: number }
```

- «Записи»: `pageSizes: [12,24,48,96]`, default `24`.
- «Поиск»: `pageSizes: [10,20,50]`, default `20`.

Панель обязана отрисовать селектор размера страницы из `pageSizes` и переходы (Prev/Next) с `limit`/`offset`.
Если пользователь сохранял свой размер, панель вправе его использовать, но только когда он входит в `pageSizes`.

## 4. Снимки для панелей

### Только экраны (DSH)

`GET /llm-memory/api/ui/snapshot` → `panelSnapshot(locale?)`:

```json
{
  "version": 1,
  "views": [{ "id": "items", "title": "Entries", "widgets": [ ... ] }],
  "actions": [ ... ],
  "operations": [ "status", "items.list", "vectors.map", ... ]
}
```

DSH-клиент берёт из снимка таб-бар и порядок экранов, а значения настроек — из своего settings-сервиса.

### Экраны + значения настроек (Kilo/OpenCode/MCP)

`GET /api/legacy/ui/snapshot` → `panelSnapshot('ru')` (русские `title`).
`GET /api/legacy/settings/snapshot` → `{ ok: true, snapshot, unsupported }`, где
`snapshot = { version, groups, actions, values }`, а `unsupported` — пути ядра, которые Kilo-рантайм пока не применяет.

`uiSnapshot(config, locale)` возвращает всё сразу: `views + settings (с values) + actions + operations` —
для панелей, которые не имеют собственного settings-сервиса.

## 5. Как добавить настройку

1. Поле в `MemoryConfig` (`src/core/domain/config.ts`) + default + нормализация в `mergeConfig`.
2. Поле в `SETTINGS_GROUPS` (правильная группа, `path`, подписи en/ru, `hint`, тип, ограничения).
3. Если DSH должен сохранять поле — добавить в схему `src/adapters/dsh/settings.ts` и маппинг `SETTING_KEY_FOR_PATH`.
4. Прогнать тесты: `tests/settings-core-schema.test.ts`, `tests/settings-schema.test.ts`, `tests/ui-contract.test.ts`.
5. Панели получают поле автоматически; отдельный код в панели запрещён.

## 6. Как добавить экран/виджет

1. `UIView` в `UI_VIEWS` + при необходимости новый `kind` в `UIWidget` и `UIOperation` в `UI_OPERATIONS`.
2. Если это действие — `SETTINGS_ACTIONS` (id, label, mode, confirm/danger).
3. Адаптеры обязаны реализовать операцию и отрисовать виджет; неизвестный `kind` панель не рисует и тест
   паритета должен падать.
4. Тесты: `tests/ui-schema.test.ts` (операции/действия/экраны), `tests/ui-contract.test.ts`, панельные тесты.

## 7. Правила паритета (что проверяется)

- `tests/settings-core-schema.test.ts` — схема покрывает все ключи `DEFAULT_CONFIG`, пути уникальны, у каждого
  действия с `danger: true` есть `confirm`.
- `tests/settings-schema.test.ts` — каждый плоский ключ DSH-настроек имеет путь ядра; панельный паритет:
  DSH и Kilo отдают одинаковые группы и пути полей; форматы `recallFormat` совпадают с union ядра.
- `tests/ui-schema.test.ts` — 10 экранов на месте; карта RAG ссылается на `vectors.map`/`vectors.health`;
  виджеты ссылаются только на известные операции; пагинация у списков объявлена.
- `tests/kilo-legacy-server.test.ts` — реальный HTTP-сервер Kilo: снимок экранов, backup-цикл, импорт.

**Определение готовности**: набор экранов/полей/действий сверен тестами **и** панель проверена в живом GUI.
Отсутствие расхождений в тестах не заменяет живую проверку; «готово» без неё не объявляется.

## 8. Дизайн панелей

Один дизайн на все поверхности — принятый `panel-ui-prototype`:

- `src/ui/design/panel/` — исходники (shell, `styles/tokens.css` + `styles/app.css`, ES-модули экранов,
  dev-сервер и проверки SDK-фикстуры).
- `src/ui/design/panel.html` — **генерируемый** однофайловый вариант для Kilo/OpenCode:
  `scripts/build-panel.mjs` инлайнит CSS и собирает JS через esbuild; файл вшивается в бандлы обоих плагинов
  (`scripts/build-kilo.mjs`, `scripts/build-opencode.mjs`). Руками его не правят.
- DSH `/ui` (React, `src/ui/web`) берёт те же CSS-токены и компонентные классы: `scripts/build-web-styles.mjs`
  генерирует `src/ui/web/styles.css.ts`, тест `tests/web-styles.test.ts` не даёт копии разойтись с оригиналом.
- DSH-панель в оболочке (`client/client.js`) **сохраняет горизонтальные табы** и не встраивает настройки
  (у DSH свой раздел Settings). Содержимое экранов повторяет прототип: `scripts/build-client-css.mjs`
  генерирует скоупленную копию CSS (`.lm-panel`), `scripts/copy-client.mjs` вклеивает её в `lib/client.js`.
  Тема определяется по `--dsw-*` (data-theme, color-scheme и яркость слоя), поэтому светлая/тёмная
  оболочка не расходится. `<style>` внедряется один раз, классы прототипа не протекают в dsh shell.

Правило: дизайн меняется только по прямой задаче; данные и схема по-прежнему живут отдельно, панель ничего
не добавляет от себя.

## 9. Ограничения текущего этапа

- `vectors.rebuild`/`vectors.health`/`vectors.map` работают в DSH и в Kilo: карта RAG рисует PCA-проекцию,
  rebuild активен при живой ноге (см. `docs/panel-api.md` §«Векторы и RAG», ADR-010).
- DSH-панель рендерит экраны из снимка; живая GUI-проверка выполняется после рестарта DSH.
- Настройки, которые Kilo-рантайм не применяет, отдаются в `unsupported` и показываются disabled — это
  видимый долг паритета, а не молчаливое расхождение.
