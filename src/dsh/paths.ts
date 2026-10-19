/**
 * DSH-specific path policy (ADR-008): the `DSH_HOME` override and the default
 * `~/.dsh/llm-memory` root live in the adapter, not in the shared core.
 */
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

/** Environment variable holding the DSH home directory. */
export const DSH_HOME_ENV = 'DSH_HOME'

/** Resolve the DSH storage root: explicit override, then `$DSH_HOME`, then `~/.dsh`. */
export function resolveStorageRoot(override?: string | null): string {
  const custom = typeof override === 'string' ? override.trim() : ''
  if (custom.length > 0) return resolve(custom)
  const dshHome = (process.env[DSH_HOME_ENV] ?? '').trim()
  if (dshHome.length > 0) return resolve(join(dshHome, 'llm-memory'))
  return resolve(join(homedir(), '.dsh', 'llm-memory'))
}
