# ADR и артефакты этапа 0

Канон задачи: `.dsh/plans/llm-memory-unified-core-tz.md` (§8 — этапы, §5 — требования).
Анализ и риски: `.dsh/plans/llm-memory-unified-core.md`. План в plan-store:
`p_92bb5e9077d1`.

| Файл | Содержание | Статус |
|---|---|---|
| [baseline.md](baseline.md) | Исходное состояние DSH (проверено), Kilo/OpenCode (из плана), чего не хватает | готов, Kilo-часть отсутствует |
| [differences.md](differences.md) | Реестр различий DSH/Kilo (D-01…D-20) с решением и степенью проверки | готов (Kilo-факты помечены «план») |
| [spikes.md](spikes.md) | План проверок A1–A15 с критериями приёмки | план готов, выполнение не начато |
| [ADR-001](ADR-001-monorepo-in-place.md) | Монорепо in-place в текущем репозитории | принято |
| [ADR-002](ADR-002-separate-stores.md) | Код общий, память раздельная | принято |
| [ADR-003](ADR-003-tool-names.md) | Единые `llm_memory_*` без aliases | принято |
| [ADR-004](ADR-004-ui-hosts.md) | UI-хосты: DSH гибрид, остальные общий web | принято |
| [ADR-005](ADR-005-backup-format.md) | Backup `.llmmem`, ручной режим, pre-restore | принято |
| [ADR-006](ADR-006-sync-groundwork.md) | Sync только groundwork (git, write + review) | принято |
| [ADR-007](ADR-007-coexistence-isolation.md) | Coexistence isolation | принято |
| [ADR-008](ADR-008-decisions-2026-10-19.md) | Канон ТЗ §8, правило импортов по слоям, поправки | принято |
| [ADR-009](ADR-009-flat-src-tree.md) | Плоское дерево `src/`, один пакет и слои | принято |
| [ADR-010](ADR-010-embedding-runtime-delivery.md) | Доставка рантайма эмбеддингов в Kilo (вариант A) | принято |

Не создано на этом шаге: sanitized fixtures. Копия Kilo-БД требует Windows-хоста, а
DSH-layout fixture собирается на этапе 1 вместе с `packages/testkit`, чтобы фикстура
сразу имела потребителя (contract-тесты), а не лежала мёртвым файлом.
