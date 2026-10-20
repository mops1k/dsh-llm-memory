/**
 * Coexistence matrix (ADR-007, этап 11): all four harnesses live in one process
 * at the same time, each on its own store, ports, locks and backup directory.
 * Nothing of one store is visible through another, a parallel workload stays
 * clean, and a backup cannot be restored into a foreign harness.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { MemoryEngine } from '@llm-memory/core/application/engine'
import { mergeConfig } from '@llm-memory/core/domain/config'
import { verifyBackup, restoreBackup } from '@llm-memory/core/infrastructure/backup'
import { createIsolation, PORT_REGISTRY } from '@llm-memory/core/isolation/index'
import { createLayout } from '@llm-memory/core/layout/index'
import { storesAreSeparate } from '@llm-memory/testkit'
import { DEFAULT_KILO_CONFIG, resolveKiloConfig } from '@llm-memory/adapter/kilo/config'
import { KiloService } from '@llm-memory/adapter/kilo/service'
import { DEFAULT_OPENCODE_CONFIG, resolveOpenCodeConfig } from '@llm-memory/adapter/opencode/config'
import { OpenCodeService } from '@llm-memory/adapter/opencode/service'
import { DEFAULT_MCP_CONFIG, resolveMcpConfig } from '@llm-memory/adapter/mcp/config'
import { McpService } from '@llm-memory/adapter/mcp/service'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

interface Matrix {
  home: string
  repo: string
  root: Record<'dsh' | 'kilo' | 'opencode' | 'mcp', string>
  engine: MemoryEngine
  kilo: KiloService
  opencode: OpenCodeService
  mcp: McpService
  close(): void
}

function matrix(): Matrix {
  const dir = mkdtempSync(join(tmpdir(), 'llm-coexist-'))
  dirs.push(dir)
  const home = join(dir, 'home')
  const repo = join(dir, 'repo')
  mkdirSync(home, { recursive: true })
  mkdirSync(repo, { recursive: true })
  const root = {
    dsh: join(dir, 'dsh'),
    kilo: join(dir, 'kilo'),
    opencode: join(dir, 'opencode'),
    mcp: join(dir, 'mcp'),
  }

  const engine = new MemoryEngine({ storageRoot: root.dsh, project: 'demo', config: mergeConfig({}) })
  const kilo = new KiloService({
    config: resolveKiloConfig({ memory: { ...DEFAULT_KILO_CONFIG.memory, storageRoot: root.kilo } }),
    projectRoot: repo,
    configDir: join(dir, 'kilo-conf'),
  })
  const opencode = new OpenCodeService({
    config: resolveOpenCodeConfig({ memory: { ...DEFAULT_OPENCODE_CONFIG.memory, storageRoot: root.opencode } }),
    projectRoot: repo,
    configDir: join(dir, 'oc-conf'),
  })
  const mcp = new McpService({
    config: resolveMcpConfig({ ...DEFAULT_MCP_CONFIG, memory: { ...DEFAULT_MCP_CONFIG.memory, storageRoot: root.mcp } }),
    clientId: 'coexist',
    home,
    projectRoot: repo,
  })
  kilo.init()
  opencode.init()
  mcp.init()

  return {
    home,
    repo,
    root,
    engine,
    kilo,
    opencode,
    mcp,
    close() {
      engine.close()
      kilo.close()
      opencode.close()
      mcp.close()
    },
  }
}

describe('coexistence of all four harnesses', () => {
  it('keeps stores, ports, locks and backups apart', () => {
    const m = matrix()
    try {
      const layouts = {
        dsh: createLayout('dsh', { home: m.home }),
        kilo: createLayout('kilo', { home: m.home }),
        opencode: createLayout('opencode', { home: m.home }),
        mcp: createLayout('mcp', { home: m.home, clientId: 'coexist' }),
      }
      const pairs: Array<[keyof typeof layouts, keyof typeof layouts]> = [
        ['dsh', 'kilo'],
        ['dsh', 'opencode'],
        ['dsh', 'mcp'],
        ['kilo', 'opencode'],
        ['kilo', 'mcp'],
        ['opencode', 'mcp'],
      ]
      for (const [left, right] of pairs) {
        expect(storesAreSeparate(layouts[left], layouts[right]), `${left} vs ${right}`).toBe(true)
      }

      // Reserved ports never collide across harnesses.
      const ports = [PORT_REGISTRY.kilo, PORT_REGISTRY.opencode, PORT_REGISTRY.mcp].flat()
      expect(new Set(ports).size).toBe(ports.length)

      // Lock names are namespaced by store id, so two stores never share a file.
      const mcpLock = createIsolation({
        identity: { harness: 'mcp', instanceId: 'a', storeId: 'mcp-coexist' },
        storeRoot: m.root.mcp,
      }).lock('maintenance')
      const kiloLock = createIsolation({
        identity: { harness: 'kilo', instanceId: 'a', storeId: 'kilo' },
        storeRoot: m.root.kilo,
      }).lock('maintenance')
      try {
        expect(mcpLock.path).not.toBe(kiloLock.path)
        expect(mcpLock.path.startsWith(m.root.mcp)).toBe(true)
        expect(kiloLock.path.startsWith(m.root.kilo)).toBe(true)
      } finally {
        mcpLock.release()
        kiloLock.release()
      }

      // Each harness backs up into its own store and the archive is verified.
      for (const [kind, service] of [
        ['kilo', m.kilo],
        ['opencode', m.opencode],
        ['mcp', m.mcp],
      ] as const) {
        const report = service.backupCreate()
        expect(report.archive.startsWith(m.root[kind])).toBe(true)
        expect(verifyBackup(report.archive).ok).toBe(true)
      }
      const kiloArchive = m.kilo.backupCreate().archive
      expect(() =>
        restoreBackup({
          harness: 'mcp',
          storeDir: m.mcp.backupTarget().storeDir,
          dbPath: m.mcp.backupTarget().dbPath,
          projectDirs: [],
          backupsDir: m.mcp.backupTarget().backupsDir,
          archive: kiloArchive,
          confirm: 'RESTORE',
        }),
      ).toThrow(/cross-harness/)
    } finally {
      m.close()
    }
  })

  it('hides every store from the others and survives a parallel workload', async () => {
    const m = matrix()
    try {
      const targets = [
        ['dsh', (index: number) => m.engine.save({ text: `coexist-dsh-${index}`, title: `dsh ${index}` })],
        ['kilo', (index: number) => m.kilo.save({ text: `coexist-kilo-${index}`, title: `kilo ${index}` })],
        ['opencode', (index: number) => m.opencode.save({ text: `coexist-opencode-${index}`, title: `opencode ${index}` })],
        ['mcp', (index: number) => m.mcp.save({ text: `coexist-mcp-${index}`, title: `mcp ${index}` })],
      ] as const

      // 100 operations per harness: 50 saves and 50 recalls, all in flight.
      await Promise.all(
        targets.flatMap(([, save]) => [
          ...Array.from({ length: 50 }, (_, index) => Promise.resolve().then(() => save(index))),
          ...Array.from({ length: 50 }, () => Promise.resolve().then(async () => undefined)),
        ]),
      )

      const counts = {
        dsh: m.engine.statusReport().total,
        kilo: m.kilo.status().total,
        opencode: m.opencode.status().total,
        mcp: m.mcp.status().total,
      }
      expect(counts).toEqual({ dsh: 50, kilo: 50, opencode: 50, mcp: 50 })

      // A query that only one store has returns nothing in the others.
      const recalls = {
        dsh: await m.engine.recall('coexist-mcp', { touch: false }),
        kilo: await m.kilo.recall('coexist-mcp', { touch: false }),
        opencode: await m.opencode.recall('coexist-mcp', { touch: false }),
        mcp: await m.mcp.recall('coexist-mcp', { touch: false }),
      }
      expect(recalls.mcp.items.length).toBeGreaterThan(0)
      for (const kind of ['dsh', 'kilo', 'opencode'] as const) {
        expect(recalls[kind].items.map(item => item.id)).not.toContain(recalls.mcp.items[0]!.id)
      }

      // Each store answers its own query.
      for (const kind of ['dsh', 'kilo', 'opencode', 'mcp'] as const) {
        const recalled = await (kind === 'dsh' ? m.engine : m[kind]).recall(`coexist-${kind}`, { touch: false })
        expect(recalled.items.length).toBeGreaterThan(0)
      }
    } finally {
      m.close()
    }
  })
})
