/** Compatibility re-export: the runtime installer now lives in the core. */
export {
  EMBEDDING_RUNTIME_PACKAGE,
  EMBEDDING_RUNTIME_SPEC,
  EmbeddingRuntimeInstaller,
  embeddingRuntimeStatus,
  type EmbeddingRuntimeInstallerOptions,
  type EmbeddingRuntimeStatus,
  type RuntimeRunner,
} from '../../core/infrastructure/runtime-install.js'
