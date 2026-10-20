# Приёмка P6: RAG в Kilo на Windows и Linux

Дата: 20.10.2026. План `p_c7de70db394f`, фаза P6. Инварианты: живые данные не
теряются, эксперименты идут на копиях, живой стор меняется только после бэкапа.

## Стенды

| Стенд | Runtime | Хранилище | Модель |
|---|---|---|---|
| Windows 10.0.26200.9457 | Bun 1.4.3 (как в Kilo 7.8.13) | `C:\Users\Kvintilyanov\.config\kilo\memory` (копия и живой) | `Xenova/multilingual-e5-small`, 384, q8, 134 МБ в `<store>/_models` |
| WSL2 archlinux | Node 24.20.0 | `/tmp/kilo-e2e-store` (копия) | та же, скопирована вместе со стором |

Скрипты приёмки: `scripts/e2e-kilo-rag.ts` (полный прогон: backfill → recall →
карта → rebuild) и `scripts/kilo-backfill.ts` (только векторная таблица, без
reinforce страниц). Оба собираются esbuild и запускаются на копии/живом сторе.

## 1. Копия живого стора, Linux/Node

- 323 записи → **824 чанка**, backfill **109.8 с** (~340 мс на запись).
- `health`: checked 323, missing/partial/orphans/broken/badDim = 0.
- Карта: 323 точки, 824 чанка, модель `Xenova/multilingual-e5-small`, backend `js`.
- Recall (гибрид, 5 записей): 58–101 мс; `sources` показывает ноги `bm25+vector+metadata`.
- Запрос без лексического пересечения (`embeddings cosine similarity`) вернул
  записи с ногой `vector+metadata` — семантика работает не только как
  дополнение к FTS.
- `rebuild` (очистка + повторный backfill): **139.7 с**, после — те же 323/824,
  очередь пуста.
- `integrity_check` копии БД — `ok`; `memories` 323, `memory_vectors` 824.

## 2. Копия живого стора, Windows/Bun

- 323 записи → 824 чанка; backfill **65.8 с** (часть векторов уже была в копии,
  поэтому быстрее), rebuild **101.8 с**.
- `health`: 0 проблем; карта 323 точки; модель, backend и топ-5 ответов на все
  четыре запроса **совпали с Linux-прогоном**, проекция запроса дала те же id.
- Recall: 176–217 мс (Bun + in-process ONNX; DSH держит модель в воркере).

## 3. Живой Kilo-стор на Windows (production)

Перед изменениями: файловый бэкап `memory/backups/pre-rag-20261020T194445/`
(`db`, `pages`, `raw`) и `.bak` старого плагина.

1. **Плагин**: `lib/kilo.js` (2.24 МБ) → `~/.config/kilo/plugin/llm-memory.js`,
   прежний файл сохранён рядом.
2. **Рантайм**: `npm install --no-save --no-package-lock @huggingface/transformers@^4.3.1`
   в `~/.config/kilo` (41 пакет, 9 с, +4 минорных обновления транзитивных,
   `package.json`/lockfile не изменены). Пакет резолвится из
   `~/.config/kilo/node_modules`, т.е. ровно так, как его импортирует бандл.
3. **Backfill живого стора** (Bun, скрипт из каталога плагина, без recall и без
   reinforce): **72.5 с**, 323 записи → **824 чанка**, `health` — 0 проблем,
   `model.enabled=true`, `runtime.present=true`, `cached=true` (7 файлов,
   140 461 908 байт).
4. **Проверка живых данных** (копия БД вместе с WAL, `integrity_check`): `memories`
   **323** (active 277) — без потерь; `memory_vectors` **824** (323 записи);
   `memory_revisions` 0. Процесс Kilo жив (1 процесс), старый плагин продолжает
   работать до перезапуска сессии.
5. **Откат проверен на бэкапе**: БД из `pre-rag-…` открывается, 323 записи,
   `memory_vectors` 0 — восстановление вернёт стор в состояние до RAG.

## 4. Откат (при необходимости)

1. Вернуть плагин: `cp ~/.config/kilo/plugin/llm-memory.js.bak-<ts> …/llm-memory.js`.
2. Вернуть стор: `db`, `pages`, `raw` из `memory/backups/pre-rag-<ts>/`.
3. Рантайм: `rm -rf ~/.config/kilo/node_modules/@huggingface` (или весь
   `node_modules`, если ставился только он); при желании
   `embeddings.provider = "off"` — лексический поиск продолжает работать.
4. Кэш весов `<store>/_models` можно не удалять: он не влияет на лексику.

## 5. Осталось подтвердить в живом GUI

Автоматически не проверяется (нужен перезапуск сессии Kilo пользователем):
вкладка «Карта RAG» после рестарта показывает проекцию из `/vectors/map`,
кнопка «Перестроить векторы» активна, вкладка «Поиск» идёт через `/recall`.
API и рендер покрыты `tests/kilo-rag.test.ts`; дизайн панели не менялся.

## 6. Регрессия

Полный набор: **409 тестов** (1 skip: e2e модели) — зелёный; typecheck, lint
(0 ошибок), build (DSH-бандл, web-ui, kilo). DSH-память не менялась:
`~/.dsh/llm-memory` — 1178 записей, 3521 вектор, поведение recall прежнее
(тесты `vectors`, `vector-leg`, `recall`).
