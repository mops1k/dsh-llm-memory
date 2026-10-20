/**
 * DSH UI bridge (ADR-004): the shared headless UI talks to `MemoryEngine`
 * directly and to the shared backup service through this adapter.
 */
import { join } from 'node:path'

import { createBackup, deleteBackup, listBackups, resolveBackupDir, restoreBackup, verifyBackup } from '@llm-memory/core/infrastructure/backup'
import type { MemoryEngine } from '@llm-memory/core/application/engine'
import { DshUiHost, type UiOperation } from '@llm-memory/ui/headless/host'

export interface DshBridgeOptions {
  engine: MemoryEngine
  storageRoot: string
  backupsDir?: string
}

export interface DshBridge {
  request(operation: UiOperation, input?: unknown): Promise<unknown>
  host: DshUiHost
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
    switch (operation) {
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
