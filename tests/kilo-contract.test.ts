import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { DEFAULT_KILO_CONFIG, resolveKiloConfig } from '@llm-memory/adapter/kilo/config'
import { KiloService } from '@llm-memory/adapter/kilo/service'
import { startKiloWebServer } from '@llm-memory/adapter/kilo/web-server'
import { createIsolation, IsolationViolation } from '@llm-memory/core/isolation/index'
import { createKiloLayout, assertLocalPath, StorePathError } from '@llm-memory/core/layout/index'
import { assertLayoutContract, storesAreSeparate } from '../src/testkit/index'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function base(): { home: string; repo: string } {
  const dir = mkdtempSync(join(tmpdir(), 'llm-kilo-contract-'))
  dirs.push(dir)
  return { home: join(dir, 'home'), repo: join(dir, 'repo') }
}

describe('kilo adapter contract', () => {
  it('its layout satisfies the shared contract', () => {
    const { home, repo } = base()
    assertLayoutContract(createKiloLayout({ home, cwd: repo }))
  })

  it('service store equals the layout root when config has no override', () => {
    const { home, repo } = base()
    const layout = createKiloLayout({ home, cwd: repo })
    const config = resolveKiloConfig({ memory: { ...DEFAULT_KILO_CONFIG.memory, storageRoot: '' } })
    const service = new KiloService({ config, projectRoot: repo, layout })
    expect(service.store.root).toBe(layout.userRoot())
    service.close()
  })

  it('never touches a foreign root and rejects UNC stores', () => {
    const { home, repo } = base()
    const layout = createKiloLayout({ home, cwd: repo })
    const service = new KiloService({ config: resolveKiloConfig({}), projectRoot: repo, layout })
    const iso = createIsolation({
      identity: { harness: 'kilo', instanceId: 'kilo-test', storeId: 'kilo' },
      storeRoot: service.store.root,
      forbiddenRoots: [join(home, '.dsh', 'llm-memory')],
    })
    expect(() => iso.assertNoForeignPaths()).not.toThrow()
    const overlap = createIsolation({
      identity: { harness: 'kilo', instanceId: 'kilo-test', storeId: 'kilo' },
      storeRoot: service.store.root,
      forbiddenRoots: [join(service.store.root, 'pages')],
    })
    expect(() => overlap.assertNoForeignPaths()).toThrow(IsolationViolation)
    expect(() => assertLocalPath('\\\\wsl.localhost\\archlinux\\home\\u')).toThrow(StorePathError)
    service.close()
  })

  it('Kilo and DSH stores are separate', () => {
    const { home, repo } = base()
    const kilo = createKiloLayout({ home, cwd: repo })
    const dshLike = { ...kilo, kind: 'dsh', userRoot: () => join(home, '.dsh', 'llm-memory'), dbPath: () => join(home, '.dsh', 'llm-memory', '_db', 'memory.db') }
    expect(storesAreSeparate(kilo, dshLike)).toBe(true)
  })

  it('exposes the backup integration point as an empty list', async () => {
    const { home, repo } = base()
    const config = resolveKiloConfig({ web: { ...DEFAULT_KILO_CONFIG.web, enabled: true, port: 0 } })
    const service = new KiloService({ config, projectRoot: repo, layout: createKiloLayout({ home, cwd: repo }) })
    service.init()
    const handle = await startKiloWebServer({ service, config, port: 0 })
    try {
      const backups = await fetch(`${handle.url}api/backup`).then(response => response.json())
      expect(backups).toEqual([])
    } finally {
      await handle.close()
      service.close()
    }
  })
})
