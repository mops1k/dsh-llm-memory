# Kilo cutover (этап 5)

Репетиция — всегда на копиях:

```bash
node scripts/kilo-cutover.mjs \
  --source ~/.config/kilo/memory \
  --db ~/.config/kilo/memory/db/memory.db \
  --work /tmp/kilo-rehearsal --queries 100
```

Проверки отчёта `migration-report.json`: backup+verify, миграция копии (трансляция
колонок Kilo → core: content→text, updatedAt→updated_at, supersededBy→superseded_by,
project_root→project), сохранность counts/relations/страниц, recall-пересечение
top-10 на 100 запросах (порог 0.9), smoke (7 tools, hooks, панель, backup/restore,
settings), rollback с логическим хэшем.

Production cutover выполняется только после `productionReady: true`: остановить
Kilo, `--apply` migration на живом store (с `--backup`), положить
`packages/adapter/lib/kilo.js` в `~/.config/kilo/plugin/`, запустить Kilo,
проверить инструменты `llm_memory_*`, панель 8787 и recall. Откат — restore
pre-cutover архива с `--confirm RESTORE`.

**Статус репетиции 19.10.2026 (копия живого store: 358/307):** миграция ok,
сохранность ok, smoke ok, rollback ok, recall top-10 = 0.69 при пороге 0.9 —
cutover заблокирован до выравнивания лексического ранжирования (core FTS/BM25
против старой memories_fts Kilo).
