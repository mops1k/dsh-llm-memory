# Пробный плагин kilo-probe (временно)

Назначение — закрыть спайки, недоступные без работающего Kilo: A2 (bun:sqlite),
A4 (загрузчик плагина), A7 (стабильность system-промпта по sessionID), A10 (WAL/UNC),
A15 (порты и сосуществование).

## Что делает

- при загрузке пишет `~/.config/kilo/kilo-probe-report.json`: версия Bun, platform,
  `directory`/`worktree`, загрузчик принял файл;
- однократно: `bun:sqlite` — WAL, кириллица, наличие `loadExtension`, затем то же самое
  на UNC-пути `\\wsl.localhost\<distro>\tmp\kilo-probe-unc.db` (A10);
- проверяет наличие `sqlite-vec` и `@huggingface/transformers` в `~/.config/kilo/node_modules`
  (A2/A3 — только факт наличия, модель не скачивается);
- проверяет занятость портов 8787/8788/8789/8790 (A15);
- в `experimental.chat.system.transform` вставляет маркер `[[kilo-probe:v1]]` и считает,
  сколько раз он пережил следующий вызов transform в той же сессии (A7);
- регистрирует read-only инструмент `probe_report`, возвращающий отчёт (A4).

В память Kilo не пишет, БД не открывает, сервер не поднимает. Временные файлы — только
`%TEMP%\kilo-probe-*.db` и `/tmp/kilo-probe-unc.db`, удаляются при завершении пробы.

## Запуск

1. Файл уже скопирован в `~/.config/kilo/plugin/kilo-probe.ts`.
2. Перезапустить Kilo (плагины загружаются при старте).
3. Открыть любой проект и отправить одно короткое сообщение — это вызовет transform.
4. Прислать отчёт: `C:\Users\Kvintilyanov\.config\kilo\kilo-probe-report.json`.

## Удаление после прогона

```
rm ~/.config/kilo/plugin/kilo-probe.ts ~/.config/kilo/kilo-probe-report.json
```

и перезапустить Kilo. Инструмент `probe_report` исчезнет вместе с плагином.

## Что считается результатом

| Спайк | Поле отчёта | Критерий |
|---|---|---|
| A2 | `sqlite.localJournal`, `localRows`, `sqliteVecModule` | WAL + кириллица ок; `sqlite-vec` есть или нет |
| A4 | `runtime.pluginLoaded` | `true` = загрузчик принимает отдельный файл плагина и его tool |
| A7 | `transforms[sid].calls` / `markerPersisted` | `markerPersisted ≥ 1` = вставка переживает вызовы, кэш по сессии возможен |
| A10 | `sqlite.uncJournal` / `uncError` | WAL на UNC либо падает (ожидаемо по A1), либо работает |
| A15 | `ports` | занятые порты = чей-то экземпляр уже слушает |
