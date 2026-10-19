# Baseline этапа 0 (19.10.2026)

Исходное состояние перед объединением кодовой базы. Всё, что помечено «проверено», снято
с этой машины 19.10.2026; всё, что помечено «из плана», взято из
`.dsh/plans/llm-memory-unified-core.md` §2–3 и здесь не проверялось.

## DSH (проверено)

- Репозиторий: `/home/mops1k/Development/dsh-llm-memory`, HEAD `51b776b`
  (`chore(release): 1.4.0`), тег `v1.4.0`, 44 коммита.
- Пакет: `dsh-llm-memory@1.4.0`, ESM, `engines: ^22.19.0 || >=24.0.0`, сборка `tsc`.
- Скрипты: `build` (tsc + `scripts/copy-client.mjs`), `typecheck`, `lint` (oxlint),
  `test` (vitest), `check:dsh`.
- Публикуемые файлы: `lib`, `rules`, `ui`, `cordis.patch.yml`, `LICENSE`, `README.md`,
  `README.ru.md`. Runtime-зависимостей в `package.json` нет.
- Код: `src/core` (17 модулей: engine, store, wiki, ranking, frontmatter, embeddings,
  embed-queue, embed-worker, chunks, vector-index, model-cache, projection, config, log,
  paths, types, index), `src/dsh` (context, engine, rules-export, settings, tools, web,
  workspaces), `index.ts`, `tool-restrict.ts`, `ui/web-ui.html`, `client/client.js`.
- Тесты: 29 файлов `tests/*.test.ts` + `tests/helpers.ts` + `tests/helpers/` (31 запись в
  каталоге), vitest.
- SQLite: `node:sqlite` `DatabaseSync`, WAL + busy_timeout (`src/core/store.ts:5–11`),
  схема `memories` (`src/core/store.ts:415`), FTS5 `memories_fts` (`:489`).
- UI: плагин отдаёт WebUI через `ctx.webServer.register` (`src/dsh/web.ts:697`), страница
  `ui/web-ui.html` (`src/dsh/web.ts:184`).
- Настройки: схема в `@deepseek-ai/dsh-settings` (`SettingsForms`, `src/dsh/settings.ts:16`),
  рендерит их DSH, плагин отдаёт только host-half.
- Память на машине: `~/.dsh/llm-memory` существует; содержимое не копировалось и не
  использовалось.

## kilocode (проверено 19.10.2026 через `/mnt/c` из WSL2)

- Корень: `C:\Users\Kvintilyanov\.config\kilo`; runtime `@kilocode/plugin` 7.4.22
  (`~/.config/kilo/package.json` → `"@kilocode/plugin": "7.4.22"`, установленная
  версия в `node_modules/@kilocode/plugin/package.json` совпадает).
- Плагин: `plugin/kilo-memory.ts` (4464 б) + `kilo-memory-lib/*.ts` (`memory-core.ts`
  63 КБ, `store.ts` 21 КБ, `wiki.ts`, `tools.ts`, `hooks.ts`, `web-server.ts`,
  `web-ui.html` 77 КБ, `types.ts`, `ranking.ts`, `frontmatter.ts`, `paths.ts`,
  `config.ts`, `log.ts`); конфиг `kilo-memory.json`, панель по умолчанию 8787
  (`kilo-memory-lib/config.ts:54`, `Bun.serve` в `web-server.ts:249`).
- Хранилище: единая центральная БД `memory/db/memory.db` (5 607 424 б);
  страницы `memory/pages` (404 КБ, 101 файл), `memory/raw` (1.7 МБ), проектные
  страницы — `<repo>/.kilo/memory` (`paths.ts:15–28`). Рядом лежит
  `memory.db.bak-1788738822857` (86 КБ, 7 сентября).
- БД: `integrity_check` → `ok`; таблицы `memories`, `memories_fts` (FTS5 по
  `id,title,content,keywords,tags`), `memory_entities`, `memory_edges`.
- Записи: **351** (не 336, как в плане), `active` — 301, `global` — 101, `project` — 250;
  по видам: facts 174, decisions 94, architecture 56, preferences 19, rules 8;
  FTS индексирует только активные (301); `files` — 351; `source` во всех записях `user`.
- Схема `memories`: `id, scope, kind, tier, status, title, content, tags, keywords,
  importance, source, supersedes, supersededBy, related, createdAt, updatedAt,
  lastAccess, accessCount, file, mtimeMs, project_root, confidence, consolidation`.
- Frontmatter страниц — snake_case (`created_at`, `updated_at`, `last_access`,
  `access_count`, `superseded_by`, `consolidation`, `confidence`).
- Хэши всех файлов, счётчики и схема зафиксированы машинно:
  `docs/adr/kilo-baseline.json`.
- Sanitized fixture собрана из этой схемы: `tests/fixtures/kilo/` (24 синтетические
  записи, `integrity_check` → `ok`).
- Windows-хост: `node.exe` 24.19.0 (`C:\Program Files\nodejs\node.exe`), **Bun не
  установлен**, Kilo запущен (один процесс) — запись в живую БД не выполнялась.

Внимание: цифра «336» из плана устарела. Инвариант миграции формулируется как «ни одна
запись не потеряна и все поля сохранены», а не «336 → 336».

## OpenCode (не проверено здесь)

- Из плана §2: `@opencode-ai/plugin` 1.18.21 в `~/.config/opencode/node_modules`;
  `Hooks`: `tool`, `chat.message`, `chat.params`,
  `experimental.chat.system.transform`, `experimental.session.compacting`,
  `experimental.text.complete`.

## Чего не хватает для закрытия этапа 0

Остались только спайки, требующие работающего Kilo/Electron/Bun на Windows и стенда
OpenCode: A1–A10, A13–A15. План и критерии — `spikes.md`; A11 закрыт частично, A12 закрыт
(см. там же). Снимок БД, хэши и fixture сняты, больше от Windows-хоста для этапа 0 ничего
не нужно.
