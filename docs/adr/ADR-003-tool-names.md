# ADR-003: единые имена инструментов llm_memory_*

Статус: принято (19.10.2026). Ссылки: ТЗ §5.3, §16.3, план §6.1 п.11, §17 п.8.

## Контекст

Имена расходятся: DSH — `llm_memory_recall/save/forget/status`, kilocode —
`memory_recall/save/forget/delete/status/lint/graph`. Модель видит то одни, то другие
имена, guide и AGENTS.md написаны под разные наборы. MCP-адаптеру нужен третий набор,
если канона нет. Переходные aliases навсегда закрепят разнобой и удвоят `tools/list`.

## Решение

Канон — `llm_memory_*` во всех харнесах, включая MCP:

`llm_memory_recall`, `llm_memory_save`, `llm_memory_forget`, `llm_memory_delete`,
`llm_memory_status`, `llm_memory_lint`, `llm_memory_graph`, `llm_memory_backup`.

- `memory_*` не регистрируются, aliases не вводятся.
- Переход — breaking change: major-релиз, обновлённые guide/AGENTS/подсказки, release
  notes с явным списком переименований.
- MCP: `llm_memory_backup` — create/list/verify; restore доступен только через CLI/UI,
  модель restore не вызывает.
- `llm_memory_delete` в MCP разрешён в stdio, в HTTP — только с `--allow-delete`.
- Проверка — `tools/list` в каждом адаптере: чужих имён нет.

## Последствия

- Плюс: один guide и одни промпты для всех харнесов; модель не путается.
- Минус: старые промпты/автоматизации пользователей Kilo с `memory_*` сломаются; это
  осознанно принимается и закрывается release notes, а не скрытыми aliases.
