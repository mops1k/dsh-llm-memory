# MCP-адаптер: `llm-memory-mcp`

Локальный MCP-сервер, который даёт любому MCP-совместимому харнессу (Claude Desktop,
Cursor, Zed, собственный агент) те же операции памяти, что и нативные адаптеры DSH, Kilo
и OpenCode. Работает на общем ядре `MemoryService`, но **со своим store на каждый
`client-id`** и не читает память других харнессов.

Решение по протоколу, транспортам и авторизации — [ADR-011](adr/ADR-011-mcp-adapter.md).

## Требования

- Node.js ≥ 22.19 (в `engines` пакета; проверено на Node 24).
- Пакет `dsh-llm-memory` версии ≥ 1.4.0 (бинарь собирается из `src/adapters/mcp/cli.ts`
  в `lib/mcp.js`).
- Модель эмбеддингов не нужна: по умолчанию `embeddings.provider = "off"`, recall
  лексический, пока в конфиге не включена локальная модель.

## Быстрый старт (stdio)

stdio — основной режим: клиент сам запускает процесс и общается NDJSON по stdin/stdout.

```sh
llm-memory-mcp --client-id claude-desktop
# или без глобальной установки:
npx -y --package dsh-llm-memory llm-memory-mcp --client-id claude-desktop
```

`client-id` обязателен: он задаёт каталог памяти (`~/.llm-memory/mcp/<client-id>`).
Разные клиенты получают разные store и не видят записи друг друга.

Конфиг клиента (Claude Desktop, `claude_desktop_config.json`; у Cursor/Zed форма та же —
`command` + `args`):

```json
{
  "mcpServers": {
    "llm-memory": {
      "command": "node",
      "args": [
        "/path/to/dsh-llm-memory/lib/mcp.js",
        "--client-id", "claude-desktop"
      ]
    }
  }
}
```

Если нужно вынести store (только локальный диск, UNC/9p отвергается):

```sh
llm-memory-mcp --client-id claude-desktop --storage-root /data/llm-memory/claude
```

## HTTP (Streamable HTTP)

Для GUI/remote-клиентов, которым нужен URL:

```sh
llm-memory-mcp --transport http --client-id cursor \
  --port 8790 --token "$(openssl rand -hex 24)"
```

- Endpoint: `POST http://127.0.0.1:8790/mcp`, заголовок `Authorization: Bearer <token>`.
- Ответ — один JSON-RPC объект; уведомления получают `202`. `GET`/`DELETE` → `405`
  (сервер не предлагает SSE-поток). `Mcp-Session-Id` не выдаётся и не требуется.
- Токен обязателен: без него HTTP-транспорт не стартует (stdio при этом работает).
  Токен берётся из `--token`, `LLM_MEMORY_MCP_TOKEN` или `mcp.token` в конфиге.
- Bind только loopback. Внешний адрес — только с `--allow-external-bind`, и это осознанный
  риск: токен и `Origin` остаются единственной защитой.
- `Origin`, если передан, должен указывать на loopback-хост (защита от DNS rebinding).

## Флаги и переменные окружения

| Флаг | Env | По умолчанию | Назначение |
|---|---|---|---|
| `--transport stdio\|http` | `LLM_MEMORY_MCP_TRANSPORT` | `stdio` | Транспорт |
| `--client-id <id>` | `LLM_MEMORY_MCP_CLIENT_ID` | — (обязателен) | Владелец store |
| `--storage-root <path>` | `LLM_MEMORY_MCP_STORAGE_ROOT` | `~/.llm-memory/mcp/<id>` | Корень store |
| `--project-root <path>` | `LLM_MEMORY_MCP_PROJECT_ROOT` | `cwd` | Проект по умолчанию |
| `--project-key <key>` | `LLM_MEMORY_MCP_PROJECT_KEY` | basename | Ключ проекта |
| `--host <host>` | `LLM_MEMORY_MCP_HOST` | `127.0.0.1` | Bind HTTP |
| `--port <port>` | `LLM_MEMORY_MCP_PORT` | `8790` | Порт HTTP |
| `--token <token>` | `LLM_MEMORY_MCP_TOKEN` | — | Bearer для HTTP |
| `--allow-delete` | `LLM_MEMORY_MCP_ALLOW_DELETE` | выкл. | `llm_memory_delete` по HTTP |
| `--allow-external-bind` | `LLM_MEMORY_MCP_ALLOW_EXTERNAL_BIND` | выкл. | Bind вне loopback |
| `--config <path>` | `LLM_MEMORY_MCP_CONFIG` | `<store>/config.json` | Файл конфига |
| `--ui` / `--no-ui` | `LLM_MEMORY_MCP_UI` | вкл. | Панель на 8789 |

`--help` печатает справку, `--version` — версию сервера (она же уходит в `serverInfo`).

## Store

```
~/.llm-memory/mcp/<client-id>/
  _db/memory.db                 SQLite + FTS5 (и таблица векторов, если RAG включён)
  _user/<kind>/*.md             пользовательские (кросс-проектные) записи
  projects/<project>/<kind>/*.md  проектные записи — внутри store, не в репозитории
  _models/                      кэш модели эмбеддингов (если provider=local)
  backups/                      архивы .llmmem
  config.json                   настройки этого клиента
```

Один `client-id` = одна память. Клиент начинает с пустого store: перенос записей из
Kilo/DSH/OpenCode запрещён (ADR-002), это разные доверенные контуры.

## Инструменты

Все имена — `llm_memory_*` (без aliases, ADR-003). Аргумент `project` ограничивает
проектные записи одним проектом.

| Инструмент | Что делает | Примечания |
|---|---|---|
| `llm_memory_recall` | поиск по памяти | пустой `query` — самые важные активные записи |
| `llm_memory_save` | сохранить durable-знание | `scope: project\|global`, `kind`, `tier`, `importance`, `tags` |
| `llm_memory_forget` | soft-delete (`superseded`) | страница и история остаются на диске |
| `llm_memory_delete` | жёсткое удаление | stdio — всегда; HTTP — только с `--allow-delete` |
| `llm_memory_status` | totals/scopes/kinds/consolidation | |
| `llm_memory_lint` | битые ссылки, устаревшее, дубли заголовков | |
| `llm_memory_graph` | сущности, связи, хабы | |
| `llm_memory_backup` | `create` / `list` / `verify` архивов `.llmmem` | restore и удаление — только CLI/UI |

Результат — `content: [{type: "text", ...}]`; у `save` и `status` есть ещё
`structuredContent` для клиентов, которые его используют.

### Лимиты

| Что | По умолчанию | Поведение при превышении |
|---|---|---|
| Сообщение JSON-RPC | 256 KiB | `-32600` (stdio) / `413` (HTTP) |
| Текст одной записи | 1 MiB | ошибка инструмента (`isError`), в store ничего не пишется |
| Отрендеренный ответ | 2 MiB | текст усекается с маркером `…[truncated: response limit]` |

Значения лежат в `config.json` → `mcp.limits` и меняются без пересборки.

## Prompt и resource

MCP не даёт hook в системный промпт, поэтому правила памяти доступны тремя путями:

- `instructions` в ответе `initialize` (клиенты, которые их показывают модели);
- prompt **`memory-guide`** (`prompts/get`) — те же правила отдельным сообщением;
- resource **`memory://guide`** (`resources/read`, `text/markdown`) — для клиентов,
  которые подключают ресурсы к контексту.

Правило простое: вызвать `llm_memory_recall` в начале задачи, если ответ зависит от
прежних решений/правил/фактов, и сохранять durable-знание сразу.

## Панель управления (8789)

Пока сервер жив, на `http://127.0.0.1:8789/` поднимается общая панель (тот же дизайн, что
у Kilo/OpenCode): обзор, записи, граф, карта RAG, настройки и бэкапы этого store.
Изменения настроек пишутся в `<store>/config.json`.

- Порт занят → панель отключается с записью в stderr, MCP-транспорт продолжает работать.
- `--no-ui` или `web.enabled=false` в конфиге → панель не поднимается.
- По ADR-005 restore и удаление архивов выполняются только из панели/CLI и требуют
  подтверждения.

## Изоляция и сосуществование

- Store MCP не может указывать на `~/.config/kilo/memory`, `~/.dsh/llm-memory` или
  `~/.config/opencode/memory` — проверка выполняется до открытия БД и падает с
  `IsolationViolation`.
- Свои порты: 8789 (панель), 8790 (HTTP) — из реестра ADR-007.
- recall/RAG/backup никогда не выходят за пределы store своего `client-id`.

## Ограничения (non-goals)

- Нет автоматической инъекции в system prompt — только `instructions`/prompt/resource.
- Нет хуков компактирования и кристаллизации: maintenance — вручную через инструменты/CLI.
- Нет SSE-стриминга, серверных уведомлений, `Mcp-Session-Id`, OAuth, sampling/roots/
  elicitation и ревизии протокола 2026-07-28 (см. ADR-011 — это осознанно).
- Нет доступа к чужой памяти: MCP-клиент не видит Kilo/DSH/OpenCode и наоборот.

## Проверка

```sh
# в репозитории
npm run typecheck && npm test && npm run build
node lib/mcp.js --version

# живой прогон по stdio (MCP Inspector)
npx -y @modelcontextprotocol/inspector --cli node lib/mcp.js --client-id inspector --no-ui \
  --method tools/list
```

Inspector в браузере: `npx -y @modelcontextprotocol/inspector node lib/mcp.js --client-id inspector`.
Для HTTP: в Inspector указать `http://127.0.0.1:8790/mcp` и заголовок
`Authorization: Bearer <token>`.
