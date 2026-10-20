# dsh-llm-memory

Долговременная память для AI-агентов, которые пишут код. Агент помнит, что было решено,
какие правила действуют, как устроен проект и какие у тебя предпочтения, — и начинает
следующую сессию не с пустого контекста, а с этим знанием.

Одна кодовая база работает в четырёх хостах: **DSH**, **Kilo**, **OpenCode** и любом
**MCP-клиенте** (Claude Desktop, Cursor, Zed…). Код общий, память — нет: у каждого харнесса
свой store, и ни один не видит память другого. Это архитектурное свойство, а не соглашение.

## Что умеет

- **Семь инструментов памяти для модели** с уникальными именами `llm_memory_*`: `recall`,
  `save`, `forget`, `delete`, `status`, `lint`, `graph` (в DSH плюс `heal` для
  переиндексации). Имена не конфликтуют с другими плагинами памяти.
- **Автономная работа с памятью**: агент сохраняет durable-знание сразу, повышает tier
  (`normal` / `important` / `immutable`), помечает устаревшее superseded вместо хранения
  противоречий и удаляет только по явному запросу.
- **Гибридный поиск**: FTS5 (BM25) + локальная многоязычная модель эмбеддингов, слияние
  по рангам. Без API-ключа и без сети после первой загрузки модели; без модели поиск
  продолжает работать лексически.
- **Markdown — источник правды**: каждая запись — читаемая страница на диске, индекс —
  SQLite/FTS5; индекс обновляется инкрементально и переживает правки извне.
- **Граф знаний, lint и health**: сущности и связи между записями, отчёты о битых ссылках
  и дублях, самовосстановление индекса.
- **Панели**: нативный раздел настроек и WebUI-вкладка внутри DSH; общий дашборд с
  поиском, графом, картой RAG, настройками и бэкапами для Kilo, OpenCode и MCP.
- **Бэкапы**: ручные архивы `.llmmem` с манифестом и SHA-256; restore защищён вводом
  подтверждения и всегда оставляет копию до восстановления.
- **Экспорт правил**: правила агента можно выгрузить в `AGENTS.md` для других
  инструментов.
- **MCP-сервер**: та же память для любого MCP-клиента через stdio или Streamable HTTP
  с bearer-токеном.

## Одна память на хост

Память не смешивается: DSH, Kilo, OpenCode и MCP держат отдельные базы, страницы, векторные
индексы, порты и локи, поэтому могут стоять рядом. Кросс-харнесного импорта, restore и
поиска нет — это осознанная граница изоляции. См.
[docs/adr/ADR-002-separate-stores.md](docs/adr/ADR-002-separate-stores.md) и
[docs/adr/ADR-007-coexistence-isolation.md](docs/adr/ADR-007-coexistence-isolation.md).

## Установка

Каждый хост получает отдельный артефакт: `dsh-llm-memory-<version>.tgz` для DSH,
`llm-memory-kilo-<version>.js` для Kilo, `llm-memory-opencode-<version>.js` для OpenCode и
`llm-memory-mcp-<version>.js` для MCP, рядом лежит `checksums.txt`.

### DSH

```sh
# сначала удалить из профиля другой плагин памяти (например dsh-mnemon)
dsh plugin --profile web remove dsh-mnemon
dsh plugin --profile web add /path/to/dsh-llm-memory
dsh --profile web --dump-config   # строка плагина должна присутствовать
```

Перезапустите DSH. Пакет содержит bundle-patch и браузерный клиент, поэтому реконсилер сам
добавляет плагин в `dsh.profile.bundles`.

### Kilo

```sh
mkdir -p ~/.config/kilo/plugin
cp llm-memory-kilo-<version>.js ~/.config/kilo/plugin/llm-memory.js
```

Перезапустите Kilo. Плагин читает `~/.config/kilo/llm-memory.json` (старый
`kilo-memory.json` читается как fallback) и поднимает панель на `127.0.0.1:8787`.

### OpenCode

```sh
mkdir -p ~/.config/opencode/plugins          # OpenCode 2.x
cp llm-memory-opencode-<version>.js ~/.config/opencode/plugins/llm-memory.js
# OpenCode 1.x: тот же файл в ~/.config/opencode/plugin/
```

Перезапустите OpenCode. Плагин читает `~/.config/opencode/llm-memory.json` и поднимает
панель на `127.0.0.1:8788`.

### MCP-клиент

```sh
llm-memory-mcp --client-id claude-desktop
# без глобальной установки:
npx -y --package dsh-llm-memory llm-memory-mcp --client-id claude-desktop
```

В конфиг клиента достаточно команды и client-id:

```json
{
  "mcpServers": {
    "llm-memory": {
      "command": "node",
      "args": ["/path/to/llm-memory-mcp-<version>.js", "--client-id", "claude-desktop"]
    }
  }
}
```

Один client-id = одна память (`~/.llm-memory/mcp/<client-id>`). Для HTTP-клиента добавьте
`--transport http --port 8790 --token <секрет>`, панель слушает `127.0.0.1:8789`.

### Семантический поиск (опционально)

Лексический поиск работает сразу. Для векторов поставьте два необязательных пакета в хост
и один раз скачайте модель (около 130 МБ):

```sh
pnpm add @huggingface/transformers sqlite-vec   # каталог профиля DSH
```

В DSH нажмите **Download model** на странице **Settings → LLM Memory**; в Kilo/OpenCode та
же кнопка — на вкладке RAG панели. Модель кэшируется в `<store>/_models` и дальше не требует
сети.

## Документация

| Документ | Содержание |
| --- | --- |
| [docs/README.md](docs/README.md) | Индекс всей документации |
| [docs/configuration.md](docs/configuration.md) | Все настройки и устройство гибридного поиска |
| [docs/mcp.md](docs/mcp.md) | MCP-сервер: stdio, HTTP, инструменты, лимиты, панель |
| [docs/opencode.md](docs/opencode.md) | Адаптер OpenCode 1.x/2.x |
| [docs/cross-platform.md](docs/cross-platform.md) | Пути Windows/Linux, SQLite, обновление плагина |
| [docs/backup.md](docs/backup.md) | Формат `.llmmem` и CLI |
| [docs/development.md](docs/development.md) | Сборка, проверки, совместимость с DSH, структура репозитория |
| [docs/perf.md](docs/perf.md) | Performance baseline |
| [docs/adr/](docs/adr/) | Архитектурные решения |

## Лицензия

MIT.
