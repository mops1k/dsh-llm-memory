/**
 * Backup screen contract (implementation lands on stage 4). The shared UI
 * renders from these shapes; hosts provide the operations.
 */
export const RESTORE_CONFIRMATION = 'RESTORE'
export const DELETE_CONFIRMATION = 'DELETE'

export interface BackupSummary {
  name: string
  createdAt: string
  sizeBytes: number
  entries?: number
  includesVectors: boolean
  verified?: boolean
}

export interface BackupVerifyResult {
  ok: boolean
  issues?: string[]
}

export interface BackupScreenContract {
  list(): Promise<BackupSummary[]>
  create(scope: 'full' | 'user' | 'project'): Promise<BackupSummary>
  verify(name: string): Promise<BackupVerifyResult>
  restore(name: string, confirmation: string): Promise<void>
  delete(name: string, confirmation: string): Promise<void>
}

export class ConfirmationError extends Error {
  constructor(expected: string) {
    super(`confirmation required: type ${expected}`)
    this.name = 'ConfirmationError'
  }
}

/** Restore/delete are user-only: the typed word is the guard (ADR-005). */
export function assertConfirmation(expected: typeof RESTORE_CONFIRMATION | typeof DELETE_CONFIRMATION, provided: string): void {
  if (provided !== expected) throw new ConfirmationError(expected)
}
