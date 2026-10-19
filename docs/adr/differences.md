# Реестр различий DSH и kilocode

Каждая строка — различие, влияющее на общий core. Колонка «Проверено»: `код` — снято с
кода на этой машине (DSH — этот репозиторий, Kilo — `C:\Users\Kvintilyanov\.config\kilo`
через `/mnt/c`), `план` — взято из `.dsh/plans/llm-memory-unified-core.md` §3 и кодом не
подтверждено. Решение указывает на ADR или правило, которое различие закрывает.

| ID | Область | DSH | kilocode | Влияние | Решение | Проверено |
|---|---|---|---|---|---|---|
| D-01 | Упаковка/runtime | ESM, `tsc`, Node ^22.19 || >=24 | сырые TS, Bun, `@kilocode/plugin` 7.4.22 | сборка и runtime-порты | build + bundle, entrypoints адаптера | код |
| D-02 | Entry point | Cordis `apply(ctx, config)` | `Plugin` с `tool/hooks/dispose` | нет общего входа | отдельные адаптеры в `packages/adapter` | код |
| D-03 | Хранилище | `~/.dsh/llm-memory`, `<repo>/.dsh/llm-memory`, `_db/memory.db`, `projects.json` | `~/.config/kilo/memory` (единая центральная `memory/db/memory.db`), `<repo>/.kilo/memory` | пути и реестр проектов | `LayoutPort`, без знания чужих путей (ADR-002) | код |
| D-04 | Скоупы | `project`, `user` | `global` (101), `project` (250) | разная семантика | core `global|project|user`, адаптер маппит | код |
| D-05 | Схема БД | `text`, `project`, `ext_key`, `path`, `file_size`, `file_mtime_ms` | `content`, `tier`, `status`, `title`, `tags`, `keywords`, `importance`, `consolidation`, `confidence`, `accessCount`, `lastAccess`, `file`, `mtimeMs`, `project_root`, `source`, `supersedes`, `supersededBy`, `related` | потеря колонок при переносе | надмножество; Kilo — `ALTER TABLE` (ADR-002, этап 3) | код |
| D-06 | FTS | по `text` | FTS5 по `id,title,content,keywords,tags` | производный индекс не совпадает | перестроить FTS после миграции | код |
| D-07 | Frontmatter | camelCase, читает snake_case | только snake_case (`created_at`, `access_count`, `superseded_by`, `consolidation`, `confidence`) | страницы не читаются чужим ридером | dual-read + passthrough неизвестных ключей в `extra` | код |
| D-08 | Потеря полей | writer теряет `consolidation`, `accessCount`, `lastAccess` | writer теряет `extKey`, `project` | тихая порча данных | superset writer, проброс неизвестных полей | план |
| D-09 | Индекс | `path + size + mtime`, budget на медленные монтирования | `file + mtime`, TTL | разный инкрементальный reconcile | fingerprint `path+size+mtime` в core | план |
| D-10 | Ранжирование | RRF 3 ноги: BM25, metadata, vector; provenance; literal lookup | RRF + `accessCount` (log2), `consolidation`, confidence decay с half-life; graph boost | прямая замена ухудшит выдачу | superset ranking с флагами | код (graph boost — план) |
| D-11 | Векторы | chunks, embeddings, worker, sqlite-vec/js, queue, model cache | нет: в БД нет векторных таблиц | новая подсистема | опционально, `off` до spike (этап 9) | код |
| D-12 | Граф | вычисляется на чтение | persisted `memory_entities`/`memory_edges` | две модели | computed + persisted fallback | код |
| D-13 | Инструменты | `llm_memory_recall/save/forget/status` | `memory_recall/save/forget/delete/status/lint/graph` | имена и набор | единые `llm_memory_*` без aliases (ADR-003) | код |
| D-14 | Prompt | frozen при `agent/created` | dynamic на каждом `system.transform` | разное поведение контекста | `promptMode`, default `dynamic`; DSH — frozen в своём конфиге | код |
| D-15 | Обслуживание | lint, heal, vector repair | consolidate/promote/reinforce/crystallize/selfHeal | разные пайплайны | всё в core, Kilo-функции сохраняются | план |
| D-16 | Конфигурация | schemastery settings | `kilo-memory.json` + env, порт панели 8787 (`config.ts:54`) | разные схемы | `ConfigPort` + общая схема настроек | код |
| D-17 | UI | WebUI через `ctx.webServer` + нативные `SettingsForms` | standalone `Bun.serve:8787` + `web-ui.html` 77 КБ | разные хосты | `ui/headless` + `ui/web` + `ui/theme`; DSH гибрид (ADR-004) | код |
| D-18 | Импорт | импортёры Kilo/mnemon/dsh-memory | нет | соблазн межхарнесного переноса | межхарнесный импорт не портируется (ADR-002) | план |
| D-19 | Проекты | `projects.json`, basename-ключ | `pickProjectRoot`, маркеры проекта, `<repo>/.kilo/memory` | разные правила | у каждого layout свой реестр | код |
| D-20 | Конкурентность | долгоживущий store | open-on-demand, close-after-op | блокировки SQLite | оба режима + WAL, busy_timeout | план |
| D-21 | Индексирование | FTS по всем записям | FTS только по `active` (301 из 351) | после миграции индекс неполный | перестроить FTS по всем записям, зафиксировать семантику в тестах | код |

## Уточнения к плану, снятые при baseline

- Записей в Kilo — **351**, а не 336 (снимок 19.10.2026): `active` 301, `global` 101,
  `project` 250. Инвариант миграции — «ни одна запись не потеряна», не «336 → 336».
- `tests/` в DSH содержит 29 файлов `*.test.ts` (плюс `helpers.ts` и `tests/helpers/`);
  цифра «29» в плане верна, «31» — это число записей каталога, а не тестов.
- DSH-ядро использует `node:sqlite` `DatabaseSync` напрямую (`src/core/store.ts:11`) —
  это подтверждает правило импортов по слоям (ADR-008).
- Sanitized fixture Kilo собрана из настоящей схемы: `tests/fixtures/kilo/`.
