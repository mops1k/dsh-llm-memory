# ADR-001: один монорепо в текущем репозитории dsh-llm-memory

Статус: принято (19.10.2026). Ссылки: ТЗ §4, план §5, ADR-008.

## Контекст

Память живёт в четырёх местах: DSH-плагин (этот репозиторий, `dsh-llm-memory@1.4.0`),
kilocode-плагин (raw TS в `~/.config/kilo`, вне git на этой машине), OpenCode и MCP.
Логика памяти (store, ranking, wiki, векторы, frontmatter) в них общая по происхождению,
но разошлась. Каждый багfix правится дважды, поведение инструментов и UI расходится.

Рассматривались варианты: (a) новый репозиторий `llm-memory/` с переносом истории через
`filter-repo`; (b) превратить текущий репозиторий в монорепо; (c) оставить DSH отдельным
репозиторием и публиковать core как npm-пакет.

## Решение

Монорепо создаётся **в текущем репозитории** `/home/mops1k/Development/dsh-llm-memory`:

```
package.json            # workspaces, lockstep-версии
packages/core/          # domain, application, infrastructure, port, layout, sync
packages/adapter/       # один пакет: entrypoints ./kilo, ./dsh, ./opencode, ./mcp
packages/ui/            # headless, web, theme
packages/testkit/
migrations/
docs/adr/
```

- `src/core` → `packages/core`, `src/dsh` → `packages/adapter/dsh` переносятся `git mv`
  на этапе 1: история файлов сохраняется, переписывания имён коммитов не нужно.
- Имя пакета `dsh-llm-memory`, npm-публикация, CI и `cordis.patch.yml` остаются; DSH
  становится одним из entrypoints, а не единственным содержимым репозитория.
- Версии core и адаптеров выпускаются lockstep.

## Последствия

- Плюс: история и публикация не переезжают, `git log -L` продолжает работать, риск
  сломать установку у существующих пользователей DSH минимален.
- Публикуются два пакета lockstep: `dsh-llm-memory` (DSH) и `@llm-memory/core`
  (зависимость корня); бандл в один файл для DSH не нужен, Kilo и MCP получат свои
  артефакты на этапах 3 и 8.
- Минус: в одном репозитории живут четыре рантайма (Node, Bun, Electron, MCP-бинарник);
  CI обязан собирать и проверять все, иначе адаптер «тихо» отстаёт.
- Отклонённые варианты: (a) теряет историю и требует новых CI/registry; (c) ломает
  lockstep-версии из ТЗ и оставляет расхождение DSH с остальными.
