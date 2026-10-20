# ADR-011: MCP-адаптер — ревизия протокола, транспорты, авторизация и лимиты

Статус: принято (20.10.2026). Затрагивает `src/adapters/mcp/`, `scripts/build-mcp.mjs`,
`package.json` (`bin`, `exports`), docs/mcp.md.

## Контекст

MCP-адаптер даёт память харнессам без нативного plugin API и работает поверх общего
`MemoryService`. Требования этапа 8 ТЗ: stdio (основной) и Streamable HTTP, собственный
store на `client-id`, инструменты `llm_memory_*` + `llm_memory_backup`, prompt
`memory-guide` и resource `memory://guide`, панель 8789, loopback + токен, консервативные
лимиты, graceful disable при занятых портах, изоляция от Kilo/DSH/OpenCode.

На момент решения актуальная ревизия спецификации MCP — 2026-07-28 (stateless, без
`initialize`, с `server/discover` и `_meta` на каждом запросе). При этом последний
`@modelcontextprotocol/sdk` (1.32.1) объявляет `LATEST_PROTOCOL_VERSION = "2025-11-25"` и
поддерживает 2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05, 2024-10-07. Реальные
клиенты и MCP Inspector собраны на этом SDK, поэтому сервер, говорящий только 2026-07-28,
оказался бы несовместим с ними.

## Решения

1. **Ревизия протокола — 2025-11-25 с `initialize`; negotiate до 2025-06-18 и 2025-03-26.**
   На `initialize` сервер отвечает запрошенной версией, если она в списке поддерживаемых,
   иначе — своей последней; клиент сам решает, продолжать ли. Методы — `initialize`,
   `notifications/initialized`, `ping`, `tools/list`, `tools/call`, `prompts/list`,
   `prompts/get`, `resources/list`, `resources/read`, `resources/templates/list`,
   `logging/setLevel`, `completion/complete`.
2. **SDK в зависимости не добавляется.** JSON-RPC 2.0 и MCP-конверт реализованы в
   `src/adapters/mcp/protocol.ts` (~200 строк): так пакет не тянет ~4.4 МБ распакованного
   SDK, не появляется вторая копия zod/ajv и сохраняется правило «не добавлять зависимости
   без необходимости». Конформность проверяется тестами и живым прогоном MCP Inspector.
3. **Streamable HTTP в JSON-форме.** Один `POST /mcp`, ответ — один JSON-RPC объект;
   уведомления получают `202 Accepted`; SSE-поток и сессии не реализуются, потому что
   сервер не шлёт серверных сообщений, а `Mcp-Session-Id` в этой ревизии опционален.
   `GET`/`DELETE` отвечают `405` (сервер не предлагает SSE-поток), `Last-Event-ID` не
   поддерживается. Legacy HTTP+SSE (2024-11-05) не реализуется: он deprecated.
4. **Авторизация: loopback по умолчанию + обязательный Bearer-токен + проверка `Origin`.**
   Токен берётся из `--token`, `LLM_MEMORY_MCP_TOKEN` или `mcp.token` в конфиге; пустой
   токен выключает HTTP-транспорт с понятной причиной (stdio работает без токена).
   Сравнение — `timingSafeEqual`. `Origin`, если передан, должен указывать на loopback-host
   или быть в `allowedOrigins`; иначе `403` (защита от DNS rebinding). Внешний bind только
   с `--allow-external-bind`, иначе транспорт не стартует. `MCP-Protocol-Version`, если
   передан и не поддерживается, даёт `400`.
5. **Политика delete разделена по транспортам.** В stdio `llm_memory_delete` разрешён
   всегда; в HTTP он не появляется в `tools/list` и отклоняется, пока сервер не запущен с
   `--allow-delete`. `llm_memory_forget` (soft-delete) разрешён всегда. Restore/delete
   бэкапов остаются только в CLI/UI.
6. **Лимиты консервативные и настраиваемые:** вход ≤ 256 KiB на сообщение (`-32600`/`413`),
   тело записи ≤ 1 MiB (ошибка инструмента, в store ничего не пишется), ответ ≤ 2 MiB
   (текст усекается с явным маркером). Значения — `mcp.limits` в конфиге, дефолты в
   `DEFAULT_MCP_LIMITS`.
7. **Store — один на `client-id`:** `~/.llm-memory/mcp/<client-id>` (или `--storage-root`),
   БД `_db/memory.db`, проектные страницы `projects/<project>/<kind>/` внутри стора (в
   репозиторий не пишутся). `client-id` обязателен. Корни Kilo (`~/.config/kilo/memory`),
   DSH (`~/.dsh/llm-memory`) и OpenCode (`~/.config/opencode/memory`) объявлены
   запрещёнными: `createIsolation(...).assertNoForeignPaths()` проверяется до открытия БД.
8. **UI — общий `startPanelServer` на 8789** (тема `mcp`, локаль en): полные настройки и
   backup через legacy API, сохранение в `<store>/config.json`. Занятый порт/выключенный
   UI отключают только панель, MCP-транспорт продолжает работать.
9. **Упаковка:** один бандл `lib/mcp.js` (`scripts/build-mcp.mjs`, shebang, define версии
   и HTML панели), `bin: llm-memory-mcp`, `exports: ./mcp`. Node ≥ 22.19 (`engines`).

## Отклонённые варианты

- **`@modelcontextprotocol/sdk`** — см. п.2: размер, лишние транзитивные зависимости,
  дублирование zod; нужная поверхность реализована и покрыта тестами.
- **SSE-стриминг и сессии** — нечего стримить (нет серверных уведомлений), а JSON-ответ
  поддерживают все клиенты; добавить SSE позже можно, не меняя инструментов.
- **Ревизия 2026-07-28 сразу** — SDK ещё не реализует её; сервер стал бы недоступен
  Inspector и большинству клиентов. Обратная совместимость важнее новизны.
- **OAuth/OIDC и сетевой режим** — вне целей этапа: loopback + локальный токен закрывают
  угрозу «чужой процесс на машине»; внешний bind остаётся явным флагом.

## Последствия и путь обновления

- Клиенты на SDK 1.x подключаются по stdio и HTTP без настройки, кроме `--client-id`
  (stdio) или токена (HTTP).
- Когда SDK начнёт поддерживать 2026-07-28, добавить `server/discover` и чтение
  `_meta["io.modelcontextprotocol/protocolVersion"]` на запросах, не убирая `initialize`.
  Тесты протокола локализуют правку: `tests/mcp-protocol.test.ts` и `tests/mcp-server.test.ts`.
- Откат: убрать `bin`/`exports`/шаг сборки, удалить `src/adapters/mcp/`; store остаётся
  обычным каталогом с markdown-страницами и БД.
