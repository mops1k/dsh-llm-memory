# Кроссплатформенность: пути, IO, SQLite, CI

Дата: 20.10.2026. Приложение к плану `p_c7de70db394f`, фаза P5.
Проверки шли на Windows 10.0.26200.9457 (WSL2, чтение Windows-ФС через `/mnt/c`)
и на Linux (WSL2 `archlinux`, Node 24.20).

## 1. Пути

- **Ввод пользователя** (`storageRoot` в конфиге) проходит через
  `normalizeStoragePath` (`src/core/layout/paths.ts`): раскрываются `~`,
  `$VAR`, `${VAR}`, `%VAR%`, снимаются обрамляющие кавычки, на Windows `/`
  приводится к `\`. Неизвестная переменная остаётся как есть — опечатка видна.
  Применяется в `resolveStorageRoot` ядра, адаптере DSH (`$DSH_HOME`) и в
  KiloService (пустой `storageRoot` = штатный layout харнесса).
- **Сетевые шары запрещены**: `isUncPath` ловит `\\server\share` и
  `//server/share`, `resolveStorageRoot` бросает понятную ошибку до SQLite.
  Причина — A1/A10: WAL на UNC/9p падает `database is locked`/`disk I/O error`.
  Windows-путь `C:\...` на не-Windows хосте тоже отклоняется.
- **Длинные пути Windows**: `LongPathsEnabled = 0` (P1), лимит MAX_PATH 260.
  `windowsExtendedPath` добавляет префикс `\\?\` (и `\\?\UNC\` для шар) путям
  длиннее 240 символов; используется в обходе кэша модели, проверке целостности
  и загрузке весов. Самый длинный существующий файл Kilo-стора — 182 символа,
  запас есть; проектные сторы в глубоких каталогах — на контроле.
- **Разделители и пробелы**: пути строятся только через `node:path`, поэтому
  Windows и Linux получают свой разделитель; пробелы и кириллица в каталогах
  поддерживаются (имена страниц санитизируются отдельно).
- **Кэш модели**: `<store>/_models/<org>/<model>` на обеих платформах
  (`modelCacheDir`), совпадает с тем, что пишет transformers.js, поэтому модель
  переносится вместе со стором и читается офлайн.

## 2. Файловый IO

- **Атомарная запись страниц**: `writeFileAtomic` — временный файл
  `<file>.tmp-<pid>-<time>` + `renameSync`; при ошибке переименования временный
  файл удаляется, исключение уходит вызывающему. На Windows антивирус может
  держать файл при `rename`: ошибка не глотается, а всплывает с путём.
- **CRLF**: чтение frontmatter и page-body нормализует `\r?\n`; `index.md` и
  вывод recall тоже. Страницы, записанные Kilo на Windows, читаются на Linux и
  наоборот (fixtures `tests/fixtures/kilo/pages`).
- **Права**: недоступный файл страницы трактуется как отсутствующий
  (`readFileIfExists` → null). На Windows POSIX-биты не действуют, поэтому
  соответствующий тест помечен `skipIf(win32)` — иначе CI-матрица ложно краснела.
- **Удаление**: `rmSync(force)`/`unlinkSync` с проглатыванием только
  «уже удалено»; ошибки доступа не скрываются.

## 3. SQLite

- Драйверы: `node:sqlite` (Node ≥ 22.19 / 24) и `bun:sqlite` (Kilo, Bun 1.4.x);
  выбор автоматический по `globalThis.Bun` (`resolveSqliteDriver`). Оба дают
  WAL, FTS5, `loadExtension` (A1, A2).
- Открытие: `PRAGMA journal_mode = WAL;` + `PRAGMA busy_timeout = 5000;`.
  Сбой pragma не валит открытие (read-only/сеть), но пишется в debug с
  объяснением.
- Ошибка открытия оборачивается `describeStorageError`: сообщение содержит путь,
  исходный текст драйвера и подсказку про локальный диск/блокировку — вместо
  голого `unable to open database file` (тест `tests/storage-errors.test.ts`).
- Режимы: DSH держит соединение долго, Kilo открывает по требованию и закрывает
  (`open-on-demand`), при восстановлении бэкапа БД закрывается на время замены.
- Живой Kilo при открытом приложении блокирует БД для 9p-чтения из WSL
  (`disk I/O error`); аудит и приёмка идут по копии или через `?immutable=1`.

## 4. Установка и обновление плагина на Windows

- Артефакты: `lib/kilo.js` → `~/.config/kilo/plugin/llm-memory.js` (единый файл,
  панель и API внутри), конфиг `llm-memory.json`; старый `kilo-memory.json`
  читается как fallback (`resolveConfigFile`), запись всегда в новое имя.
- Рантайм эмбеддингов не входит в бандл; ставится в `~/.config/kilo` по явному
  действию «Скачать модель» (ADR-010), `package.json` хоста не меняется
  (`--no-save --no-package-lock`).
- Обновление плагина — замена одного файла `llm-memory.js`; конфиг и стор не
  трогаются, векторная таблица и кэш модели остаются на месте.
- Тесты: `tests/kilo-plugin.test.ts` (конфиг/fallback), `tests/kilo-contract.test.ts`
  (layout и изоляция), `tests/kilo-runtime-install.test.ts` (рантайм),
  `tests/kilo-rag.test.ts` (RAG-нога).

## 5. CI-матрица

`.github/workflows/ci.yml`: `ubuntu-latest` и `windows-latest`, Node 24,
pnpm 12.3.4 (`--frozen-lockfile`): `typecheck` → `lint` → `test` → `build`;
отдельная Windows-джоба проверяет, что собранные бандлы (`lib/kilo.js`,
`lib/web-ui.js`, `lib/client.js`) существуют и не пусты. Векторные тесты идут на
детерминированном fake-провайдере, поэтому CI не требует ONNX-рантайма и сети.

## Известные ограничения

- `onnxruntime-node` — нативный модуль: обновление Bun/Kilo может его сломать,
  проверено на Bun 1.4.3; повторная проба описана в ADR-010.
- MAX_PATH 260 при `LongPathsEnabled = 0` остаётся риском для очень глубоких
  проектных корней; префикс `\\?\` покрывает файловые операции кэша модели.
- 9p/UNC для стора не поддерживается принципиально (ADR-002, A1/A10).
