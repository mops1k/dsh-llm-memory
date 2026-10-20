/**
 * Coexistence isolation primitives (ADR-007).
 *
 * Core never learns another harness's paths: every instance is described by
 * `InstanceIdentity` and validated against roots it must not touch, declared
 * by its own adapter.
 */
export type Harness = 'kilo' | 'dsh' | 'opencode' | 'mcp'

export interface InstanceIdentity {
  harness: Harness
  /** Process-level instance id (several windows of the same harness). */
  instanceId: string
  /** Store id derived from the instance (namespaces locks, temp, UI keys, env). */
  storeId: string
}

/** Ports reserved per harness. DSH has no web UI (ADR-004). */
export const PORT_REGISTRY: Readonly<Record<Harness, readonly number[]>> = {
  kilo: [8787],
  opencode: [8788],
  mcp: [8789, 8790],
  dsh: [],
}

export interface ResourceClaim {
  storeRoot: string
  dbPath: string
  pagesDir: string
  lockDir: string
  tempDir: string
  logDir: string
  modelDir: string
  backupDir: string
}
