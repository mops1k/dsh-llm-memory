# dsh-llm-memory

[English](README.md) | **Русский**

Плагин долговременной слоистой памяти для
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh),
порт плагина `kilo-memory` из Kilo.

Плагин даёт агенту автономную слоистую память: записи хранятся как markdown-страницы
(источник правды), а поиск обеспечивает центральный FTS5-индекс на `node:sqlite`.
Плагин регистрирует семь инструментов для модели, добавляет инструкции по работе с
памятью в системный промпт, показывает WebUI-панель внутри оболочки dsh, выводит все
настройки отдельным пунктом Settings и умеет импортировать уже имеющуюся память из
других плагинов.

## Возможности

- **Семь инструментов для модели** с уникальными именами `llm_memory_*` (чтобы не
  конфликтовать с другими плагинами памяти):
  `llm_memory_recall`, `llm_memory_save`, `llm_memory_forget`,
  `llm_memory_delete`, `llm_memory_status`, `llm_memory_lint`, `llm_memory_heal`.
- **Автономная работа с памятью**: агент сам сохраняет записи, повышает tier
  (`normal`/`important`/`immutable`), помечает устаревшее забытым и удаляет — без
  запросов подтверждения. Опция `requireConfirmation` есть, но по умолчанию
  выключена.
- **Правило «забывать неактуальное»**: если пользователь изменил решение, прежняя
  запись помечается забытой/superseded, а не остаётся противоречием.
- **Слоистое markdown-хранилище** (источник правды) с центральным FTS5-индексом.
  Страницы разложены по категориям в подпапки `<kind>/`:
  ```
  <projectRoot>/.harness/llm-memory/<kind>/<title-slug>-<id>.md   project + feedback
  ~/.dsh/llm-memory/_user/<kind>/<title-slug>-<id>.md             user (кросс-проектные)
  ~/.dsh/llm-memory/_db/memory.db                                 центральный FTS5-индекс
  ~/.dsh/llm-memory/_digest/<id>.md                               сырые дайджесты сессий
  ~/.dsh/llm-memory/projects.json                                 ключ проекта -> корень
  ~/.dsh/llm-memory/log.md
  ```
  Имя файла — `<title-slug>-<id>.md`, категория — имя подпапки (как в KiloCode:
  `pages/<kind>/<slug>.md`). Старые плоские файлы при старте мигрируют в `<kind>/`.
- **Инструкции в системном промпте**: текст добавляется отдельной секцией и
  редактируется в настройках (по умолчанию — английский).
- **Отдельный пункт настроек**: **Settings → LLM Memory** содержит все опции, в том
  числе редактируемый системный промпт, а также кнопки **Save settings**,
  **Import memory** и **Export rules to dsh AGENTS.md**.
- **WebUI-панель в оболочке dsh**: кнопка **LLM Memory** в левой панели открывает
  панель поверх основной области (iframe со страницей плагина); закрывается кликом
  вне панели и по `Escape`. На странице — разделы Search & Browse, Create/Edit,
  Graph, Status, Health (lint/heal).
- **Импортёры** (идемпотентные, по внешнему ключу):
  - `kilo-memory` — `~/.config/kilo/memory/db/memory.db` (только чтение),
  - `dsh-mnemon` — `~/.mnemon/data/*/mnemon.db` (только чтение),
  - `dsh-memory` — markdown-файлы с заголовком `<!-- dsh-memory: {...} -->`.
  Корни источников определяются автоматически на Windows, в WSL (`/mnt/<drive>/Users/*`) и
  Linux; дополнительные пути задаются в `importRoots`. Импортированные проекты
  регистрируются как **воркспейсы dsh** (если их корневой путь существует).
- **Экспорт правил** в глобальный `$DSH_HOME/AGENTS.md`:
  - сначала **предпросмотр** (цель, режим, источники, полный текст блока), затем
    подтверждение;
  - идемпотентный управляемый блок — все прежние блоки схлопываются в один;
  - кнопка **неактивна**, пока экспортированный блок совпадает с источниками;
  - источник по умолчанию — **зашитые английские правила** (`rules/en/AGENTS.md`,
    `rules/en/immutable-rules.md`), поэтому экспорт работает на любой машине без
    Kilo; режим `rulesSource: kilo-verbatim` копирует файлы Kilo как есть.
  Файлы Kilo при этом только читаются.

## Установка

```sh
# сначала удалить из профиля другой плагин памяти (например dsh-mnemon)
dsh plugin --profile web remove dsh-mnemon
dsh plugin --profile web add /path/to/dsh-llm-memory
dsh --profile web --dump-config   # строка плагина должна присутствовать
```

Пакет содержит bundle-patch (`cordis.patch.yml`) и браузерный клиент
(`lib/client.js`), поэтому реконсилер сам добавляет плагин в `dsh.profile.bundles`.
После установки перезапустите dsh.

## Настройки

Откройте **Settings → LLM Memory**. Значения применяются после перезапуска плагина.

| Опция | По умолчанию | Описание |
| --- | --- | --- |
| `storageRoot` | `$DSH_HOME/llm-memory` | Корень хранилища (пусто — по умолчанию). |
| `recallLimit` | `10` | Максимум записей, возвращаемых `llm_memory_recall`. |
| `autonomous` | `true` | Агент управляет памятью без запросов. |
| `requireConfirmation` | `false` | Спрашивать перед необратимыми операциями. |
| `systemPrompt` | встроенный (английский) | Инструкции, добавляемые в системный промпт агента. |
| `importRoots` | `[]` | Дополнительные каталоги для поиска памяти других плагинов. |
| `importAutoDetect` | `true` | Автоопределение корней на Windows/WSL/Linux. |
| `lintOverlapMinCommonWords` | `8` | Порог пересечения слов для отчёта lint. |
| `lintMaxPairs` | `200` | Максимум пар, проверяемых lint (0 — без лимита). |
| `webPath` | `/llm-memory` | Базовый HTTP-путь для WebUI и API. |
| `rulesSource` | `bundled-en` | Источник правил для экспорта: зашитые английские правила или `kilo-verbatim`. |

## Разработка

```sh
pnpm install
pnpm run typecheck
pnpm run lint
pnpm test
pnpm run build      # tsc + копирование client/client.js в lib/client.js
```

## Структура репозитория

```
src/core/          хранилище, движок, ranking, wiki, frontmatter, импортёры
src/dsh/           хост-обвязка: tools, context, settings, web, экспорт правил, workspaces
client/client.js   браузерный клиент (classic script, React.createElement, панель из сайдбара)
ui/web-ui.html     самодостаточная страница WebUI
rules/en/          зашитые английские правила для экспорта
cordis.patch.yml   bundle-patch
scripts/           вспомогательные скрипты сборки
tests/             наборы vitest
```

## Заметки и ограничения

- Память хранится в каталоге dsh и внутри каждого проекта
  (`<project>/.harness/llm-memory/`) — отдельно от Kilo и от плагина
  `dsh-memory` (`~/.dsh/memory`), поэтому они могут существовать одновременно.
- Конфиг Kilo никогда не изменяется; sqlite-источники открываются только на чтение
  (при наличии WAL используется снимок `immutable=1`).
- `node:sqlite` синхронный, поэтому у хранилища один владелец на процесс.
- Изменения `storageRoot` и `webPath` вступают в силу после перезапуска плагина.
- Несколько одновременно запущенных экземпляров dsh могут перезаписывать одно и то
  же состояние — держите один процесс. После жёсткой остановки удалите stale-lock
  `~/.dsh/.credentials.yaml.lock`, если следующий запуск не стартует.
