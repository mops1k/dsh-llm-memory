# Performance baseline

Замеры этапа 11 на реальном core (локальный диск, `embeddings.provider=off`, то есть
лексическая нога recall). Скрипт: [scripts/perf-baseline.mjs](../scripts/perf-baseline.mjs).

## Методика

- Хост: WSL2 (ядро 6.18.40.1-microsoft-standard), Node 24.20, локальный ext4-диск.
- 1200 записей (~200 символов каждая, 4 вида, project + user), затем 200 self-retrieval
  запросов `perf entry N` (без `touch`, чтобы не писать на каждый recall).
- Startup: новый `MemoryEngine` + первый `recall` (cold — после закрытия, warm — сразу
  после cold).
- Backup: `createBackup` → `verifyBackup` → `restoreBackup` (`confirm: RESTORE`) в пустой
  store, затем сравнение количества записей.

Воспроизвести:

```sh
npm run build
node scripts/perf-baseline.mjs --entries 1200 --queries 200
# машиночитаемо: --json
```

## Результаты (21.10.2026)

| Метрика | Значение |
|---|---|
| Записей в сторе | 1200 |
| save, всего | 617.9 мс (0.5 мс/запись) |
| recall p50 / p95 / max (200 запросов) | 20.5 / 30.1 / 56.3 мс |
| cold open + первый recall | 22.6 мс |
| warm open + первый recall | 21.9 мс |
| backup create / verify / restore | 105.9 / 13.2 / 40.3 мс |
| размер архива на 1200 записей | 2.2 МБ |
| записей после restore | 1200 |

## Как читать

- Лексический recall на 1200 записях укладывается в ~30 мс по p95; запас до интерактивного
  порога большой, а рост таблицы до 5–10k записей даёт логарифмический прирост FTS-запроса,
  не линейный.
- Startup ~22 мс: открытие SQLite + WAL + проверка схемы, без полной переиндексации
  (page-фингерпринты).
- Backup/restore — сотни миллисекунд на 2.2 МБ и 1200 записей; на 1k+ требование ТЗ
  выполнено с запасом.

## Ограничения

- Векторная нога здесь выключена; её стоимость и качество измеряются отдельно
  (`scripts/bench-vector.mjs`, `scripts/bench-recall.mjs`) и в отчёте
  [adr/p6-acceptance.md](adr/p6-acceptance.md) для Kilo.
- Числа зависят от диска: на Windows/сетевых монтированиях будет медленнее; store на
  UNC/9p запрещён (ADR-007).
- Повторный прогон на той же машине — способ поймать регрессию: ориентир p95 ≤ 60 мс,
  save ≤ 1 мс/запись, restore ≤ 1 с на 1k+ записей.
