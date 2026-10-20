# Разработка, совместимость и структура репозитория

Технические детали, вынесенные из README: сборка, проверки, совместимость с обновлениями
DSH, раскладка исходников, ограничения и бенчмарки.

## Команды

```sh
pnpm install
pnpm run typecheck
pnpm run lint
pnpm test
pnpm run build      # tsc + клиент + панели + бандлы kilo/opencode/mcp
pnpm run check:dsh  # совместимость с текущим рантаймом DSH
```

## Совместимость с обновлениями DSH

С DSH 0.2.0-rc.2 загрузчик профиля пропускает весь bundle, у которого
`@deepseek-ai/dsh*` peerDependencies не удовлетворяют запущенному рантайму
(`evaluatePluginCompatibility` в `@deepseek-ai/dsh-app-boot`), поэтому плагин молча
исчезает из сессии. Все DSH-peer'ы объявлены как `workspace:^` — загрузчик всегда читает
это как текущий рантайм, — а `scripts/check-dsh-compat.mjs` проверяет и диапазоны, и
runtime-символы, которых плагин касается.

После каждого обновления DSH:

```sh
pnpm check:dsh
pnpm run typecheck
pnpm test
```

Затем перезапустите DSH.

## Структура репозитория

```
src/index.ts, tool-restrict.ts   entrypoint DSH-плагина и scoped-пресет
src/core/                       хранилище, движок, ранжирование, wiki, frontmatter
                                (domain/application/infrastructure/port/layout/isolation/sync)
src/ui/                         headless-контракты, дизайн панели (design/panel/),
                                сгенерированная страница (design/panel.html), темы
src/adapters/dsh/               DSH: tools, context, settings, web, workspaces
src/adapters/kilo/              Kilo: service, совместимый API, панель, миграция/cutover
src/adapters/opencode/          OpenCode 1.x/2.x: один bundle, tools, хуки, панель 8788
src/adapters/mcp/               MCP-сервер: protocol, stdio, HTTP, tools, панель 8789, cli
src/testkit/                    контрактные проверки адаптеров
lib/                            сборка: DSH entry, client, web-ui.js, kilo.js, opencode.js, mcp.js
client/client.js                браузерный клиент DSH (React на токенах --dsw-*, настройки)
rules/en/                       встроенные английские правила для экспорта
cordis.patch.yml                патч bundle для DSH
scripts/                        сборка, миграции, бенчмарки, CLI
tests/                          vitest-наборы
```

## Ограничения

- Память живёт в домашнем каталоге DSH и внутри каждого проекта
  (`<project>/.dsh/llm-memory/`), отдельно от Kilo и от плагина `dsh-memory`
  (`~/.dsh/memory`), поэтому они сосуществуют.
- Конфиг Kilo не изменяется; sqlite-источники открываются read-only (при наличии WAL
  используется снимок `immutable=1`).
- `node:sqlite` синхронный: у стора один владелец на процесс.
- Изменения `storageRoot` и `webPath` применяются после перезапуска плагина.
- `llm_memory_recall` по умолчанию ищет в текущем проекте плюс кросс-проектный слой
  `user`; `scope: all` ищет по всем проектам.
- Несколько запущенных dsh одновременно могут переписывать одно состояние — держите один
  процесс. После жёсткой остановки при проблемах со стартом удалите устаревший
  `~/.dsh/.credentials.yaml.lock`.

## Бенчмарки

- [perf.md](perf.md) — `scripts/perf-baseline.mjs`: save/recall/startup/backup на 1200
  записях (этап 11).
- `scripts/bench-recall.mjs`, `scripts/bench-index.mjs`, `scripts/bench-vector.mjs`,
  `scripts/bench-tokens.mjs` — качество и скорость отдельных ног, стоимость переиндексации
  и цена токенов.
- `scripts/e2e-kilo-rag.ts` — приёмка RAG на копии живого Kilo-стора.
