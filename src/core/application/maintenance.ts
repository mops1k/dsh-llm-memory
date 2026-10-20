/**
 * Maintenance pipeline ported from kilo-memory (consolidation, reinforcement,
 * crystallization, self-heal). Pure functions: they return new entries and
 * never touch storage — the adapter decides what to persist.
 */
import type { MemoryEntry } from '../domain/types.js'

export interface MaintenanceConfig {
  confidenceMin: number
  confidenceBoostAmount: number
  promoteConfidence: number
  promoteHits: number
  selfHealEnabled: boolean
  selfHealStaleDays: number
  selfHealMaxAutoFixes: number
  crystallizationEnabled: boolean
}

export const DEFAULT_MAINTENANCE: MaintenanceConfig = {
  confidenceMin: 0.3,
  confidenceBoostAmount: 0.05,
  promoteConfidence: 0.7,
  promoteHits: 5,
  selfHealEnabled: true,
  selfHealStaleDays: 180,
  selfHealMaxAutoFixes: 10,
  crystallizationEnabled: true,
}

const DAY_MS = 24 * 60 * 60 * 1000

function promote(entry: MemoryEntry, config: MaintenanceConfig): MemoryEntry['consolidation'] {
  const level = entry.consolidation
  if (level === 'procedural') return level
  if ((entry.confidence ?? 0.5) < config.promoteConfidence) return level
  if ((entry.accessCount ?? 0) < config.promoteHits) return level
  if (level === 'raw' || level === 'episodic' || level === undefined) return 'semantic'
  if (level === 'semantic' && (entry.accessCount ?? 0) >= config.promoteHits * 2) return 'procedural'
  return level
}

/**
 * Reinforce after a read: bump the counter, refresh `lastAccess`, add a small
 * confidence boost and promote the consolidation level when thresholds allow.
 */
export function reinforce(
  entry: MemoryEntry,
  config: MaintenanceConfig = DEFAULT_MAINTENANCE,
  now = new Date().toISOString(),
): MemoryEntry {
  const accessCount = (entry.accessCount ?? 0) + 1
  const confidence =
    entry.status === 'active' ? Math.min(1, (entry.confidence ?? 0.5) + config.confidenceBoostAmount) : entry.confidence
  const promoted = entry.status === 'active' ? promote({ ...entry, accessCount, confidence }, config) : entry.consolidation
  return {
    ...entry,
    accessCount,
    lastAccess: now,
    ...(confidence !== undefined ? { confidence } : {}),
    ...(promoted !== entry.consolidation && promoted !== undefined ? { consolidation: promoted } : {}),
  }
}

export interface ConsolidateResult {
  items: MemoryEntry[]
  changed: MemoryEntry[]
}

/** Promote consolidation levels across active entries (session compacting). */
export function consolidate(
  entries: readonly MemoryEntry[],
  config: MaintenanceConfig = DEFAULT_MAINTENANCE,
  now = new Date().toISOString(),
): ConsolidateResult {
  const changed: MemoryEntry[] = []
  const items = entries.map(entry => {
    if (entry.status !== 'active') return entry
    const consolidation = promote(entry, config)
    if (consolidation === entry.consolidation) return entry
    const next: MemoryEntry = { ...entry, updatedAt: now, ...(consolidation ? { consolidation } : {}) }
    changed.push(next)
    return next
  })
  return { items, changed }
}

export interface CrystallizeResult {
  /** Markdown digest ready to be written under `raw/`. */
  markdown: string
  items: MemoryEntry[]
  disabled: boolean
}

/** Summary of significant active entries; sources are never deleted or changed. */
export function crystallize(
  entries: readonly MemoryEntry[],
  sessionId: string,
  config: MaintenanceConfig = DEFAULT_MAINTENANCE,
): CrystallizeResult {
  if (!config.crystallizationEnabled) {
    return { markdown: '', items: [], disabled: true }
  }
  const items = entries.filter(
    entry =>
      entry.status === 'active' &&
      (entry.kind === 'rules' || entry.kind === 'preferences' || entry.tier === 'immutable' || entry.importance >= 4),
  )
  const name = (sessionId || 'session').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 120)
  const lines = items.map(entry => {
    const first = entry.text.split(/\r?\n/)[0] ?? ''
    return `- [${entry.scope}/${entry.kind}] ${entry.title} (${entry.id}) — ${first.slice(0, 160)}`
  })
  const markdown = `# Crystallization: ${name}\n\n## Значимые активные записи (сводка)\n${lines.join('\n')}\n`
  return { markdown, items, disabled: false }
}

export interface HealIssue {
  kind: 'broken-reference' | 'stale' | 'duplicate-title'
  entryId: string
  detail: string
  fixed: boolean
}

export interface HealReport {
  mode: 'report' | 'apply-safe'
  enabled: boolean
  issues: HealIssue[]
  items: MemoryEntry[]
}

/**
 * Safe self-heal: broken `supersedes/related/supersededBy` references are
 * cleaned in `apply-safe` (immutable entries are never touched); stale and
 * duplicate-title findings are reported only.
 */
export function selfHeal(
  entries: readonly MemoryEntry[],
  mode: 'report' | 'apply-safe',
  config: MaintenanceConfig = DEFAULT_MAINTENANCE,
  now = Date.now(),
): HealReport {
  if (!config.selfHealEnabled) {
    return { mode, enabled: false, issues: [], items: [...entries] }
  }
  const ids = new Set(entries.map(entry => entry.id))
  const apply = mode === 'apply-safe'
  const issues: HealIssue[] = []
  let fixes = 0
  const titles = new Map<string, string[]>()
  const items = entries.map(entry => {
    for (const id of [...entry.supersedes, ...entry.related, ...entry.supersededBy]) {
      if (ids.has(id)) continue
      const canFix = apply && entry.tier !== 'immutable' && fixes < config.selfHealMaxAutoFixes
      issues.push({ kind: 'broken-reference', entryId: entry.id, detail: id, fixed: canFix })
    }
    const broken = (list: string[]) => list.filter(id => ids.has(id))
    const cleanups = [...entry.supersedes, ...entry.related, ...entry.supersededBy].filter(id => !ids.has(id)).length
    const canClean = apply && entry.tier !== 'immutable' && cleanups > 0 && fixes < config.selfHealMaxAutoFixes
    if (canClean) fixes += 1
    const next: MemoryEntry = canClean
      ? {
          ...entry,
          supersedes: broken(entry.supersedes),
          related: broken(entry.related),
          supersededBy: broken(entry.supersededBy),
        }
      : entry
    const key = entry.title.trim().toLowerCase()
    titles.set(key, [...(titles.get(key) ?? []), entry.id])
    if (
      entry.status === 'active' &&
      now - Date.parse(entry.updatedAt) > config.selfHealStaleDays * DAY_MS
    ) {
      issues.push({ kind: 'stale', entryId: entry.id, detail: entry.updatedAt, fixed: false })
    }
    return next
  })
  for (const [title, entryIds] of titles) {
    if (entryIds.length > 1) issues.push({ kind: 'duplicate-title', entryId: entryIds[0]!, detail: title, fixed: false })
  }
  return { mode, enabled: true, issues, items }
}
