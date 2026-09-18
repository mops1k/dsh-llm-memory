import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Create an isolated storage root for a test. */
export function makeTempRoot(prefix = 'dsh-llm-memory-'): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

/** Remove a temporary storage root. */
export function cleanupRoot(root: string): void {
  try {
    rmSync(root, { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}
