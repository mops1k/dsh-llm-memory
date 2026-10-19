# Kilo: переход на общий core (этап 3)

Что меняется для пользователя:

- инструменты называются `llm_memory_recall`, `llm_memory_save`, `llm_memory_forget`,
  `llm_memory_delete`, `llm_memory_status`, `llm_memory_lint`, `llm_memory_graph`;
  прежние `memory_*` не регистрируются — алиасов нет (ADR-003);
- схема `memories` расширяется аддитивно: `project`, `ext_key`, `origin`, `path`,
  `content_hash`, `file_size`, `file_mtime_ms` и зарезервированные sync-поля
  (`namespace`, `revision`, `device_id`, `updated_by`, `deleted_at`, `sync_state`),
  плюс таблица `memory_revisions` и три индекса;
- существующие строки не переписываются: `id`, `createdAt`, `updatedAt`,
  `consolidation`, `accessCount`, `lastAccess`, `supersededBy`, `related`,
  `project_root` остаются как были;
- страницы проекта пишутся в `<repo>/.kilo/memory` (раньше путь зависел от DSH-раскладки).

## Миграция

```bash
# 1. Сухой прогон: что изменится, сколько записей до/после
node scripts/migrate-kilo.mjs --db ~/.config/kilo/memory/db/memory.db

# 2. Применение с обязательной копией БД
node scripts/migrate-kilo.mjs \
  --db ~/.config/kilo/memory/db/memory.db \
  --apply --backup ~/.config/kilo/memory/backups
```

Отчёт содержит `addedColumns`, `createdIndexes`, `before`/`after` счётчики,
`integrityCheck` и `backupPath`. Повторный `--apply` возвращает пустые списки
изменений (идемпотентно).

## Проверки после миграции

- `before` и `after` совпадают по `entries`/`active`;
- `integrityCheck: ok`;
- `sqlite3 <db> "SELECT COUNT(*) FROM memory_revisions;"` = 0 (таблица создана,
  заполняется только будущим sync-слоем);
- панель на `127.0.0.1:8787` открывается и показывает статус.

## Откат

При `--apply --backup` копия БД лежит рядом (`memory-<timestamp>.db` вместе с
`-wal`/`-shm`, если были). Откат — остановить Kilo, вернуть копию на место
`memory.db`, удалить `memory.db-wal`/`-shm`, запустить Kilo.
