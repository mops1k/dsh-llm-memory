# Backup/restore (.llmmem)

Ручной режим по ADR-005: один архив `.llmmem` (ZIP + `manifest.json`), никакого
авто-retention. Восстановление и удаление — только по явному подтверждению
(`RESTORE` / `DELETE`), кросс-harness restore запрещён.

## Состав архива

- `db/memory.db` — снапшот SQLite через `VACUUM INTO` (WAL/SHM не попадают);
- `store/pages/...`, `store/raw/...`, `store/config/...` — раскладка каталога
  хранилища;
- `project/<i>/...` — страницы проектов вне хранилища (Kilo держит их в
  `<repo>/.kilo/memory`), маппинг на исходные пути — в манифесте;
- `manifest.json` — формат, harness, schemaVersion, createdAt, SHA-256 и размер
  каждого файла.

## CLI

```bash
# создать (--passphrase включает AES-256-GCM, по умолчанию выключено)
node scripts/backup-cli.mjs create --harness kilo \
  --store ~/.config/kilo/memory --db ~/.config/kilo/memory/db/memory.db \
  --projects /repo/.kilo/memory --backups ~/.config/kilo/memory/backups

node scripts/backup-cli.mjs list    --backups ~/.config/kilo/memory/backups
node scripts/backup-cli.mjs verify  --archive <file.llmmem>

# восстановление: сначала dry-run (только verify), затем apply
node scripts/backup-cli.mjs restore --harness kilo --store ... --db ... \
  --archive <file.llmmem> --backups ... --dry-run
node scripts/backup-cli.mjs restore ... --confirm RESTORE

node scripts/backup-cli.mjs delete --archive <file.llmmem> --confirm DELETE
```

## Поведение restore

1. verify архива (формат, manifest, checksums, schemaVersion);
2. проверка harness: архив Kilo нельзя восстановить в DSH (и наоборот);
3. pre-restore backup создаётся автоматически в `--backups`;
4. staging: БД и страницы распаковываются во временный каталог, затем БД
   заменяется атомарно, WAL/SHM удаляются, страницы копируются на место;
5. миграции `ensureSchemaV2` + `memory_revisions`, `PRAGMA integrity_check`,
   подсчёт записей в отчёте;
6. при ошибке — откат из pre-restore архива (`rolledBack: true`).

## История

`<backups>/backup-history.jsonl` — строки `create|restore|delete` с датой,
архивом, harness и размером. Автоудаления старых архивов нет.
