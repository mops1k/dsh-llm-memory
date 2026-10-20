/**
 * Layout port: paths of exactly one harness (ADR-002). Core never learns the
 * paths of another harness, so implementations are injected per adapter.
 */
export type LayoutKind = 'kilo' | 'dsh' | 'opencode' | 'mcp'

export type LayoutScope = 'global' | 'project' | 'user'

export class StorePathError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StorePathError'
  }
}

/**
 * SQLite does not work on UNC/9p shares (spikes A1/A10: `database is locked`),
 * so the store must live on a local disk even when project pages are remote.
 */
export function assertLocalPath(path: string): string {
  if (path.startsWith('\\\\') || path.startsWith('//')) {
    throw new StorePathError(
      `store path must be on a local disk, got a UNC/share path: ${path}. ` +
        'SQLite cannot open a database there (9p/SMB locking is unsupported).',
    )
  }
  return path
}

export interface LayoutPort {
  readonly kind: LayoutKind
  /** Root of the user/global store. */
  userRoot(): string
  /** Root of the project store inside a repository. */
  projectRoot(projectKey: string): string
  dbPath(): string
  pagesDir(scope: LayoutScope, projectKey?: string): string
  projectKey(cwd: string): string
  /** Throws `StorePathError` when the store is not on a local disk. */
  assertLocalStore(): void
}

export interface LayoutOptions {
  /** Fake home directory for tests. */
  home?: string
  /** Repository root used for project-scope paths (defaults to process.cwd()). */
  cwd?: string
  /** MCP client id; required by `McpLayout`. */
  clientId?: string
}

export function sanitizeProjectKey(value: string): string {
  const key = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
  return key.length > 0 ? key : 'no-cwd'
}
