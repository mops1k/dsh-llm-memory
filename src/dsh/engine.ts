/**
 * Memory runtime factory: owns the sqlite-backed store, the memory engine and
 * their lifecycle for one plugin activation.
 *
 * The engine constructs and owns its `MemoryStore` (see `MemoryEngineOptions`):
 * the SQLite index is opened lazily and rebuilt from the markdown pages on disk
 * whenever the derived index is empty. This factory resolves the storage root,
 * builds the engine and forces the first index build so `memory_recall` never
 * races the reindex.
 *
 * @module dsh-llm-memory/dsh/engine
 */
import { mergeConfig, type MemoryConfig } from '../core/config.js'
import { MemoryEngine } from '../core/engine.js'
import { resolveStorageRoot } from '../core/paths.js'

/** Engine plus its lifecycle handle. */
export interface MemoryRuntime {
  readonly engine: MemoryEngine
  /** Close the underlying store and release sqlite resources. */
  close(): void
}

/** Optional host hooks used when creating the runtime. */
export interface MemoryRuntimeOptions {
  /**
   * Fallback project-root resolver (e.g. `ctx.workspaceRegistry`). Invoked only
   * when neither `config.projectRoots` nor `projects.json` knows the key.
   */
  resolveProjectRoot?: (key: string) => string | null | undefined
}

/** Create the memory runtime for one activation (opens the store and reindexes). */
export function createMemoryRuntime(config: MemoryConfig, options: MemoryRuntimeOptions = {}): MemoryRuntime {
  const resolved = mergeConfig(config)
  const storageRoot = resolveStorageRoot(resolved.storageRoot)
  const engine = new MemoryEngine({
    storageRoot,
    config: resolved,
    ...(options.resolveProjectRoot ? { resolveProjectRoot: options.resolveProjectRoot } : {}),
  })

  // `MemoryEngine` owns its `MemoryStore`; the first operation opens the SQLite
  // database and, when the derived index is empty, calls `reindexFromDisk` to
  // rebuild it from the markdown pages. Trigger that once here so the store is
  // open and indexed before the model can call the memory tools.
  engine.list({ status: 'all' })

  return {
    engine,
    close(): void {
      engine.close()
    },
  }
}
