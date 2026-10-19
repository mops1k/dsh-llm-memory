# DSH: миграция схемы v2

Живая БД DSH (`~/.dsh/llm-memory/_db/memory.db`, 19.10.2026: 1140 записей / 949
активных) отстаёт от core-схемы на 10 аддитивных колонок (`access_count`,
`last_access`, `consolidation`, `origin`, `namespace`, `revision`, `device_id`,
`updated_by`, `deleted_at`, `sync_state`) и таблицу `memory_revisions`.

```bash
# сухой прогон
node scripts/migrate-dsh.mjs --db ~/.dsh/llm-memory/_db/memory.db

# применение с обязательной копией рядом (backups/memory-<ts>.db + wal/shm)
node scripts/migrate-dsh.mjs --db ~/.dsh/llm-memory/_db/memory.db --apply
```

Миграция только `ALTER TABLE ADD COLUMN`, создаёт индекс и `memory_revisions`,
строки не переписывает; повторный `--apply` идемпотентен (added 0). На копии
проверено: 1140/949 до = после, `integrity_check: ok`.
Выполнять при остановленном DSH, чтобы не конкурировать за WAL.
