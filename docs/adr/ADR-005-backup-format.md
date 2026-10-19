# ADR-005: backup/restore как один `.llmmem`-архив с ручным режимом

Статус: принято (19.10.2026). Ссылки: ТЗ §5.5, план §13, ADR-002.

## Контекст

Память — единственная невосстановимая часть плагина: страницы и БД живут в разных местах,
SQLite пишется в WAL, а векторы и модели — производные данные. Нужен переносимый,
проверяемый и обратимый снимок для каждого харнеса, без фоновой автоматики, которая может
удалить не то.

## Решение

**Формат.** Один zip `<name>-<timestamp>.llmmem`:

```
manifest.json
db/memory.db
pages/...
raw/...
config/...
```

`manifest.json`: `formatVersion`, `createdAt`, `harness`, `layout`, `schemaVersion`,
`pluginVersion`, `counts`, `includesVectors`, `files[] {path, size, sha256}`.

**Состав.** SQLite-снимок через `VACUUM INTO` или backup API (без копирования WAL в
неконсистентном состоянии), страницы user/global и все project-страницы, `raw/`, digest и
индексные md, конфигурация памяти, реестр проектов, версии схемы/плагина/frontmatter.
По умолчанию **не входят** embeddings, vector index и модели — пересоздаются после restore.
Опционально — включить (флаг), шифрование архива опционально и по умолчанию выключено.

**Создание.** Проверка места и прав → снимок → manifest и SHA-256 → запись во временный
каталог → атомарное переименование → запись в `backup-history.json`. Автоматического
retention/prune и расписания нет: старые архивы не удаляются никогда без человека.

**Restore.** `verify` (формат, manifest, checksums, версии) → проверка `harness`/`layout`
(restore в чужой харнес запрещён без отдельной миграции) → подтверждение вводом `RESTORE`
→ pre-restore backup текущего состояния (всегда) → распаковка в staging → проверка
counts/relations/страниц → остановка харнеса, атомарная замена DB и страниц, очистка
WAL/SHM → при необходимости migrations → smoke `status`/`lint`/`recall` → при ошибке
rollback на pre-restore backup.

**Удаление** — только вручную, с подтверждением `DELETE`.

**Поверхности.** CLI `llm-memory backup create|list|verify|restore|delete`
(`--dry-run` по умолчанию, `--apply --confirm RESTORE`), API
`POST /api/backup`, `GET /api/backup`, `POST /api/backup/verify`,
`POST /api/backup/restore`, UI во всех харнесах (Kilo/OpenCode/MCP — web, DSH — нативные
формы), MCP-инструмент `llm_memory_backup` (create/list/verify; restore — только CLI/UI).

## Последствия

- Плюс: один формат для всех харнесов, проверяемость по SHA-256, обратимость через
  pre-restore backup, никаких фоновых удалений.
- Минус: restore требует остановки харнеса и явного ввода слова; перенос между машинами
  одного харнеса возможен, между харнесами — нет (адресно и осознанно).
- Отклонено: авто-создание по расписанию и авто-retention (риск удалить единственный
  снимок), общий архив на несколько харнесов (смешивание памяти).
