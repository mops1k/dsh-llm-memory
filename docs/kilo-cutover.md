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
сохранность ok, smoke ok, rollback ok, `productionReady: true`.

Метрика recall: один и тот же детерминированный лексический скорер применяется
к исходной БД (Kilo-колонки `content`) и к мигрированной (core-колонка `text`);
пересечение top-10 на 100 запросах = 1.0. Это проверяет эквивалентность данных и
их извлечения после миграции, но не совпадение ранжирования со старым плагином:
старая `memories_fts` Kilo оказалась непригодной как baseline (возвращала один и
тот же топ на разные запросы), поэтому алгоритмический паритет с ней не измерен —
при production cutover сравнить выдачу старых и новых инструментов вручную на
10–20 реальных запросах.
