# dsh-llm-memory

**English** | [Русский](README.ru.md)

Layered long-term memory plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
(dsh), ported from the Kilo `kilo-memory` plugin.

The plugin gives the agent autonomous, layered memory: memories are markdown pages
(the source of truth) with a `node:sqlite` FTS5 index. It exposes seven
model-facing tools, injects memory guidance into the system prompt, ships a WebUI
panel inside the dsh shell, surfaces all settings as a dedicated Settings section,
and can import existing memory from other plugins.

## Features

- **Seven model-facing tools** with unique `llm_memory_*` names (so they never
  collide with other memory plugins):
  `llm_memory_recall`, `llm_memory_save`, `llm_memory_forget`,
  `llm_memory_delete`, `llm_memory_status`, `llm_memory_lint`, `llm_memory_heal`.
- **Autonomous memory management**: the agent saves, promotes tiers
  (`normal`/`important`/`immutable`), forgets superseded entries and deletes
  without asking the user. `requireConfirmation` exists but is off by default.
- **Stale-memory rule**: when the user changes a decision, the previous memory is
  marked forgotten/superseded instead of being kept as a contradiction.
- **Layered markdown store** as the source of truth, indexed by a central FTS5
  database. Pages are grouped by category in `<kind>/` subdirectories:
  ```
  <projectRoot>/.dsh/llm-memory/<kind>/<title-slug>-<id>.md       project + feedback
  ~/.dsh/llm-memory/_user/<kind>/<title-slug>-<id>.md             user (cross-project)
  ~/.dsh/llm-memory/_db/memory.db                                 central FTS5 index
  ~/.dsh/llm-memory/_digest/<id>.md                               raw session digests
  ~/.dsh/llm-memory/projects.json                                 project key -> root
  ~/.dsh/llm-memory/log.md
  ```
  The file name is `<title-slug>-<id>.md`; the category is the subdirectory
  (matching the KiloCode `pages/<kind>/<slug>.md` layout). Legacy flat pages are
  migrated into `<kind>/` on startup.
  Project entries are keyed by the **basename of the session's working
  directory** (`dsh-llm-memory`, `plasma-keyboard`); the key is mapped to an
  absolute root through `projects.json` and the dsh workspace registry, so pages
  land inside the repository. A session without a working directory falls back to
  the `_no-cwd` placeholder.
- **System-prompt guidance** injected as a prompt section; the text is editable in
  settings (English by default).
- **Dedicated Settings section**: **Settings → LLM Memory** holds every option,
  including the editable system prompt, plus **Save settings**, **Import memory**
  and **Export rules to dsh AGENTS.md**.
- **WebUI panel in the dsh shell**: the **LLM Memory** button in the left sidebar
  opens a panel over the main area (an iframe over the plugin HTTP page); it closes
  on an outside click and on `Escape`. The page has Search & Browse, Create/Edit,
  Graph, Status and Health (lint/heal) sections.
- **Importers** (idempotent, keyed by an external key):
  - `kilo-memory` — `~/.config/kilo/memory/db/memory.db` (opened read-only),
  - `dsh-mnemon` — `~/.mnemon/data/*/mnemon.db` (read-only),
  - `dsh-memory` — the SQLite store of the plugin (`~/.dsh/memory/memory.db`,
    table `memories(id, text, tags, pinned, created_at, updated_at)`, opened
    read-only) and, for older layouts, markdown files with a
    `<!-- dsh-memory: {...} -->` header. The plugin keeps one database per
    machine, so its rows are imported into the cross-project `user` layer;
    `pinned` rows become `tier: important` with importance 5.
  Source roots are auto-detected on Windows, WSL (`/mnt/<drive>/Users/*`) and
  Linux; extra paths can be listed in `importRoots`. Imported projects are
  registered as **dsh workspaces** (when their root path exists).
- **Rules export** into the dsh global `$DSH_HOME/AGENTS.md`:
  - a **preview** first (target, mode, sources, full block text), then confirm;
  - an idempotent managed block — all previous blocks are collapsed into one;
  - the button is **disabled** while the exported block is already in sync;
  - the default source is the **bundled English rules** (`rules/en/AGENTS.md`,
    `rules/en/immutable-rules.md`), so export works on any machine without Kilo;
    `rulesSource: kilo-verbatim` copies the Kilo files as they are.
  Kilo files are only ever read.

## Install

```sh
# remove any other memory plugin from the profile first (for example dsh-mnemon)
dsh plugin --profile web remove dsh-mnemon
dsh plugin --profile web add /path/to/dsh-llm-memory
dsh --profile web --dump-config   # the plugin row must be present
```

The package ships a bundle patch (`cordis.patch.yml`) and a browser client
(`lib/client.js`), so the reconciler adds it to `dsh.profile.bundles`
automatically. Restart dsh after installing.

## Configuration

Open **Settings → LLM Memory**. Values are applied on the next plugin restart.

| Option | Default | Description |
| --- | --- | --- |
| `storageRoot` | `$DSH_HOME/llm-memory` | Memory root (empty uses the default). |
| `recallLimit` | `10` | Maximum entries returned by `llm_memory_recall`. |
| `recallScope` | `project` | Default recall layer: `project` = the session project plus the cross-project `user` layer; `user` = user only; `all` = every project. |
| `autonomous` | `true` | The agent manages memory without asking. |
| `requireConfirmation` | `false` | Ask before irreversible operations. |
| `systemPrompt` | built-in (English) | System-prompt guidance injected into the agent. |
| `importRoots` | `[]` | Extra directories searched for other plugins' memory. |
| `importAutoDetect` | `true` | Auto-detect source roots on Windows/WSL/Linux. |
| `lintOverlapMinCommonWords` | `8` | Overlap threshold for the lint report. |
| `lintMaxPairs` | `200` | Maximum pairs checked by lint (0 = unlimited). |
| `webPath` | `/llm-memory` | Base HTTP path for the WebUI and the API. |
| `rulesSource` | `bundled-en` | Rules export source: bundled English rules or `kilo-verbatim`. |

## Development

```sh
pnpm install
pnpm run typecheck
pnpm run lint
pnpm test
pnpm run build      # tsc + copies client/client.js to lib/client.js
```

## Repository layout

```
src/core/          storage, engine, ranking, wiki, frontmatter, importers
src/dsh/           host plugin wiring: tools, context, settings, web, rules export, workspaces
client/client.js   browser client (classic script, React.createElement, sidebar panel)
ui/web-ui.html     self-contained WebUI page
rules/en/          bundled English rules used by the rules export
cordis.patch.yml   bundle patch
scripts/           build helpers
tests/             vitest suites
```

## Notes and limitations

- Memory lives under the dsh home and inside each project
  (`<project>/.dsh/llm-memory/`), separate from Kilo and from the
  `dsh-memory` plugin (`~/.dsh/memory`), so they can coexist.
- The Kilo config is never modified; sqlite sources are opened read-only
  (an `immutable=1` snapshot is used when a WAL file is present).
- `node:sqlite` is synchronous, so the store has a single owner per process.
- `storageRoot` and `webPath` changes take effect after a plugin restart.
- `llm_memory_recall` searches the current project plus the cross-project `user`
  layer by default; pass `scope: all` to search every project.
- Running several dsh instances at once can rewrite the same state; keep one
  process. After a hard stop, remove a stale `~/.dsh/.credentials.yaml.lock` if
  the next start fails to boot.
