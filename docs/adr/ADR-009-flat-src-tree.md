# ADR-009: одно дерево `src/` вместо `packages/*`

Статус: принято (20.10.2026). Ссылки: ADR-001 (монорепо), ADR-008 (слои и правило импортов), план `p_acafffcfd814`.

## Контекст

Код был размазан между корнем (`src/` — DSH-адаптер) и `packages/{core,ui,adapter,testkit}`. Это давало три проблемы:

- собранный `lib/index.js` импортировал `@llm-memory/core` и `@llm-memory/ui`; эти пакеты не публиковались (npm 404), поэтому пакет как самостоятельный не работал, а установка зависела от workspace-симлинков;
- одно и то же дерево собиралось двумя разными конфигурациями (root `tsc` + references), новые файлы приходилось кладать «то туда, то сюда»;
- границы слоёв читались только по `packages/core/src`, а адаптеры DSH жили отдельно от остальных адаптеров.

## Решение

Один пакет, одно дерево `src/`, один `tsconfig` (`rootDir: src`, `outDir: lib`, без references):

```
src/index.ts, tool-restrict.ts   DSH entrypoint
src/core/{domain,application,infrastructure,port,layout,isolation,sync}
src/ui/{headless,theme,web}
src/adapters/{dsh,kilo,mcp,opencode}
src/testkit
```

- Внутри `src` импорты только относительные (NodeNext с явным `.js`) — сборка самодостаточна, без workspace-пакетов.
- `@llm-memory/*` остаются только в тестах; `vitest.config.ts` мапит их в `src/*`.
- `packages/*`, `package.json`/`tsconfig` пакетов и references удалены; `pnpm-workspace.yaml` остаётся как единственный пакет-воркспейс ради `allowBuilds` (esbuild разрешён, `onnxruntime-node`/`protobufjs` — нет).
- Сборка: `tsc -p . → lib/**`, `build-ui → lib/web-ui.js`, `build-kilo → lib/kilo.js`, `copy-client → lib/client.js`; миграционные скрипты читают `lib/core|lib/adapters`.

## Следствия

- Пакет можно публиковать и ставить без workspace-симлинков.
- Слои ядра проверяются `tests/architecture.test.ts` по `src/core`.
- `git mv` сохраняет историю файлов; ADR-001 в части «монорепо in-place» считается заменённым этим решением, остальные его пункты (имя пакета, публикация) в силе.
