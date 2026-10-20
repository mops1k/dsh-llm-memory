# Sync-groundwork: что заложено и чего ещё нет

Командная синхронизация памяти сейчас **только спроектирована**: в схеме и в коде есть
места под неё, но сетевого sync, auth/ACL, team-UI и разрешения конфликтов нет. Это
осознанное ограничение (ADR-006): заложить поля и интерфейсы сейчас дешевле, чем делать
ломающую миграцию потом.

## Что уже есть в коде

| Что | Где | Поведение сейчас |
|---|---|---|
| Поля `namespace`, `revision`, `device_id`, `updated_by`, `deleted_at`, `sync_state` | `src/core/infrastructure/store.ts` (CREATE TABLE + `ensureColumns`), `src/core/infrastructure/schema.ts` (миграция v2) | Создаются с дефолтами `local` / `0` / `''` / `''` / `NULL` / `local`; запись и чтение их не трогают |
| Таблица `memory_revisions` | DDL в `src/core/sync/index.ts`, создаётся в `store.ensureSchema()` и в `migrate.ts` | Всегда пустая: обычные операции её не заполняют |
| `SyncTransport` и `NullSync` | `src/core/sync/index.ts` | `NullSync` — no-op: `pull` возвращает пустую страницу, `push` — пустой ack; сети не касается |
| Конфиг `sync: { enabled, team, remote }` | `MemoryConfig`/`DEFAULT_CONFIG` (`src/core/domain/config.ts`) | По умолчанию `{ enabled: false, team: null, remote: null }`; включение ничего не запускает |
| Резерв в UI-схеме | `RESERVED_SETTING_PATHS` (`src/core/domain/settings-schema.ts`) | Блок `sync.*` намеренно отсутствует в панелях: включить sync из UI нельзя |

Инварианты, закреплённые тестами ([tests/sync-groundwork.test.ts](../tests/sync-groundwork.test.ts),
[tests/sync.test.ts](../tests/sync.test.ts)):

- миграция добавляет все шесть колонок с дефолтами и пустую `memory_revisions`;
  повторный прогон идемпотентен;
- `save`/`update`/`forget`/`delete` не меняют sync-колонки и не пишут ревизии;
  значения, выставленные будущим sync-слоем, сохраняются при обычном обновлении;
- sync-значения не меняют `recall`, `status` и граф; `deleted_at` пока **не** скрывает
  запись (tombstone — резерв, а не действующее удаление);
- нет сетевых вызовов (`fetch` не вызывается) и фоновых задач, даже при
  `sync.enabled = true`.

## Модель будущей синхронизации

**Транспорт** — git-репозиторий (первый и пока единственный запланированный):
`SyncTransport.pull(cursor)` и `push(operations)` уже задают контракт, `NullSync` —
заглушка по умолчанию.

**Режим** — write + review: изменения уходят не в общую ветку напрямую, а патчем/PR и
проходят review. Поэтому конфликт не «доисправляется» автоматически, а останавливает
sync до ручного решения.

**Namespace.** Личная память приватна по умолчанию (`namespace = 'local'`); для команды
предусмотрен отдельный opt-in namespace (`team`). Автоматической выгрузки личных записей
нет — это защита от утечки личного контекста в общий репозиторий.

**Tombstones.** `deleted_at` — планируемая метка мягкого удаления: будущий sync-слой
удалит запись на других устройствах, увидев tombstone, а `memory_revisions` сохранит
историю операции (`op: 'delete'`). Сегодня `delete()` физически удаляет строку и страницу,
а `deleted_at` всегда `NULL`; кто и когда увидит tombstone — решит реализация sync.

**Конфликты.** Версия записи — `revision`, ожидаемая база правки — `base_revision`,
отпечаток полезной нагрузки — `payload_hash`, состояние строки — `sync_state`
(`local` сегодня; будущие состояния вроде «синхронизировано»/«конфликт» появятся вместе
с транспортом). Три случая при push:

1. `base_revision` равен текущей ревизии на сервере — fast-forward, операция принимается;
2. ревизия уже ушла вперёд, а `base_revision` старее — конфликт: `SyncAck.rejected`
   с причиной, запись остаётся локальной до ручного разрешения (write + review);
3. та же операция пришла повторно (`entry_id` + `revision` + `payload_hash` совпали) —
   идемпотентный no-op.

**Снимок.** Backup-формат `.llmmem` (manifest + SHA-256, ADR-005) переиспользуется как
snapshot для будущего sync: один и тот же способ описать state store без отдельного формата.

## Non-goals сейчас

- Сетевой sync, фоновые задачи, курсы/таймеры.
- Auth, ACL, team-UI, разрешение конфликтов в интерфейсе.
- Синхронизация vector index и model cache: они derived и пересчитываются локально.
- Автоматическая выгрузка личной памяти.
- Включение sync из панелей (блок `sync.*` не входит в UI-схему).

## Чек-лист включения sync (когда дойдёт очередь)

1. Выбрать и реализовать `SyncTransport` для git; настроить review-flow (patch/PR) —
   см. ADR-006 и открытый вопрос о формате review.
2. Заполнять `memory_revisions` при каждой записи (upsert/delete) и выставлять
   `revision`/`device_id`/`updated_by`/`sync_state`.
3. Ввести tombstone-удаление: `deleted_at` вместо физического удаления для
   синхронизируемых namespace; фильтровать tombstone из recall.
4. Реализовать описанную выше обработку конфликтов и политику их разрешения.
5. Добавить поля в UI-схему (убрать их из `RESERVED_SETTING_PATHS`) и в документацию
   панелей, только после того как появится транспорт.
6. Расширить тесты: конфликт трёх видов, идемпотентный повтор, tombstone на двух
   устройствах, отсутствие cross-namespace утечек.

## Связанные документы

- [ADR-006](adr/ADR-006-sync-groundwork.md) — решение: sync только как groundwork, git и
  write + review.
- [backup.md](backup.md) — формат `.llmmem`, который станет snapshot-форматом.
- ТЗ §14–15 (`.dsh/plans/llm-memory-unified-core-tz.md`) и план работ — `p_92bb5e9077d1`.
