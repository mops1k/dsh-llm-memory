# dsh-llm-memory

Layered long-term memory plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
(dsh), ported from the Kilo `kilo-memory` plugin.

The plugin gives the agent autonomous, layered memory: it stores memories as
markdown pages (the source of truth) with a `node:sqlite` FTS5 index, exposes seven
model-facing tools, injects memory guidance into the system prompt, ships a WebUI
inside the dsh shell, surfaces all settings in the dsh settings card, and can
import existing memory from other plugins.

## Features

- **Seven model-facing tools** (unique `llm_memory_*` names to avoid collisions
  with other memory plugins):
  `llm_memory_recall`, `llm_memory_save`, `llm_memory_forget`,
  `llm_memory_delete`, `llm_memory_status`, `llm_memory_lint`, `llm_memory_heal`.
- **Autonomous memory management**: the agent saves, promotes tiers
  (`normal`/`important`/`immutable`), forgets superseded entries and deletes
  without asking the user. `requireConfirmation` is available but off by default.
- **Stale-memory rule**: when the user changes a decision, the previous memory is
  marked forgotten/superseded instead of being kept as a contradiction.
- **Layered markdown store** as the source of truth, with an FTS5 index rebuilt
  from disk. Pages are grouped by category in `<kind>/` subdirectories:
  ```
  ~/.dsh/llm-memory/
    _user/<kind>/*.md     user (cross-project) memories
    <project>/<kind>/*.md project + feedback fallback when the repo root is unknown
    _db/memory.db         sqlite FTS5 index
    _digest/<id>.md       raw session digests
    log.md
  ```
  Project pages live inside the repository:
  `<projectRoot>/.harness/llm-memory/<kind>/<title-slug>-<id>.md`.
  The file name is `<title-slug>-<id>.md` (the category is the subdirectory,
  matching the KiloCode `pages/<kind>/<slug>.md` layout). Legacy flat pages are
  migrated into `<kind>/` on startup.
- **System-prompt guidance** injected as a prompt section, editable in settings.
- **WebUI in the dsh shell**: a sidebar button opens the memory view in the main
  area (`conversation.view`) as an iframe over the plugin's HTTP page.
- **Settings in dsh**: every option (including the system prompt) is edited in the
  dsh settings card. The card also has **Import memory** and
  **Export rules to dsh AGENTS.md** actions.
- **Importers** (idempotent, keyed by an external key):
  - `kilo-memory` — `~/.config/kilo/memory/db/memory.db` (read-only),
  - `dsh-mnemon` — `~/.mnemon/data/*/mnemon.db` (read-only),
  - `dsh-memory` — markdown files with a `<!-- dsh-memory: {...} -->` header.
  Source roots are auto-detected on Windows, WSL (`/mnt/<drive>/Users/*`) and
  Linux; extra paths can be listed in `importRoots`.
- **Rules export**: copies the Kilo `AGENTS.md` and `immutable-rules.md` into the
  dsh global `$DSH_HOME/AGENTS.md` inside an idempotent managed block. Kilo files
  are only ever read.

## Install

```sh
# first remove any other memory plugin from the profile (for example dsh-mnemon)
dsh plugin --profile web remove dsh-mnemon
dsh plugin --profile web add /path/to/dsh-llm-memory
dsh --profile web --dump-config   # the plugin row should be present
```

The plugin ships a bundle patch (`cordis.patch.yml`) and a browser client
(`lib/client.js`), so the reconciler adds it to `dsh.profile.bundles`
automatically.

## Configuration

All options live in the `dsh-llm-memory` namespace and are edited in the dsh
settings card:

| Option | Default | Description |
| --- | --- | --- |
| `storageRoot` | `$DSH_HOME/llm-memory` | Memory root (empty uses the default). Applied on restart. |
| `recallLimit` | `10` | Maximum entries returned by `llm_memory_recall`. |
| `autonomous` | `true` | Agent manages memory without asking. |
| `requireConfirmation` | `false` | Ask before irreversible operations. |
| `systemPrompt` | built-in | Editable system-prompt guidance (English). |
| `importRoots` | `[]` | Extra directories searched for other plugins' memory. |
| `importAutoDetect` | `true` | Auto-detect source roots on Windows/WSL/Linux. |
| `lintOverlapMinCommonWords` | `8` | Overlap threshold for the lint report. |
| `lintMaxPairs` | `200` | Maximum pairs checked by lint (0 = unlimited). |
| `webPath` | `/llm-memory` | Base HTTP path for the WebUI and API. Applied on restart. |

## Development

```sh
pnpm install
pnpm run typecheck
pnpm run lint
pnpm test
pnpm run build      # tsc + copy client/client.js -> lib/client.js
```

## Layout

```
src/core/          storage, engine, ranking, wiki, frontmatter, importers
src/dsh/           host plugin wiring: tools, context, settings, web, rules export
client/client.js   browser client (classic script, React.createElement, iframe)
ui/web-ui.html     self-contained WebUI page
cordis.patch.yml   bundle patch
scripts/           build helpers
```

## Notes

- Memory is stored under the dsh home, separate from Kilo and from the
  `dsh-memory` plugin (`~/.dsh/memory`), so both can coexist.
- The Kilo config is never modified; sqlite sources are opened read-only
  (an `immutable=1` snapshot is used when a WAL file is present).
- `node:sqlite` is synchronous: the store has a single owner per process.
