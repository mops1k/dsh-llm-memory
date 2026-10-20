# Release notes

## 2.0.0 — 21.10.2026

Первый релиз единой кодовой базы: одна память-платформа для **DSH**, **Kilo**,
**OpenCode** и любого **MCP-клиента**. Код общий, память раздельная — каждый хост держит
собственный store и не видит чужой (ADR-002/007).

### Артефакты

| Артефакт | Для чего | Что внутри |
| --- | --- | --- |
| `dsh-llm-memory-2.0.0.tgz` | DSH | npm-пакет: плагин, bundle-patch `cordis.patch.yml`, браузерный клиент, встроенные правила |
| `llm-memory-kilo-2.0.0.js` | Kilo | один самодостаточный файл плагина: инструменты, хуки, панель 8787 |
| `llm-memory-opencode-2.0.0.js` | OpenCode 1.x и 2.x | один файл: инструменты, хуки, панель 8788 (раскладывается в `plugin/` или `plugins/`) |
| `llm-memory-mcp-2.0.0.js` | любой MCP-клиент | исполняемый сервер: stdio и Streamable HTTP, панель 8789 |
| `checksums.txt` | проверка загрузки | SHA-256 каждого артефакта |

Установка — в [README](../README.ru.md), по каждому хосту отдельно.

### Breaking changes

- **Инструменты переименованы: `memory_*` → `llm_memory_*`, алиасов нет** (ADR-003).
  Обновите промпты, правила, `AGENTS.md` и скрипты, которые вызывали старые имена.
- **Один пакет вместо `packages/*`** (ADR-009): внутренние импорты `@llm-memory/*` больше
  не существуют. Внешним потребителям доступны только публичные entrypoints пакета:
  `.`, `./client`, `./tool-restrict`, `./opencode`, `./mcp`.
- **Kilo перешёл на общее ядро.** Записи не переносятся автоматически: для живого стора
  нужен cutover (`scripts/kilo-cutover.mjs`) с бэкапом и проверенным rollback
  ([kilo-cutover.md](kilo-cutover.md)).
- **Схема БД получает аддитивную миграцию v2**: поля `project`, `path`, `ext_key`,
  `file_size`, `file_mtime_ms` и резерв sync (`namespace`, `revision`, `device_id`,
  `updated_by`, `deleted_at`, `sync_state`), таблица `memory_revisions`. Существующие
  строки не перезаписываются, но **перед обновлением сделайте бэкап**.
- **Настройки DSH**: `sessionStartGuide` остаётся только через патч профиля; карточка
  настроек показывает остальные ключи (плоские `embeddings*`), значения применяются после
  перезапуска.

### Новое в 2.0.0

- **MCP-сервер**: `llm_memory_*` + `llm_memory_backup`, prompt `memory-guide`, resource
  `memory://guide`, панель 8789, stdio и Streamable HTTP с токеном, лимиты, delete только
  в stdio или с `--allow-delete` ([mcp.md](mcp.md)).
- **OpenCode 1.x/2.x**: одна сборка, инструменты, хуки контекста и компакции, панель 8788
  ([opencode.md](opencode.md)).
- **Общая панель и UI-схема** для Kilo/OpenCode/MCP: обзор, записи, граф, карта RAG,
  настройки, бэкапы; паритет полей проверяется тестами ([ui-sdk.md](ui-sdk.md)).
- **RAG в ядре**: гибридный recall (BM25 + векторы + метаданные), локальная модель
  `Xenova/multilingual-e5-small`, кэш и установка рантайма, backfill, lexical fallback
  ([configuration.md](configuration.md)).
- **Sync-groundwork**: зарезервированные поля, `memory_revisions`, `SyncTransport`/`NullSync`;
  сеть, auth и UI отсутствуют ([sync.md](sync.md)).
- **Наблюдаемость и защита**: coexistence четырёх хостов, security-тесты (токен не уходит в
  панель/логи, owner-only конфиг), performance baseline ([perf.md](perf.md)).

### Порядок обновления

1. Сделайте бэкап: `.llmmem` из панели/CLI; для Kilo дополнительно снимок `memory.db`.
2. Замените артефакт своего хоста (см. установку в README).
3. Перезапустите хост.
4. Миграция схемы выполняется при первом открытии стора; для Kilo при необходимости
   прогоните cutover-скрипт и проверьте отчёт.
5. Проверьте `llm_memory_status` и `llm_memory_lint`; убедитесь, что recall возвращает
   записи.

### Проверено

- Полный тестовый набор (unit/integration/contract/E2E), CI-матрица Ubuntu и Windows,
  Windows-смоук собранных бандлов.
- Coexistence Kilo+DSH+OpenCode+MCP, изоляция store/портов/локов, 100 параллельных
  операций и kill процесса.
- MCP Inspector по stdio и HTTP (tools, prompts, resources, save/recall/status).
- Performance baseline: 1200 записей, recall p95 ~30 мс, backup/restore 2.2 МБ.
