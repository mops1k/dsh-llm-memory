import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  assertLocalPath,
  sanitizeProjectKey,
  type LayoutKind,
  type LayoutOptions,
  type LayoutPort,
  type LayoutScope,
} from './port.js'

interface Spec {
  kind: LayoutKind
  userRoot(home: string): string
  projectRoot(cwd: string): string
  dbPath(userRoot: string): string
  projectKey(cwd: string): string
}

class Layout implements LayoutPort {
  readonly kind: LayoutKind
  private readonly spec: Spec
  private readonly home: string
  private readonly cwd: string

  constructor(spec: Spec, home: string, cwd: string) {
    this.spec = spec
    this.kind = spec.kind
    this.home = home
    this.cwd = cwd
  }

  userRoot(): string {
    return this.spec.userRoot(this.home)
  }

  projectRoot(_projectKey: string): string {
    return this.spec.projectRoot(this.cwd)
  }

  dbPath(): string {
    return this.spec.dbPath(this.userRoot())
  }

  pagesDir(scope: LayoutScope, projectKey?: string): string {
    const root = scope === 'project' && projectKey ? this.projectRoot(projectKey) : this.userRoot()
    return join(root, 'pages')
  }

  projectKey(cwd: string): string {
    return this.spec.projectKey(cwd)
  }

  assertLocalStore(): void {
    assertLocalPath(this.userRoot())
    assertLocalPath(this.dbPath())
    assertLocalPath(this.projectRoot(''))
  }
}

function lastSegment(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? 'no-cwd'
}

export function createKiloLayout(options?: LayoutOptions): LayoutPort {
  const spec: Spec = {
    kind: 'kilo',
    userRoot: home => join(home, '.config', 'kilo', 'memory'),
    projectRoot: cwd => join(cwd, '.kilo', 'memory'),
    dbPath: userRoot => join(userRoot, 'db', 'memory.db'),
    projectKey: cwd => sanitizeProjectKey(lastSegment(cwd)),
  }
  return new Layout(spec, options?.home ?? homedir(), options?.cwd ?? process.cwd())
}

export function createDshLayout(options?: LayoutOptions): LayoutPort {
  const spec: Spec = {
    kind: 'dsh',
    userRoot: home => join(home, '.dsh', 'llm-memory'),
    projectRoot: cwd => join(cwd, '.dsh', 'llm-memory'),
    dbPath: userRoot => join(userRoot, '_db', 'memory.db'),
    projectKey: cwd => sanitizeProjectKey(lastSegment(cwd)),
  }
  return new Layout(spec, options?.home ?? homedir(), options?.cwd ?? process.cwd())
}

export function createOpenCodeLayout(options?: LayoutOptions): LayoutPort {
  const spec: Spec = {
    kind: 'opencode',
    userRoot: home => join(home, '.config', 'opencode', 'memory'),
    projectRoot: cwd => join(cwd, '.opencode', 'memory'),
    dbPath: userRoot => join(userRoot, 'db', 'memory.db'),
    projectKey: cwd => sanitizeProjectKey(lastSegment(cwd)),
  }
  return new Layout(spec, options?.home ?? homedir(), options?.cwd ?? process.cwd())
}

export function createMcpLayout(options?: LayoutOptions): LayoutPort {
  const clientId = options?.clientId
  if (!clientId) throw new Error('McpLayout requires clientId (one MCP client = one store)')
  const storeRoot = join(options?.home ?? homedir(), '.llm-memory', 'mcp', sanitizeProjectKey(clientId))
  const spec: Spec = {
    kind: 'mcp',
    userRoot: () => storeRoot,
    projectRoot: cwd => join(storeRoot, 'projects', sanitizeProjectKey(lastSegment(cwd))),
    dbPath: () => join(storeRoot, '_db', 'memory.db'),
    projectKey: cwd => sanitizeProjectKey(lastSegment(cwd)),
  }
  return new Layout(spec, options?.home ?? homedir(), options?.cwd ?? process.cwd())
}

export function createLayout(kind: LayoutKind, options?: LayoutOptions): LayoutPort {
  switch (kind) {
    case 'kilo':
      return createKiloLayout(options)
    case 'dsh':
      return createDshLayout(options)
    case 'opencode':
      return createOpenCodeLayout(options)
    case 'mcp':
      return createMcpLayout(options)
  }
}
