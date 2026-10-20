# dsh-llm-memory

Long-term memory for AI coding agents. The agent remembers what was decided, which rules
apply, what the project is like and which preferences to respect — and starts the next
session with that knowledge instead of an empty context.

One codebase serves four hosts: **DSH**, **Kilo**, **OpenCode** and any **MCP client**
(Claude Desktop, Cursor, Zed…). The code is shared; the memories are not: each harness keeps
its own store, and no harness can read another's — by design, not by convention.

## What it does

- **Seven memory tools for the model** with unique `llm_memory_*` names: `recall`, `save`,
  `forget`, `delete`, `status`, `lint`, `graph` (DSH adds `heal` for reindexing). The names
  never collide with other memory plugins.
- **Autonomous memory**: the agent saves durable knowledge immediately, promotes tiers
  (`normal` / `important` / `immutable`), supersedes outdated entries instead of keeping
  contradictions, and deletes only on an explicit request.
- **Hybrid search**: FTS5 (BM25) + a local multilingual embedding model, fused by rank.
  No API key, no network after the first model download; without the model it keeps working
  on lexical search alone.
- **Markdown as the source of truth**: every entry is a readable page on disk, indexed by a
  SQLite/FTS5 database; the index rebuilds incrementally and survives outside edits.
- **Knowledge graph, lint and health**: entities and edges between entries, broken-reference
  and duplicate reports, self-healing of the index.
- **Panels**: a native settings section and a WebUI panel inside DSH; one shared dashboard
  with search, graph, RAG map, settings and backups for Kilo, OpenCode and MCP.
- **Backups**: manual `.llmmem` archives with a manifest and SHA-256 checksums; restore is
  guarded by a typed confirmation and always keeps a pre-restore copy.
- **Rules export**: the agent's rules can be exported into `AGENTS.md` for other tools.
- **MCP server**: the same memory for any MCP client, over stdio or Streamable HTTP with a
  bearer token.

## One memory per host

Memories never mix: DSH, Kilo, OpenCode and MCP keep separate databases, pages, vector
indexes, ports and locks, so they can be installed side by side. There is no cross-harness
import, restore or search — that is a deliberate isolation boundary. See
[docs/adr/ADR-002-separate-stores.md](docs/adr/ADR-002-separate-stores.md) and
[docs/adr/ADR-007-coexistence-isolation.md](docs/adr/ADR-007-coexistence-isolation.md).

## Install

Every host is a separate artifact: `dsh-llm-memory-<version>.tgz` for DSH,
`llm-memory-kilo-<version>.js` for Kilo, `llm-memory-opencode-<version>.js` for OpenCode and
`llm-memory-mcp-<version>.js` for MCP, with a `checksums.txt` next to them.

### DSH

```sh
# remove any other memory plugin from the profile first (for example dsh-mnemon)
dsh plugin --profile web remove dsh-mnemon
dsh plugin --profile web add /path/to/dsh-llm-memory
dsh --profile web --dump-config   # the plugin row must be present
```

Restart DSH. The package ships a bundle patch and a browser client, so the reconciler adds it
to `dsh.profile.bundles` automatically.

### Kilo

```sh
mkdir -p ~/.config/kilo/plugin
cp llm-memory-kilo-<version>.js ~/.config/kilo/plugin/llm-memory.js
```

Restart Kilo. The plugin reads `~/.config/kilo/llm-memory.json` (the old `kilo-memory.json`
is read as a fallback) and serves its panel on `127.0.0.1:8787`.

### OpenCode

```sh
mkdir -p ~/.config/opencode/plugins          # OpenCode 2.x
cp llm-memory-opencode-<version>.js ~/.config/opencode/plugins/llm-memory.js
# OpenCode 1.x: same file into ~/.config/opencode/plugin/
```

Restart OpenCode. The plugin reads `~/.config/opencode/llm-memory.json` and serves its panel
on `127.0.0.1:8788`.

### MCP client

```sh
llm-memory-mcp --client-id claude-desktop
# without a global install:
npx -y --package dsh-llm-memory llm-memory-mcp --client-id claude-desktop
```

The client config only needs the command and the client id:

```json
{
  "mcpServers": {
    "llm-memory": {
      "command": "node",
      "args": ["/path/to/llm-memory-mcp-<version>.js", "--client-id", "claude-desktop"]
    }
  }
}
```

One client id = one memory (`~/.llm-memory/mcp/<client-id>`). For an HTTP client add
`--transport http --port 8790 --token <secret>`; the panel listens on `127.0.0.1:8789`.

### Semantic search (optional)

Lexical search works out of the box. For vectors, install the two optional packages in the
host and download the model once (about 130 MB):

```sh
pnpm add @huggingface/transformers sqlite-vec   # DSH profile directory
```

In DSH press **Download model** on **Settings → LLM Memory**; in Kilo/OpenCode the same
button lives on the panel's RAG tab. The model is cached in `<store>/_models` and needs no
network afterwards.

## Documentation

| Document | Content |
| --- | --- |
| [docs/README.md](docs/README.md) | Index of all documentation |
| [docs/configuration.md](docs/configuration.md) | Every setting, and how hybrid search works |
| [docs/mcp.md](docs/mcp.md) | MCP server: stdio, HTTP, tools, limits, panel |
| [docs/opencode.md](docs/opencode.md) | OpenCode 1.x/2.x adapter |
| [docs/cross-platform.md](docs/cross-platform.md) | Windows/Linux paths, SQLite, plugin updates |
| [docs/backup.md](docs/backup.md) | `.llmmem` format and CLI |
| [docs/development.md](docs/development.md) | Build, checks, DSH compatibility, repository layout |
| [docs/perf.md](docs/perf.md) | Performance baseline |
| [docs/adr/](docs/adr/) | Architecture decisions |

## License

MIT.
