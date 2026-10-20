import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { PORT_REGISTRY, type InstanceIdentity, type ResourceClaim } from './identity.js'

export class IsolationViolation extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IsolationViolation'
  }
}

export class LockBusyError extends Error {
  constructor(readonly lockPath: string) {
    super(`lock is busy: ${lockPath}`)
    this.name = 'LockBusyError'
  }
}

export interface LockHandle {
  readonly name: string
  readonly path: string
  release(): void
}

export interface PortLease {
  readonly requested: readonly number[]
  readonly port: number | null
  /** Why the lease is disabled (all candidates busy or none reserved). */
  readonly disabledReason: string | null
  release(): Promise<void>
}

export interface IsolationInput {
  identity: InstanceIdentity
  storeRoot: string
  /** Roots this instance must never touch (declared by its adapter). */
  forbiddenRoots?: readonly string[]
  host?: string
}

export interface IsolationContract {
  readonly identity: InstanceIdentity
  readonly claim: ResourceClaim
  owns(path: string): boolean
  assertNoForeignPaths(): void
  portLease(): Promise<PortLease>
  lock(name: string): LockHandle
}

function normalize(path: string): string {
  const abs = resolve(path)
  return abs.endsWith(sep) ? abs.slice(0, -1) : abs
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function claimFor(storeRoot: string): ResourceClaim {
  const root = normalize(storeRoot)
  return {
    storeRoot: root,
    dbPath: join(root, '_db', 'memory.db'),
    pagesDir: join(root, 'pages'),
    lockDir: join(root, '.locks'),
    tempDir: join(root, '.tmp'),
    logDir: join(root, 'logs'),
    modelDir: join(root, '_models'),
    backupDir: join(root, 'backups'),
  }
}

function tryListen(host: string, port: number): Promise<{ close(): Promise<void> } | null> {
  return new Promise(resolvePromise => {
    const server = createServer()
    server.once('error', () => resolvePromise(null))
    server.listen({ host, port, exclusive: true }, () => {
      resolvePromise({
        close: () =>
          new Promise<void>(done => {
            server.close(() => done())
          }),
      })
    })
  })
}

export function createIsolation(input: IsolationInput): IsolationContract {
  const identity = input.identity
  const claim = claimFor(input.storeRoot)
  const forbidden = (input.forbiddenRoots ?? []).map(normalize)
  const host = input.host ?? '127.0.0.1'

  const contract: IsolationContract = {
    identity,
    claim,

    owns(path: string): boolean {
      return isInside(claim.storeRoot, normalize(path))
    },

    assertNoForeignPaths(): void {
      for (const root of forbidden) {
        if (root === claim.storeRoot) {
          throw new IsolationViolation(`storeRoot equals a foreign root: ${root}`)
        }
        if (isInside(root, claim.storeRoot)) {
          throw new IsolationViolation(`storeRoot lives inside foreign root: ${root}`)
        }
        if (isInside(claim.storeRoot, root)) {
          throw new IsolationViolation(`foreign root lives inside storeRoot: ${root}`)
        }
        for (const [name, path] of Object.entries(claim)) {
          if (name === 'storeRoot') continue
          if (isInside(root, path) || isInside(path, root)) {
            throw new IsolationViolation(`${name} overlaps a foreign root: ${root}`)
          }
        }
      }
      for (const [name, path] of Object.entries(claim)) {
        if (name === 'storeRoot') continue
        if (!isInside(claim.storeRoot, path)) {
          throw new IsolationViolation(`${name} escapes storeRoot: ${path}`)
        }
      }
    },

    async portLease(): Promise<PortLease> {
      const requested = PORT_REGISTRY[identity.harness]
      if (requested.length === 0) {
        return { requested, port: null, disabledReason: `${identity.harness} has no web UI`, release: async () => {} }
      }
      for (const port of requested) {
        const bound = await tryListen(host, port)
        if (bound) {
          return {
            requested,
            port,
            disabledReason: null,
            release: () => bound.close(),
          }
        }
      }
      return {
        requested,
        port: null,
        disabledReason: `all reserved ports are busy: ${requested.join(', ')}`,
        release: async () => {},
      }
    },

    lock(name: string): LockHandle {
      const safe = name.replace(/[^\w.-]+/g, '_')
      const path = join(claim.lockDir, `${identity.storeId}.${safe}.lock`)
      mkdirSync(dirname(path), { recursive: true })
      if (existsSync(path)) {
        const owner = readFileSync(path, 'utf8').trim()
        throw new LockBusyError(`${path} (owner: ${owner || 'unknown'})`)
      }
      const fd = openSync(path, 'wx')
      try {
        writeSync(fd, `${identity.harness}/${identity.instanceId} ${new Date().toISOString()}`)
      } finally {
        closeSync(fd)
      }
      let released = false
      return {
        name,
        path,
        release: () => {
          if (released) return
          released = true
          rmSync(path, { force: true })
        },
      }
    },
  }
  return contract
}
