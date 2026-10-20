# Spike-проверки A1–A15

Проверки, без результатов которых нельзя фиксировать контракты core. Каждый спайк
получает статус `открыт` / `закрыт (результат)` / `отложен (причина)`. Выполнение требует
Windows-хоста (Kilo, Bun, Electron) и отдельного стенда OpenCode; на Linux-машине
закрыты A1, A6, A7, A9, A10, A12; частично A2, A4, A11, A15. Блокированы A3 (нет пакета `@huggingface/transformers`) и A5 (нет стенда OpenCode); A8/A14 проверяются на своих этапах; A13 — после реализации backup на этапе 4.

| ID | Вопрос | Как проверяем | Критерий приёмки | Статус |
|---|---|---|---|---|
| A1 | Работает ли `node:sqlite` (`DatabaseSync`, `loadExtension`, WAL) на Windows и UNC-пути | Node 24 на Windows: создать БД, `PRAGMA journal_mode=WAL`, extension load, kill процесса, повторное открытие | 3 прогона без `database is locked` и без потери WAL | **закрыт (19.10, win32, node 24.19.0)**: `DatabaseSync` + WAL + FTS5 + `loadExtension` есть, кириллица переживает reopen (journal остаётся `wal`). **UNC `\\wsl.localhost\...` с WAL падает `database is locked`** — UNC-путь для store не поддерживается, store только на локальном диске |
| A2 | Работает ли `bun:sqlite` + `sqlite-vec` в Kilo на Windows | плагин-пробник в Kilo, `loadExtension('vec0')`, insert/query | index создан, query возвращает заданную запись | **закрыт без sqlite-vec (20.10)**: Kilo на Bun 1.4.2, `bun:sqlite` + WAL работают; `sqlite-vec` не нужен — JS-backend ядра даёт поиск по `memory_vectors` (3521 вектор в DSH, 0 в Kilo до включения ноги) |
| A3 | Работает ли `@huggingface/transformers` + ONNX + worker в Kilo/Electron | пробник: загрузка `Xenova/multilingual-e5-small`, embedding 3 фраз в worker | вектор получен, main-thread не блокируется > 200 мс | **закрыт (20.10, win32, офлайн)** после установки пакета: под Node 24.19 — 969 мс, под Bun 1.4.3 — 931 мс, dims 384, косинус 0.8567; модель читается из `<store>/_models` без сети (ADR-010) |
| A4 | Загружает ли загрузчик Kilo собранный workspace-пакет с entrypoints | собрать `adapter/kilo` bundle, положить в `~/.config/kilo/plugin`, запустить | плагин стартует, tools зарегистрированы, ошибок загрузчика нет | **частично (19.10)**: отдельный файл `kilo-probe.ts` загружен (`pluginLoaded: true`), инструмент зарегистрирован; сборка workspace-бандла с entrypoints не проверена |
| A5 | Совместим ли `Hooks` OpenCode 1.18.x с Kilo 7.4.x | один адаптер, два хоста: `tool`, `chat.params`, `system.transform`, `compacting`, `text.complete` | все хуки вызываются, различий в контракте нет | открыт (стенд OpenCode) |
| A6 | Выполняется ли schema migration Kilo без блокировки БД | `BEGIN IMMEDIATE`, `busy_timeout`, WAL checkpoint, `VACUUM INTO` на копии живой БД | миграция проходит, приложение не падает, повторный запуск — 0 изменений | **закрыт (19.10, копия live-БД)**: 5 колонок + 2 индекса за 18 мс, `integrity_check` ok, 351/301 сохранены, повторный прогон — 0 изменений. На живой БД не проверялось (Kilo запущен) |
| A7 | Эмулируется ли frozen prompt в Kilo через кэш по sessionID | пробник: кэш системного текста по sessionID на `system.transform` | текст стабилен в рамках сессии, меняется в новой | **закрыт (19.10)**: 2 вызова в одной сессии дали одинаковую длину базового system (37162 и 37162) — база стабильна; вставка маркера в `output.system` не переживает вызов (Kilo собирает массив заново), значит кэш нужно держать своему слою и добавлять блок при каждом transform |
| A8 | Монтируется ли DSH API в `Bun.serve` для общего UI | поднять `HttpUiHost` поверх `MemoryService` в Bun на 8787 | status/items/graph отвечают, CORS/порт не мешают | открыт |
| A9 | Расширяется ли `source` до строки без поломки Kilo UI | `ALTER TABLE memories` с текстовым `source`, прогнать UI | UI не падает, старые значения отображаются | **закрыт (19.10)**: `source` уже `TEXT NOT NULL` без CHECK, значения `user`; миграция схемы не нужна — расширение типа только в коде |
| A10 | Ведёт ли себя `bun:sqlite` корректно с `loadExtension` и WAL на UNC/Windows | пробник на UNC-пути: WAL, extension, concurrent read/write | без ошибок `disk I/O`, данные консистентны | **закрыт (19.10)**: БД на `\\wsl.localhost\...` не открывается ни `bun:sqlite` (WAL), ни `node:sqlite` (любой journal) — `database is locked`; 9p не даёт нужных блокировок. Store только на локальном диске, страницы-файлы на UNC — можно |
| A11 | Достаточен ли `node:sqlite` в Node 22 для MCP или нужен Node ≥24 | Node 22.19 и Node 24: `DatabaseSync`, WAL, FTS5 | решение: floor для MCP-бинарника | частично (19.10): на Node 24.20 `DatabaseSync` + WAL + FTS5 работают без флагов; Node 22 на машине нет — сверить на Windows в A1 |
| A12 | Работает ли `VACUUM INTO` как backup-снимок при открытом store | на копии Kilo-БД: `VACUUM INTO`, затем проверка целостности снимка | снимок открывается, counts совпадают, WAL не мешает | **закрыт (19.10)**: 7 мс на 5.6 МБ, `integrity_check` ok, 351 запись и 301 строка FTS совпали |
| A13 | Укладывается ли backup 1k+ записей в бюджет | synthetic 1000 записей: zip + SHA-256, замер времени и памяти | < 30 с и < 512 МБ на 1000 записей | отложен до этапа 4 (нужна реализация backup; мерить нечего) |
| A14 | Достаточно ли `SettingsForms` DSH для ключевых настроек | прогнать схему настроек через DSH UI: векторы, backup, locale | все поля редактируются и сохраняются без кастомного HTML | открыт |
| A15 | Сосуществуют ли два плагина на одном хосте без конфликтов | DSH + Kilo одновременно: порты, lock, temp, model cache, UI storage | 0 конфликтов ресурсов; при занятом порте — graceful disable | **частично (19.10)**: 8787 занимает панель Kilo, 8788–8790 свободны; два экземпляра kilo-memory глушат паразитный (projectRoot=""), рабочий поднимает панель на UNC-корне |

## Формат результата

Для каждого закрытого спайка: дата, хост, версии (Node/Bun/Kilo/OpenCode), команды,
наблюдаемый результат, решение (принять/отклонить/изменить дизайн) и ссылка на ADR,
который это меняет.
