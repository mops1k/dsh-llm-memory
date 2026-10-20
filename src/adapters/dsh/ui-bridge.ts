/**
 * DSH UI bridge (ADR-004): the shared headless UI talks to `MemoryEngine`
 * directly and to the shared backup service through this adapter.
 */
import { join } from 'node:path'

import { createBackup, deleteBackup, listBackups, resolveBackupDir, restoreBackup, verifyBackup } from '../../core/infrastructure/backup.js'
import type { MemoryEngine } from '../../core/application/engine.js'
import { panelSnapshot, settingsSnapshot } from '../../core/domain/ui-contract.js'
import type { MemoryFilter, MemorySort, MemoryStatus } from '../../core/domain/types.js'
import { DshUiHost, type UiOperation } from '../../ui/headless/host.js'

export interface DshBridgeOptions {
  engine: MemoryEngine
  storageRoot: string
  backupsDir?: string
}

export interface DshBridge {
  request(operation: UiOperation, input?: unknown): Promise<unknown>
  host: DshUiHost
}

/**
 * The shared panel speaks the UI schema vocabulary (`items.list`,
 * `lint.report`, `action.*`), while this bridge started with the older short
 * names. The aliases keep both callers working against one engine.
 */
const OPERATION_ALIASES: Record<string, string> = {
  'items.list': 'items.list',
  'items.get': 'items.get',
  'items.save': 'save',
  'items.update': 'items.update',
  'items.forget': 'forget',
  'items.delete': 'delete',
  'lint.report': 'lint',
  'heal.report': 'heal',
  'heal.apply': 'heal',
  'vectors.health': 'health',
  'vectors.map': 'vectors.map',
  'vectors.rebuild': 'vectors.rebuild',
  'settings.snapshot': 'settings.snapshot',
  'settings.save': 'settings.save',
  'model.status': 'model.status',
  'model.download': 'model.download',
  'model.remove': 'model.remove',
  'action.lint.run': 'lint',
  'action.heal.report': 'heal',
  'action.heal.apply': 'heal',
  'action.vectors.rebuild': 'vectors.rebuild',
  'action.vectors.repair': 'vectors.repair',
  'action.vectors.embed': 'vectors.embed',
  'action.vectors.health': 'health',
  'action.model.status': 'model.status',
  'action.model.download': 'model.download',
  'action.model.remove': 'model.remove',
  'action.backup.list': 'backup.list',
  'action.backup.create': 'backup.create',
  'action.backup.verify': 'backup.verify',
  'action.backup.restore': 'backup.restore',
  'action.backup.delete': 'backup.delete',
}

function asInt(value: unknown, fallback: number, min: number, max: number): number {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, Math.round(number)))
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function listFilter(payload: Record<string, unknown>): MemoryFilter {
  const filter: MemoryFilter = {
    status: 'all',
    limit: asInt(payload['limit'], 50, 1, 5000),
    offset: asInt(payload['offset'], 0, 0, 1_000_000),
    sort: (asString(payload['sort']) as MemorySort | undefined) ?? 'updated',
  }
  for (const key of ['kind', 'scope'] as const) {
    const value = asString(payload[key])
    if (value && value !== 'all') filter[key] = value as never
  }
  const status = asString(payload['status'])
  if (status && status !== 'all') filter.status = status as MemoryStatus
  const project = asString(payload['project'])
  if (project && project !== 'all') filter.project = project
  return filter
}

function backupsDirOf(options: DshBridgeOptions): string {
  return options.backupsDir ?? resolveBackupDir(options.storageRoot, options.engine.config.backupDir)
}

export function createDshBridge(options: DshBridgeOptions): DshBridge {
  const { engine } = options
  const target = () => ({
    harness: 'dsh' as const,
    storeDir: options.storageRoot,
    dbPath: join(options.storageRoot, '_db', 'memory.db'),
    backupsDir: backupsDirOf(options),
  })

  const request = async (operation: UiOperation, input?: unknown): Promise<unknown> => {
    const payload = (input ?? {}) as Record<string, unknown>
    const canonical = OPERATION_ALIASES[operation] ?? operation
    switch (canonical) {
      case 'ui.snapshot':
        return panelSnapshot('en')
      case 'settings.snapshot':
        return { snapshot: settingsSnapshot(engine.config, 'en'), unsupported: [] }
      case 'settings.save':
        // Settings are native DSH forms; the web page only mirrors them.
        return { applied: [], unsupported: Object.keys(payload) }
      case 'items.list': {
        const filter = listFilter(payload)
        const query = asString(payload['query'])?.toLowerCase()
        const result = engine.list(filter)
        const items =
          query === undefined
            ? result.items
            : result.items.filter(entry =>
                `${entry.title}\n${entry.text}\n${entry.tags.join(' ')}\n${entry.keywords}`.toLowerCase().includes(query),
              )
        return {
          items,
          total: query === undefined ? result.total : items.length,
          limit: filter.limit,
          offset: filter.offset,
          query: query ?? '',
        }
      }
      case 'items.get':
        return engine.get(String(payload['id'] ?? ''))
      case 'items.update': {
        const id = String(payload['id'] ?? '')
        return engine.update(id, payload as Parameters<MemoryEngine['update']>[1])
      }
      case 'model.status':
        return engine.modelStatus()
      case 'model.download':
        return engine.downloadModel()
      case 'model.remove':
        return engine.removeModel()
      case 'vectors.map':
        return { map: engine.vectorsMap({ refresh: payload['refresh'] === '1' || payload['refresh'] === true }) }
      case 'vectors.rebuild':
        engine.rebuildVectors()
        return { vectors: engine.vectorStatus() }
      case 'vectors.repair':
        return { vectors: engine.repairVectors() }
      case 'vectors.embed':
        await engine.embedPending()
        return { vectors: engine.vectorStatus() }
      case 'status':
        return engine.statusReport()
      case 'list':
        return engine.list({ status: 'all' }).items
      case 'get':
        return engine.get(String(payload['id'] ?? ''))
      case 'recall':
        return engine.recall(String(payload['query'] ?? ''), { format: 'markdown' })
      case 'save':
        return engine.save(payload as unknown as Parameters<MemoryEngine['save']>[0])
      case 'forget':
        return engine.forget(String(payload['id'] ?? ''))
      case 'delete':
        return engine.delete(String(payload['id'] ?? ''))
      case 'heal':
        return engine.heal()
      case 'lint': {
        const report = engine.lintReport()
        const issues = [
          ...report.brokenLinks.map(link => ({
            entryId: link.id,
            message: `broken ${link.field} link: ${link.missingId} ("${link.title}")`,
            severity: 'warning' as const,
          })),
          ...report.overlaps.map(pair => ({
            entryId: pair.a,
            message: `overlap with "${pair.bTitle}" (${Math.round(pair.score * 100)}%)`,
            severity: 'info' as const,
          })),
          ...report.stale.map(item => ({
            entryId: item.id,
            message: `stale since ${item.updatedAt} ("${item.title}")`,
            severity: 'info' as const,
          })),
          ...(report.duplicates ?? []).map(item => ({
            entryId: item.id,
            message: `near-duplicate of "${item.duplicateTitle}"`,
            severity: 'info' as const,
          })),
        ]
        return { ...report, issues }
      }
      case 'graph':
        return engine.graph()
      case 'health':
        return { vectors: engine.vectorHealth() }
      case 'settings.get':
        return engine.config
      case 'settings.set':
        return engine.config
      case 'backup.list':
        return listBackups(backupsDirOf(options), payload['passphrase'] as string | undefined)
      case 'backup.create': {
        // Opening the store materialises the SQLite file the snapshot copies.
        engine.list({ status: 'all', limit: 1 })
        const report = createBackup(target())
        return { name: report.archive.split(/[\\/]/).pop() ?? report.archive, createdAt: report.manifest.createdAt, sizeBytes: report.bytes, includesVectors: false, verified: true }
      }
      case 'backup.verify':
        return verifyBackup(String(payload['archive'] ?? payload['name'] ?? ''))
      case 'backup.restore': {
        const report = restoreBackup({ ...target(), archive: String(payload['archive'] ?? payload['name'] ?? ''), confirm: String(payload['confirm'] ?? '') })
        return { restored: report.restored, counts: report.counts }
      }
      case 'backup.delete':
        return { deleted: deleteBackup(String(payload['archive'] ?? payload['name'] ?? ''), String(payload['confirm'] ?? ''), backupsDirOf(options)) }
      default:
        throw new Error(`unsupported operation: ${operation}`)
    }
  }

  const host = new DshUiHost({ bridge: (operation: UiOperation, input?: unknown) => request(operation, input) })
  return { request, host }
}
