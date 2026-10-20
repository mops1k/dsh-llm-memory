import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** Create an isolated storage root for a test. */
export function makeTempRoot(prefix = 'dsh-llm-memory-'): string {
  return mkdtempSync(join(tmpdir(), prefix))
}

const tracked: Array<{ close(): void }> = []

/**
 * Track a resource so cleanup closes it before deleting files. Windows refuses
 * to unlink SQLite files that are still open, so every store/engine/service a
 * test creates must be closed before its temporary root is removed.
 */
export function trackResource<T extends { close(): void }>(resource: T): T {
  tracked.push(resource)
  return resource
}

/** Close every tracked resource (closes are idempotent). */
export function closeTracked(): void {
  while (tracked.length > 0) {
    try {
      tracked.pop()!.close()
    } catch {
      /* ignore close failure */
    }
  }
}

/** Remove a temporary storage root after closing the resources that live in it. */
export function cleanupRoot(root: string): void {
  closeTracked()
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  } catch {
    /* ignore */
  }
}
