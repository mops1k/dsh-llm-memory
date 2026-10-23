# Документация LLM Memory

Единый код и UI-SDK для DSH, Kilo, OpenCode и MCP. Инвариант: код общий, память раздельная
(у каждого харнесса свой store), cross-harness доступ запрещён.

## Установка, настройки и эксплуатация

- [configuration.md](configuration.md) — все ключи настроек DSH и устройство гибридного
  поиска (FTS5 + векторы, модель, кэш, бенчмарки ног).
- [development.md](development.md) — сборка, проверки, совместимость с обновлениями DSH,
  структура репозитория, ограничения и бенчмарки.
- [perf.md](perf.md) — performance baseline этапа 11: save/recall/startup/backup.
- [cross-platform.md](cross-platform.md) — пути и IO на Windows/Linux, нормализация
  storageRoot, UNC/9p, MAX_PATH, SQLite/WAL, установка и обновление плагина, CI-матрица.
- [release-notes.md](release-notes.md) — версия 2.0.1: изменения, состав артефактов,
  breaking changes по версиям, порядок обновления.

## Концепция и архитектура

- [ui-sdk.md](ui-sdk.md) — универсальная UI-схема: настройки, действия, экраны, виджеты,
  снимки и правила паритета; что принимают поля, как получать снимок, как добавить
  настройку/экран.
- [panel-api.md](panel-api.md) — HTTP-справочник панелей: эндпоинты, параметры, формы
  ответов, бэкапы `.llmmem`, модель, импорт, именование и журнал исправлений.

## Адаптеры

- [opencode.md](opencode.md) — адаптер OpenCode: одна сборка для 1.x и 2.x, стор, панель
  8788, живые проверки.
- [mcp.md](mcp.md) — MCP-сервер `llm-memory-mcp`: stdio и Streamable HTTP, store на
  client-id, инструменты, prompt/resource, панель 8789, лимиты и изоляция.

## Данные и миграции

- [dsh-migration.md](dsh-migration.md) — перенос DSH-памяти на единое ядро.
- [kilo-migration.md](kilo-migration.md) — миграция Kilo-хранилища (снимки, проверки,
  fixtures).
- [kilo-cutover.md](kilo-cutover.md) — production cutover Kilo.
- [backup.md](backup.md) — формат `.llmmem`, создание/проверка/восстановление, CLI.
- [sync.md](sync.md) — sync-groundwork: зарезервированные поля и `memory_revisions`,
  tombstones, модель конфликтов, git как первый транспорт, write + review, non-goals.

## RAG и кроссплатформенность (детали)

- [adr/rag-kilo-audit.md](adr/rag-kilo-audit.md) — аудит P1: схема векторов и рантайм Kilo
  на Windows.
- [adr/ADR-010-embedding-runtime-delivery.md](adr/ADR-010-embedding-runtime-delivery.md) —
  доставка рантайма эмбеддингов в Kilo (npm в `~/.config/kilo`, офлайн-модель из стора).

## Решения

- [adr/](adr/) — ADR-001…ADR-011 (раздельные store, имена инструментов, UI-хосты, бэкапы,
  sync-заготовка, изоляция, решения 19.10.2026, плоское дерево src/, доставка рантайма
  эмбеддингов, MCP-адаптер).
