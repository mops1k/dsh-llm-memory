# ADR-007: coexistence isolation для одновременно установленных харнесов

Статус: принято (19.10.2026). Ссылки: ТЗ §1.2, §5.7, план §5.4, ADR-002.

## Контекст

Пользователь может держать установленными kilocode, DSH, OpenCode и MCP одновременно.
Общий код при этом не даёт права на общий runtime: два экземпляра на одном порту, общий
`memory.db`, общий model cache или общий lock-каталог дают либо `database is locked`,
либо утечку памяти одного харнеса в другой.

## Решение

```ts
interface InstanceIdentity { harness: 'kilo'|'dsh'|'opencode'|'mcp'; instanceId: string; storeId: string }

interface IsolationContract {
  owns(path: string): boolean
  assertNoForeignPaths(): void
  portLease(): PortLease
  lock(name: string): LockHandle
}
```

- Каждый экземпляр имеет `InstanceIdentity`; все ресурсы namespaced по `storeId`.
- `storeRoot` и `dbPath` уникальны и лежат на **локальном диске**: SQLite на UNC/9p не работает
  (`database is locked` — A1/A10), тогда как страницы-файлы на UNC допустимы.
- WAL/SHM/FTS/vector-таблицы — только в своей БД.
- Порты из реестра: Kilo web 8787, OpenCode web 8788, MCP UI 8789, MCP HTTP 8790;
  занятый порт — graceful disable с записью в лог, а не захват чужого. DSH web UI
  использует порт своего хоста (см. ADR-004).
- `lock`/PID/temp/log/backup — внутри своего store с префиксом `storeId`.
- UI `localStorage`: ключи `llm-memory:<harness>:<storeId>:...`.
- Env: `LLM_MEMORY_<HARNESS>_*`; общих глобальных переменных нет.
- Process-wide singleton допустим только с явным namespace по `storeId`.
- Model cache — свой у каждого харнеса; общий допустим только read-only и
  content-addressed, без записи.
- `assertNoForeignPaths()` вызывается на старте адаптера и в contract-тестах; тест
  «no foreign path» обязателен для каждого адаптера.

## Последствия

- Плюс: 2+ харнеса работают одновременно без конфликтов DB/FTS/vectors/ports/locks/UI,
  и это проверяется тестами, а не обещанием.
- Минус: дублирование model cache и vector index по харнесам — осознанная плата за
  изоляцию; экономия допустима только для read-only content-addressed кэша.
