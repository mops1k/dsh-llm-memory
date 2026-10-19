# ADR-006: team-sync только как groundwork (git, write + review)

Статус: принято (19.10.2026). Ссылки: ТЗ §5.6, §14, план §14, §17 п.26–28.

## Контекст

Командная память нужна, но её реализация тянет auth/ACL, разрешение конфликтов, UI и
сетевые фоновые задачи — всё это не входит в текущий объём и не должно появиться скрыто.
При этом если schema-поля и интерфейсы не заложить сейчас, будущая синхронизация
потребует ломающей миграции.

## Решение

Сейчас закладываются только поля, таблица и интерфейсы; сетевого кода нет.

```sql
ALTER TABLE memories ADD COLUMN namespace TEXT NOT NULL DEFAULT 'local';
ALTER TABLE memories ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE memories ADD COLUMN device_id TEXT NOT NULL DEFAULT '';
ALTER TABLE memories ADD COLUMN updated_by TEXT NOT NULL DEFAULT '';
ALTER TABLE memories ADD COLUMN deleted_at TEXT;
ALTER TABLE memories ADD COLUMN sync_state TEXT NOT NULL DEFAULT 'local';

CREATE TABLE IF NOT EXISTS memory_revisions (
  entry_id TEXT NOT NULL, revision INTEGER NOT NULL, op TEXT NOT NULL,
  base_revision INTEGER, actor TEXT NOT NULL, device_id TEXT NOT NULL,
  created_at TEXT NOT NULL, payload_hash TEXT NOT NULL,
  PRIMARY KEY (entry_id, revision)
);
```

- `SyncTransport { capabilities(); pull(cursor); push(ops) }` и `NullSync` (no-op) в core.
- Конфиг `sync: { enabled: false, team: null, remote: null }`; при `enabled=false` сеть не
  вызывается, фоновых jobs нет, `memory_revisions` текущими записями не заполняется.
- Первый будущий транспорт — git-репозиторий; первый режим — write + review (изменения
  оформляются patch/PR и проходят review, а не пишутся напрямую в общую ветку).
- Локальная память приватна по умолчанию: автоматической выгрузки личных записей нет,
  team-память — отдельный opt-in namespace.
- Backup manifest переиспользуется как snapshot-формат будущего sync.

Non-goals сейчас: сетевой sync, auth/ACL, team-UI, разрешение конфликтов в UI,
синхронизация vector index/model cache.

## Последствия

- Плюс: будущая синхронизация не потребует ломающей миграции схемы.
- Минус: «мёртвые» поля в схеме и `NullSync` нужно держать под тестами, чтобы они не
  начали влиять на поведение записи/чтения.
