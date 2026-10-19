import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  createIsolation,
  IsolationViolation,
  LockBusyError,
  type InstanceIdentity,
} from '@llm-memory/core/isolation/index'

const roots: string[] = []

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'llm-iso-'))
  roots.push(dir)
  return dir
}

function identity(storeId = 'store-1', harness: InstanceIdentity['harness'] = 'kilo'): InstanceIdentity {
  return { harness, instanceId: 'inst-1', storeId }
}

afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('IsolationContract', () => {
  it('owns only paths inside storeRoot', () => {
    const root = tempRoot()
    const iso = createIsolation({ identity: identity(), storeRoot: root })
    expect(iso.owns(join(root, 'pages'))).toBe(true)
    expect(iso.owns(join(root, '..', 'other'))).toBe(false)
    expect(iso.claim.dbPath.startsWith(root)).toBe(true)
    expect(iso.claim.lockDir.startsWith(root)).toBe(true)
  })

  it('rejects a storeRoot inside a foreign root', () => {
    const root = tempRoot()
    const iso = createIsolation({
      identity: identity(),
      storeRoot: root,
      forbiddenRoots: [join(root, '..')],
    })
    expect(() => iso.assertNoForeignPaths()).toThrow(IsolationViolation)
  })

  it('accepts a clean claim', () => {
    const root = tempRoot()
    const iso = createIsolation({
      identity: identity(),
      storeRoot: root,
      forbiddenRoots: [join(root, '..', 'x', 'kilo')],
    })
    expect(() => iso.assertNoForeignPaths()).not.toThrow()
  })

  it('rejects a foreign root nested inside storeRoot', () => {
    const root = tempRoot()
    const iso = createIsolation({
      identity: identity(),
      storeRoot: root,
      forbiddenRoots: [join(root, 'pages')],
    })
    expect(() => iso.assertNoForeignPaths()).toThrow(/foreign root lives inside storeRoot/)
  })

  it('locks are namespaced by storeId and mutually exclusive', () => {
    const root = tempRoot()
    const a = createIsolation({ identity: identity('store-a'), storeRoot: root })
    const b = createIsolation({ identity: identity('store-b'), storeRoot: root })
    const lockA = a.lock('migrate')
    expect(lockA.path.startsWith(root)).toBe(true)
    expect(lockA.path.includes('store-a')).toBe(true)
    expect(existsSync(lockA.path)).toBe(true)
    expect(() => a.lock('migrate')).toThrow(LockBusyError)
    const lockB = b.lock('migrate')
    expect(lockB.path.includes('store-b')).toBe(true)
    lockA.release()
    expect(existsSync(lockA.path)).toBe(false)
    a.lock('migrate').release()
    lockB.release()
  })

  it('disables the port lease when the harness has no UI', async () => {
    const root = tempRoot()
    const dsh = createIsolation({ identity: identity('s', 'dsh'), storeRoot: root })
    const lease = await dsh.portLease()
    expect(lease.port).toBeNull()
    expect(lease.disabledReason).toMatch(/no web UI/)
  })

  it('disables the port lease gracefully when the port is busy', async () => {
    const root = tempRoot()
    const blocker = await new Promise<ReturnType<typeof createServer> | null>(resolve => {
      const server = createServer()
      server.once('error', () => resolve(null))
      server.listen({ host: '127.0.0.1', port: 8787, exclusive: true }, () => resolve(server))
    })
    // The environment already holds 8787: nothing to simulate, skip the assertion.
    if (!blocker) return
    try {
      const kilo = createIsolation({ identity: identity('s', 'kilo'), storeRoot: root })
      const lease = await kilo.portLease()
      expect(lease.port).toBeNull()
      expect(lease.disabledReason).toMatch(/8787/)
    } finally {
      await new Promise<void>(resolve => blocker.close(() => resolve()))
    }
  })
})
