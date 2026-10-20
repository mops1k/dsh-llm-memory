# OpenCode adapter

Второй адаптер после Kilo: память, правила, компакция и панель на том же ядре
(`MemoryService`/`VectorLeg`), но со своим стором — OpenCode не читает память Kilo и DSH
(ADR-002). Стадия плана `p_92bb5e9077d1`.

## 1. Одна сборка для двух поколений хоста

Хосты OpenCode двух разных линеек, и у них разный контракт плагина:

| Линейка | Загрузка | Контракт |
|---|---|---|
| OpenCode 1.x | `~/.config/opencode/plugin/*.{js,ts}` | `export default { id, server }`, `server(ctx) → Hooks` |
| OpenCode 2.x | `~/.config/opencode/plugins/*.{js,ts}` | `export default { id, setup }`, `setup(ctx) → cleanup` |

`lib/opencode.js` — один bundle, который экспортирует `{ id, server, setup }`. Каждый загрузчик
читает свою часть и игнорирует незнакомую, поэтому раскладывать два файла не нужно:

```
~/.config/opencode/plugin/llm-memory.js    # OpenCode 1.x
~/.config/opencode/plugins/llm-memory.js   # OpenCode 2.x  (тот же файл)
```

- v1: хуки `tool`, `event`, `config`, `experimental.chat.system.transform`,
  `experimental.session.compacting`, `experimental.text.complete`, `dispose`.
- v2: `ctx.tool.transform(editor => editor.add(...))` добавляет `llm_memory_*`; `ctx.session.hook`
  `context` вставляет правила в `system`, `compaction` — сводку консолидации/кристаллизации.
  `execute` инструментов возвращает обычный Promise: живой хост 2.1.1 прогоняет его через
  codemode-мост, который вызывает `.then` на результате (проверено живьём).

Имя инструментов — канонические `llm_memory_*`, без алиасов (ADR-003); в v2 они вызываются
напрямую или через codemode `execute` (`tools.llm_memory_status(...)`).

## 2. Файлы и стор

```
~/.config/opencode/llm-memory.json        # конфиг (legacy-имя opencode-memory.json читается как fallback)
~/.config/opencode/plugins/llm-memory.js  # плагин (v2); он же в plugin/ для v1
<project>/.opencode/memory/               # стор проекта (layout opencode)
~/.config/opencode/memory/                # пользовательский слой (_user)
```

- порт панели по умолчанию — `8788` (`web.port`), хост — `127.0.0.1`;
- `LLM_MEMORY_OPENCODE_DIR` переопределяет каталог конфига (тесты/несколько профилей);
- эмбеддинги включаются в `embeddings.provider`, модель кэшируется в `<store>/_models` (ADR-010);
  рантайм `@huggingface/transformers` ставится npm-ом только по действию «Скачать модель».

## 3. Установка

1. `npm run build` → `lib/opencode.js`.
2. Скопировать файл в `plugin/` (OpenCode 1.x) и/или `plugins/` (OpenCode 2.x) каталога
   `~/.config/opencode`.
3. Для 1.x рядом с плагином нужен `@opencode-ai/plugin` в `node_modules` каталога конфига
   (`package.json` с зависимостью + `bun install`/`npm install`): из него берётся `tool()`,
   чтобы отдать хосту zod-схемы аргументов. Без него инструменты остаются дескрипторами и хост
   их не увидит.
4. Перезапустить сессию OpenCode; память появится в `llm_memory_*`, панель — на `http://127.0.0.1:8788/`.

Конфиг по умолчанию создаётся при первом старте: `enabled: true`, `promptMode: dynamic`,
`recallLimit: 10`, эмбеддинги выключены.

## 4. Панель

Общий дизайн отдаётся `startPanelServer` (kind `opencode`, apiBase `/api/legacy`), тот же, что у Kilo
и DSH. Страница `src/ui/design/panel.html` генерируется `scripts/build-panel.mjs` из
`src/ui/design/panel/` и вшивается в бандл; отдаётся с `cache-control: no-store`, поэтому после
обновления плагина достаточно перезапустить хост. API — legacy-адаптер: `/api/legacy/*` (см.
[panel-api.md](panel-api.md)). Тесты: `tests/opencode-legacy-server.test.ts`,
`tests/opencode-v2.test.ts`, `tests/opencode-dual.test.ts`.

## 5. Живые проверки

- **OpenCode 2.1.1** (Windows, `opencode-cli.exe 2.1.1`): плагин загружен из `plugins/`, сессия
  вызвала `llm_memory_save` и `llm_memory_status` через codemode — запись сохранена
  (`m_86b0027df679`), статус вернул `total: 1`; повторный запуск вернул `Total memory entries: 1`.
  Панель на 8788 поднимается в harness-setup (HTTP 200, `/api/legacy/settings/snapshot` 200).
- **OpenCode 1.18.32 и 1.19.3** (Linux): модуль собран по контракту v1 (`default { id, server }`,
  см. `packages/opencode/src/plugin/shared.ts` из тега v1.18.32), покрыт юнит-тестами
  (`tests/opencode-adapter.test.ts`, `tests/opencode-dual.test.ts`). Живой прогон на этих сборках
  не удался по причине хоста: ни один внешний файл плагина не импортируется — контрольный плагин
  с `throw` на верхнем уровне и маркерным файлом не дал ни импорта, ни записи маркера, ни строки
  «failed to load plugin», хотя `debug config` перечисляет `plugin_origins` с этими файлами.
  Это ограничение проверенной среды, а не контракта плагина; на своей 1.x-сборке проверяйте
  `llm_memory_status` в сессии.
