/**
 * Contract checks shared by all adapters (ADR-002/007): every layout must keep
 * its store inside its own roots, resolvable project keys and a local-disk DB.
 * Structural types only — the testkit has no dependency on core internals.
 */
export type LayoutScope = 'global' | 'project' | 'user'

export interface LayoutLike {
  readonly kind: string
  userRoot(): string
  projectRoot(projectKey: string): string
  dbPath(): string
  pagesDir(scope: LayoutScope, projectKey?: string): string
  projectKey(cwd: string): string
  assertLocalStore(): void
}

export interface ContractCheck {
  name: string
  ok: boolean
  detail?: string
}

function inside(parent: string, child: string): boolean {
  const norm = (value: string): string => value.replace(/[\\/]+$/, '')
  const p = norm(parent)
  const c = norm(child)
  return c === p || c.startsWith(p + '/') || c.startsWith(p + '\\')
}

/** Run layout invariants; returns every check so failures can be reported at once. */
export function layoutContract(layout: LayoutLike, options: { cwd?: string } = {}): ContractCheck[] {
  const checks: ContractCheck[] = []
  const check = (name: string, ok: boolean, detail?: string): void => {
    checks.push(detail === undefined ? { name, ok } : { name, ok, detail })
  }
  const cwd = options.cwd ?? '/repo/proj-a'
  const key = layout.projectKey(cwd)
  check('userRoot is absolute-ish', layout.userRoot().length > 0, layout.userRoot())
  check('dbPath lives inside userRoot', inside(layout.userRoot(), layout.dbPath()), layout.dbPath())
  check('global pages live inside userRoot', inside(layout.userRoot(), layout.pagesDir('global')))
  check('project pages live inside projectRoot', inside(layout.projectRoot(key), layout.pagesDir('project', key)))
  check('projectKey is stable', layout.projectKey(cwd) === key, key)
  check('projectKey is slug-safe', /^[a-z0-9._-]+$/.test(key), key)
  let localError: string | null = null
  try {
    layout.assertLocalStore()
  } catch (error) {
    localError = String(error)
  }
  check('store is on a local disk', localError === null, localError ?? undefined)
  return checks
}

/** Throw with the full failure list; used by adapter contract tests. */
export function assertLayoutContract(layout: LayoutLike, options: { cwd?: string } = {}): void {
  const failed = layoutContract(layout, options).filter(item => !item.ok)
  if (failed.length > 0) {
    throw new Error(
      `layout contract failed for ${layout.kind}: ${failed.map(item => `${item.name} (${item.detail ?? ''})`).join('; ')}`,
    )
  }
}

/** Two harness stores must never share a root or a database file. */
export function storesAreSeparate(a: LayoutLike, b: LayoutLike): boolean {
  if (a.userRoot() === b.userRoot() || a.dbPath() === b.dbPath()) return false
  return !inside(a.userRoot(), b.userRoot()) && !inside(b.userRoot(), a.userRoot())
}
