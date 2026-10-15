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
- **Incremental index refresh**: the FTS5 database stores each page's size and
  mtime. A reindex (`llm_memory_heal`, startup after a legacy flat migration)
  re-reads only pages that are new or changed — an unchanged page costs a single
  `stat`, and a page edited outside the plugin is picked up by the next heal.
  `scripts/bench-index.mjs` reports that cost per storage root, which matters on
  slow mounts such as WSL `/mnt/c`.
- **Scoped lite restrictions**: an agent preset can import
  `dsh-llm-memory/tool-restrict` to hide delete/status/lint/heal while the full
  preset and the WebUI/API keep all seven globally registered tools.
- **System-prompt guidance** injected as a prompt section; the text is editable in
  settings (English by default).
- **Dedicated Settings section**: **Settings → LLM Memory** holds the live-editable
  options, including the system prompt, plus **Save settings**, **Import memory**
  and **Export rules to dsh AGENTS.md**.
- **WebUI panel in the dsh shell**: the **LLM Memory** view tab next to the
  conversation renders the WebUI as a React view inside the shell (no iframe) and
  follows the dsh light/dark theme through the `--dsw-*` design tokens. The view
  has Search & Browse, Create/Edit, Graph, Map, Recall, Status, Lint and Health (lint/heal)
  sections. The same page is still served standalone at the plugin HTTP path
  (`<webPath>/ui`), using the same tokens.
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
  - the default source is the **bundled English canonical rules** (`rules/en/AGENTS.md`),
    which already carries the unique immutable clauses;
    `rulesSource: kilo-verbatim` still copies both Kilo files as they are.
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

The package declares two optional dependencies (`optionalDependencies`):
`@huggingface/transformers` (the local embedding model) and `sqlite-vec` (the
SQL vector index). If the package manager skipped them, add them by hand:

```sh
cd ~/.dsh/profiles/web && pnpm add @huggingface/transformers sqlite-vec
```

The first semantic query downloads `Xenova/multilingual-e5-small` (~120 MB) into
`<storageRoot>/_models` (that is `~/.dsh/llm-memory/_models`). Without these
dependencies the plugin keeps working as before, on FTS5.

## Configuration

Open **Settings → LLM Memory**. Values are applied on the next plugin restart.

The page is drawn by the plugin's own client bundle (`client/client.js` →
`lib/client.js`), so its field list lives there: a new schema setting needs a form
entry, a save call through `scope.set` and markup. Schema fields are declared
`volatile()` because dsh's settings service accepts edits only along volatile
paths (`Config field … is not volatile` otherwise). Cordis hands volatile values
over as reactive wrappers, so the plugin unwraps them (`unwrapSettings`) when
`apply` starts and works with plain data afterwards.

The embedding settings are **flat** in the schema and in the profile patch
(`embeddingsProvider`, `embeddingsDim`, …); `toMemoryConfig` folds them back into
the core shape (`embeddings: { provider, dim, … }`).

| Option | Default | Description |
| --- | --- | --- |
| `storageRoot` | `$DSH_HOME/llm-memory` | Memory root (empty uses the default). |
| `recallLimit` | `10` | Maximum entries returned by `llm_memory_recall`. |
| `recallFormat` | `markdown` | Format recall returns when the agent does not ask for one (`markdown`, `table`, `timeline`, `json`). |
| `recallAllowFormatOverride` | `true` | Let the agent pick another format per call. Off pins recall to `recallFormat` and the tool description says so. |
| `recallLiteralLookup` | `true` | Read a literal-looking query (error code, version, file name, id) as a lookup: the lexical leg decides when it matched. Measured: closes an 18 pp hit@1 gap on exact tokens, no effect on semantic queries. |
| `promptRulesLimit` | `6` | Maximum rules/preferences lines injected into the system prompt. The digest is part of every request, so keep it small. |
| `rulesPromptScope` | `project` | Project reach of that digest: `project` keeps the cross-project `user` layer plus the current workspace, `all` keeps every project. |
| `recallScope` | `project` | Default recall layer: `project` = the session project plus the cross-project `user` layer; `user` = user only; `all` = every project. |
| `autonomous` | `true` | The agent manages memory without asking. |
| `requireConfirmation` | `false` | Ask before irreversible operations. |
| `systemPrompt` | built-in (English) | System-prompt guidance injected into the agent. |
| `importRoots` | `[]` | Extra directories searched for other plugins' memory. |
| `importAutoDetect` | `true` | Auto-detect source roots on Windows/WSL/Linux. |
| `lintOverlapMinCommonWords` | `8` | Overlap threshold for the lint report. |
| `lintMaxPairs` | `200` | Maximum pairs checked by lint (0 = unlimited). |
| `webPath` | `/llm-memory` | Base HTTP path for the WebUI and the API. |
| `rulesSource` | `bundled-en` | Rules export source: canonical bundled English AGENTS.md or `kilo-verbatim` (both source files). |
| `embeddingsProvider` | `local` | Embedding source: `off` (lexical FTS5 only), `local` (in-process multilingual model), `http` (reserved, not implemented yet). |
| `embeddingsModel` | `Xenova/multilingual-e5-small` | Embedding model id (a transformers.js model for `local`). |
| `embeddingsDim` | `384` | Vector length; vectors of another length are rebuilt. |
| `embeddingsBackend` | `js` | Where neighbours are found: `js` (in-process scan), `sqlite-vec` (KNN in SQL, needs the `sqlite-vec` package) or `off`. |
| `embeddingsQuantization` | `float` | Storage precision of `sqlite-vec`: `float`, `int8` (4× smaller) or `bit` (32× smaller, but noticeably lossier). |
| `embeddingsTopK` | `50` | Chunk hits the vector leg contributes before rank fusion with FTS5. |
| `embeddingsMinScore` | `0` | Minimum cosine of a vector hit; e5 cosine is compressed, so keeping 0 and relying on ranking is safer. |
| `embeddingsBatchSize` | `16` | Texts embedded per model call while indexing. |
| `embeddingsChunkChars` | `800` | Target characters per chunk. |
| `embeddingsChunkOverlap` | `120` | Overlap between neighbouring chunks (capped at half the chunk size). |
| `embeddingsSemanticEdgesPerEntry` | `3` | Semantic neighbours per entry kept in the Wiki graph. |
| `embeddingsSemanticMaxEdges` | `300` | Overall cap on those edges. |
| `embeddingsPrewarm` | `true` | Load the model in the background at startup rather than on the first query. |

### Startup-only profile option

The native Settings card intentionally omits `sessionStartGuide`. Configure it in the
profile patch when the richer system-prompt section is always present:

```yaml
- id: dsh-llm-memory
  config:
    sessionStartGuide: false
```

Reload or restart the profile plugin so the listener is reconstructed. A live patch reload
may do this automatically, but a running plugin does not change the listener set in place.
Other profiles retain the compatibility default `true`.

## Development

```sh
pnpm install
pnpm run typecheck
pnpm run lint
pnpm test
pnpm run build      # tsc + copies client/client.js to lib/client.js
```

## Compatibility with DSH upgrades

Since DSH 0.2.0-rc.2 the profile loader skips a whole bundle whose
`@deepseek-ai/dsh*` peerDependencies do not satisfy the running runtime
(`evaluatePluginCompatibility` in `@deepseek-ai/dsh-app-boot`), so the plugin
silently disappears from the session. Every DSH peer is therefore declared as
`workspace:^`, which the loader always reads as the current runtime, and
`scripts/check-dsh-compat.mjs` verifies both the peer ranges and the runtime
symbols the plugin reaches for.

After every DSH upgrade run:

```sh
pnpm check:dsh     # peer ranges + runtime symbols
pnpm run typecheck
pnpm test
```

Then restart DSH.

## Repository layout

```
src/core/          storage, engine, ranking, wiki, frontmatter, importers
src/dsh/           host plugin wiring: tools, context, settings, web, rules export, workspaces
src/tool-restrict.ts  scoped preset restriction subpath
client/client.js   browser client (classic script, React.createElement, React view on --dsw-* tokens + settings section)
ui/web-ui.html     standalone WebUI page (same dsh tokens, light/dark)
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

## Semantic search (vector RAG)

Recall fuses three legs through Reciprocal Rank Fusion: FTS5 (BM25), entry
metadata and cosine similarity over chunk vectors. Metadata carries a much lower
weight (0.1): it is query-independent and only breaks ties — on a real store, at
weight 1.0 it pushed relevant hits out of the top of the ranking.

How it works:

- Embeddings come from the local `Xenova/multilingual-e5-small` model (384
  dimensions, q8) through `@huggingface/transformers`; the model is cached in
  `<storageRoot>/_models`, and no API key or network is needed after the first
  download. Press **Download model** on the **Settings → LLM Memory** page (about
  130 MB, with a percentage, next to Check again and Delete cached model) instead
  of fetching it by hand; the download runs in a worker thread, so dsh stays
  responsive. The offline route still works: drop the same files into
  `<storageRoot>/_models/Xenova/multilingual-e5-small`. Until the model is there,
  search runs on FTS5.
- ONNX inference does not yield the event loop (measured: a 64-text batch took
  3.4 s with a single timer tick), so indexing runs in a worker thread and never
  blocks dsh; a query is embedded in process (~19 ms).
- Pages are split into sentence-aligned chunks (`chunkChars`/`chunkOverlap`); the
  embedded text is the title plus the chunk body, and a chunk's identity hashes
  its text and the model, so unchanged chunks are never re-embedded and a model
  change invalidates the vectors by itself.
- Vectors live in `memory_vectors` (the canonical float32 cache). The
  `sqlite-vec` backend also mirrors them into a `vec0` table: KNN in SQL, filters
  by project/scope/kind/tier/status and optional quantization.
- Switching backends re-embeds nothing — the derived table is rebuilt from the
  cache. Switching the model re-embeds the entries.

Measurements from 2026-10-15 (WSL2, Linux x64, Node v24.20.0, CPU) on a copy of
the live store — 1059 entries, 3217 chunks × 384 dimensions:

| What | Value |
| --- | --- |
| In-process scan (`js`) | 24.0 ms average, p95 49.4 ms |
| `sqlite-vec` float | 11.6 ms, p95 22.1 ms, 100 % agreement with `js`, 4.71 MB |
| `sqlite-vec` int8 | 5.0 ms, p95 8.8 ms, 94.3 % agreement, 1.18 MB |
| `sqlite-vec` bit | 1.8 ms, 39.6 % agreement, 0.15 MB (expert mode) |
| Backfill of an existing store | 1056 entries → 3210 chunks, 4.70 MB, about 9 minutes on CPU |
| Recall self-retrieval hit@1 / hit@5 (40 samples, k=5) | lexical 70 % / 100 %, hybrid 92.5 % / 100 % |

Helper scripts (they need `pnpm build`):

```sh
# fill vectors of a store created before RAG (working on a copy)
node scripts/backfill-vectors.mjs --copy --keep
# compare the backends and the quantization levels
node scripts/bench-vector.mjs --root /tmp/llm-memory-backfill-XXXX
# compare lexical and semantic retrieval
node scripts/bench-recall.mjs --root /tmp/llm-memory-backfill-XXXX --samples 40
```

What semantics adds beyond recall:

- `detail: "excerpt"` in `llm_memory_recall` returns the passage the vector leg
  matched instead of the head of the body, inside the same character budget.
- The Wiki graph gains `related` edges from cosine similarity (a relative cut:
  top-N neighbours per entry), and lint gains merge candidates plus the size of
  the prompt digest.
- e5 cosine is compressed (related ~0.91, unrelated ~0.74), so every threshold in
  this plugin is a relative rule rather than an absolute value.
- The **Map** tab draws the embeddings themselves: every entry is a point on the
  plane of the two leading principal components (the PCA runs inside the plugin,
  with no new dependencies), coloured by project or kind, sized by chunk count,
  with the semantic graph edges as grey lines. The "Place a query" field embeds
  free text, drops a crosshair on the map and rings the closest entries, so it is
  visible where recall is looking. The two axes carry only part of the variance
  (about 17% on the live store of 1068 entries / 3234 chunks), so the map is an
  overview: trust the edges and rings more than absolute distances. Coordinates
  are cached until the index changes; **Refresh** rebuilds them (~120 ms on the
  live store, ~260 kB response).

Degradation: with `provider: off`, a missing `@huggingface/transformers`, a
failing worker or an extension that cannot load, the plugin falls back to FTS5;
`llm_memory_status`, `/api/status` and the Health panel show indexing progress
and the last error. Switching the backend to `sqlite-vec` needs a plugin
restart: extension loading is only allowed when the connection is created.
