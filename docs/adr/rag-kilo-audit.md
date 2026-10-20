# Аудит P1: RAG в Kilo и кроссплатформенность (Windows/Linux)

Дата: 20.10.2026. Хост: Windows 10.0.26200.9457 (win32) через WSL2 `archlinux`
(ядро 6.18.40.1-microsoft-standard-WSL2), чтение Windows-ФС через `/mnt/c` (9p).
План: `p_c7de70db394f`, фаза P1 «Аудит совместимости и сбор фактов».

Метод: только чтение. Живая Kilo-БД открывается `?immutable=1` (обычное открытие на
чтение через 9p падает — см. §3); файлы и настройки не менялись; код не правился.
Все команды воспроизведения — в §6.

## 1. Kilo-схема: векторы и sync-таблицы

Таблица `memory_vectors` в живой Kilo-БД **уже создана** миграцией v2 (этап 3) и её DDL
**посимвольно совпадает** с `VECTOR_TABLE_DDL` ядра (`src/core/infrastructure/vector-index.ts:56`).

- Колонки: `entry_id, chunk_ix, model, dim, hash, scope, project, kind, tier, status,
  vector BLOB, created_at`, PK `(entry_id, chunk_ix)` — сравнение нормализованного DDL
  дало `EQUAL: True`.
- Индексы: `idx_memory_vectors_model` (+ автоиндекс PK) — как в ядре.
- Строк в `memory_vectors`: **0**. Строк в `memory_revisions`: **0**.
- `memory_entities` 363, `memory_edges` 755 — persisted-граф Kilo на месте.
- `memories`: **323** записи (`active` 277, `global` 12, `project` 311);
  `integrity_check` — `ok`; `user_version` = 0 (версия схемы не ведётся — идемпотентность
  держится на `ensureColumns`/`table_info`, как и заложено в этапе 3).
- `memories_fts_content`: **298** строк против 277 `active` — **21 устаревшая строка FTS**
  (следствие D-21: FTS наполняется только по `active`). Разрыв нужно закрыть
  перестройкой FTS в P2, иначе лексическая нога ищет по удалённым записям.

Вывод: для включения семантики в Kilo **миграция схемы не нужна** — таблица, индексы и
синхронизационные таблицы уже есть. Пустая таблица — не дефект схемы: векторную ногу
гасит код адаптера (`src/adapters/kilo/service.ts:126`, `isEnabled: () => false`,
комментарий «no vector leg yet (stage 9)»).

Замечание к формулировке «content/createdAt/updatedAt» из исходного плана: в диалекте
Kilo таких колонок у таблицы векторов нет — канон ядра (`vector BLOB`, `model`, `dim`,
`hash`, `created_at`) уже действует в Kilo-сторе.

## 2. Рантайм Kilo на Windows

Данные из пробника Kilo (`~/.config/kilo/kilo-probe-report.json`, 19.10.2026) и снятые
сегодня файловые факты:

- Runtime: **Bun 1.4.2**, `process.versions.node` = `v26.3.0`, platform `win32`.
  `bun:sqlite`: WAL, FTS5, `loadExtension` — работают (журнал `wal` на локальном диске).
- `@huggingface/transformers`: **не резолвится** — пакета нет в `~/.config/kilo/node_modules`
  (там только `@kilocode/plugin` и транзитивные зависимости), ошибка
  `ResolveMessage: Cannot find package ... imported from C:\...\.config\kilo\plugin\llm-memory.js`.
  Бандл `plugin/llm-memory.js` (2.18 МБ) грузит библиотеку через `createRequire(import.meta.url)`
  лениво — значит, достаточно положить пакет в резолв-путь `~/.config/kilo`, код менять не нужно.
- `sqlite-vec`: **не резолвится** (модуля нет в `node_modules`); `getLoadablePath` вернёт `null`,
  ядро уходит на JS-backend (`backend: 'js'` — дефолт ядра).
- `node:sqlite`: не требуется — `resolveSqliteDriver()` выбирает `bun:sqlite` при наличии
  `globalThis.Bun` (`src/core/infrastructure/sqlite/index.ts:10`). Направленная проверка
  `node:sqlite` внутри Bun 1.4.2 не выполнена: бинарника Bun на хосте нет (см. §5), и
  архитектурно он не нужен.
- Кэш модели **уже скачан** в Kilo-стор: `<store>/_models/Xenova/multilingual-e5-small`
  (134 МБ; `onnx/model_quantized.onnx` 118 МБ, tokenizer/config) — путь совпадает с
  `ModelManager({ cacheDir: join(root, '_models') })` (`service.ts:120`). То есть
  «модели нет» — это про отсутствующий npm-пакет, а не про веса. Скачивание сработало,
  потребление — нет (нога выключена).
- Конфиг Kilo (`~/.config/kilo/llm-memory.json`): `embeddings.provider = local`,
  `model multilingual-e5-small`, `dim 384`, `topK 8`, `minScore 0.2`, `prewarm false`.
  Провайдер включён в конфиге, но не в рантайме — панель должна показывать это честно
  (сейчас `isConfigured` = true, `isEnabled` = false).
- Node на хосте: `C:\Program Files\nodejs\node.exe` = **v24.19.0** (совпадает с A1);
  Bun отдельно не установлен — он приходит с рантаймом Kilo.

## 3. Ограничения среды

- **Store только на локальном диске.** Повторно подтверждено 20.10: обычное открытие
  живой Kilo-БД из WSL (`/mnt/c`, 9p) даёт `Parse error ... disk I/O error (10)` —
  WAL-файл и `-shm` открыты работающим Kilo (PID 24628). `?immutable=1` читается
  корректно, но игнорирует WAL, поэтому годится для аудита, а не для записи.
  Это согласуется с A1/A10: UNC/9p для store запрещён, страницы-файлы на UNC — можно.
- **WAL и блокировки.** Живой Kilo держит БД (в каталоге `memory.db-wal` 4.2 МБ,
  `memory.db-shm`); заголовок БД — WAL (байты 18–19 = `0x02 0x02`). Один писатель,
  `busy_timeout`, повторные открытия — как в A1/A6; миграция на живой БД не проверялась
  (этап 3 гонял копию).
- **Длинные пути Windows.** `LongPathsEnabled = 0x0` (реестр,
  `HKLM\SYSTEM\CurrentControlSet\Control\FileSystem`) → действует лимит MAX_PATH 260.
  Замеры: корень Kilo-стора `C:\Users\Kvintilyanov\.config\kilo\memory` — 41 символ;
  самый длинный существующий файл стора — **182** символа (страница в
  `wsl.localhost-...-tools-client/architecture/...`). Запас есть, но проектный стор
  `<repo>\.kilo\memory` при глубоком `repo` + кириллические имена страниц могут
  приблизить к 260 — проверка в P5, не в P1.
- Чтение страниц и БД: 148 МБ стор, 6 проектных каталогов; БД 5.6 МБ.

## 4. Матрица «DSH vs Kilo × Linux vs Windows» (наблюдаемое сейчас)

| Свойство | DSH · Linux | DSH · Windows | Kilo · Linux | Kilo · Windows |
|---|---|---|---|---|
| Runtime | Node 24.20 (WSL2) | не установлен | Kilo не установлен (только пустой `~/.config/kilo/memory` от тестов 19.10) | Bun 1.4.2 / node-compat 26.3.0, win32 |
| Store | `~/.dsh/llm-memory` | — | — | `C:\Users\Kvintilyanov\.config\kilo\memory` (148 МБ) |
| БД / драйвер | `_db/memory.db`, `node:sqlite`, WAL | — | — | `db/memory.db`, `bun:sqlite`, WAL, `user_version 0` |
| `memory_vectors` | 3521 строка; `vec0` отсутствует → JS-backend | — | — | 0 строк, DDL = ядро; JS-backend, нога выключена кодом |
| `memory_revisions` | есть, sync выключен | — | — | есть, 0 строк |
| Записи | 1178 (`vectors` 3521) | — | — | 323 (active 277, FTS 298 → 21 stale) |
| Embeddings | `local`, `Xenova/multilingual-e5-small`, dim 384, backend `js`, topK 50, prewarm | — | — | конфиг `local`, dim 384, topK 8, minScore 0.2; нога `isEnabled=false` |
| Кэш модели | `<store>/_models` 130 МБ | — | — | `<store>/_models` 134 МБ (onnx 118 МБ) |
| Пакеты модели | `@huggingface/transformers ^4.3.1`, `sqlite-vec ^0.1.9` в зависимостях плагина | — | — | пакетов нет в `~/.config/kilo/node_modules` |
| UI | WebUI через `ctx.webServer` + нативные формы | — | — | `Bun.serve` 8787 |
| Пути/лимиты | локальный диск; UNC/9p запрещён (A1/A10) | — | — | локальный диск; MAX_PATH 260 (`LongPathsEnabled=0`), самый длинный путь стора 182 |

Пустые клетки — не «работает», а «не наблюдалось»: стендов DSH-Windows и Kilo-Linux нет.

## 5. Что не проверено (вне P1 или без стенда)

- `node:sqlite` внутри Bun 1.4.2 — бинарника Bun на хосте нет; архитектурно не нужен
  (выбирается `bun:sqlite`), но при желании закрывается пробником в Kilo.
- Загрузка ONNX/embedding в рантайме Kilo — блокирована отсутствием пакета (A3);
  решается вариантом доставки A/B/C в P4.
- DSH на Windows — не установлен; Kilo на Linux — не установлен.
- Миграция на живой Kilo-БД при запущенном Kilo — по-прежнему только копия (A6).

## 6. Команды воспроизведения

```bash
DB="file:///mnt/c/Users/Kvintilyanov/.config/kilo/memory/db/memory.db?immutable=1"
sqlite3 "$DB" "select sql from sqlite_master where name in ('memory_vectors','memory_revisions');"
sqlite3 "$DB" "select 'vectors',count(*) from memory_vectors union all select 'revisions',count(*) from memory_revisions
  union all select 'memories',count(*) from memories union all select 'fts',count(*) from memories_fts_content;"
sqlite3 "$DB" "pragma integrity_check; pragma index_list(memory_vectors);"
xxd -s 16 -l 8 /mnt/c/Users/Kvintilyanov/.config/kilo/memory/db/memory.db     # байты 18–19 = 02 02 → WAL
sqlite3 "file:///mnt/c/Users/Kvintilyanov/.config/kilo/memory/db/memory.db?mode=ro" ".tables"  # disk I/O error (9p + live WAL)
ls /mnt/c/Users/Kvintilyanov/.config/kilo/node_modules | grep -E "huggingface|sqlite-vec"  # пусто
du -sh /mnt/c/Users/Kvintilyanov/.config/kilo/memory/_models                          # 134M
ls -la /mnt/c/Users/Kvintilyanov/.config/kilo/memory/_models/Xenova/multilingual-e5-small/onnx
/mnt/c/Windows/System32/reg.exe query "HKLM\SYSTEM\CurrentControlSet\Control\FileSystem" /v LongPathsEnabled
find /mnt/c/Users/Kvintilyanov/.config/kilo/memory -type f | sed 's|^/mnt/c|C:|' | awk '{print length($0)}' | sort -rn | head -1
PS=/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe
$PS -NoProfile -Command "Get-Process | Where-Object { \$_.ProcessName -match 'kilo' } | Select ProcessName,Id"
DB2="file:///home/mops1k/.dsh/llm-memory/_db/memory.db?mode=ro"
sqlite3 "$DB2" "select 'memories',count(*) from memories union all select 'vectors',count(*) from memory_vectors;"
```

## 7. Следствия для P2 (не выполнялись)

1. Векторная нога в Kilo упирается не в схему, а в две вещи: общий `VectorLeg` в ядре
   и снятие `isEnabled: false` в `KiloService` (P2).
2. Доставка библиотеки эмбеддингов в Kilo — решение P4 (A/B/C); веса модели уже лежат
   в сторе, так что вариант A упирается только в npm-пакет.
3. Перед включением семантики перестроить FTS Kilo (298 против 277 `active`) — иначе
   лексическая нога опирается на устаревшие строки (D-21).
4. Панель должна различать «провайдер настроен» и «нога включена» — сейчас
   `isConfigured=true`, `isEnabled=false` (P2, `vectors.health`).
