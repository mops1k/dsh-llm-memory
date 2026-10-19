/**
 * `llm_memory_backup` (ADR-003/005): create/list/verify over the shared backup
 * service. Restore and delete stay user-only (CLI or UI confirmation).
 */
import { createBackup, listBackups, verifyBackup, type BackupTarget } from '@llm-memory/core/infrastructure/backup'

export interface BackupToolPaths extends BackupTarget {
  backupsDir: string
}

export interface BackupToolDefinition {
  description: string
  args: { operation: { type: 'string'; description: string; enum: readonly string[] } }
  execute: (args: Record<string, unknown>) => Promise<string>
}

export function llmMemoryBackupTool(paths: () => BackupToolPaths): BackupToolDefinition {
  return {
    description: 'Create, list or verify memory backups. Restore/delete require explicit user confirmation in CLI or UI.',
    args: {
      operation: {
        type: 'string',
        description: 'create | list | verify',
        enum: ['create', 'list', 'verify'],
      },
    },
    execute: async (args: Record<string, unknown>) => {
      const base = paths()
      const operation = String(args['operation'] ?? 'list')
      if (operation === 'create') {
        const report = createBackup(base)
        return JSON.stringify({ ok: true, archive: report.archive, bytes: report.bytes, files: report.manifest.entries.length })
      }
      if (operation === 'verify') {
        const report = verifyBackup(String(args['archive'] ?? ''))
        return JSON.stringify({ ok: report.ok, errors: report.errors })
      }
      if (operation === 'list') return JSON.stringify({ ok: true, backups: listBackups(base.backupsDir) })
      return JSON.stringify({ ok: false, error: `unsupported operation: ${operation}; restore/delete are user-only` })
    },
  }
}
