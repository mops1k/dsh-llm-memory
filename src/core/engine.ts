/**
 * Memory engine: the operation layer on top of {@link MemoryStore}.
 *
 * It owns the resolved configuration and the per-session project key, and
 * implements the lifecycle operations (save / update / forget / delete / recall
 * / status / lint / graph / import) plus the prompt guidance helper. Markdown
 * pages remain the source of truth; the store is the derived FTS5 index.
 *
 * Adapted from the kilo-memory engine, but reduced to the layered model:
 * `scope: 'project'` is keyed by a project slug and `scope: 'user'` is a single
 * cross-project layer.
 */
import { statSync } from 'node:fs'

import { mergeConfig, type MemoryConfig, type RecallScope } from './config.js'
import { appendLog } from './log.js'
import { sanitizeProjectKey } from './paths.js'
import { DEFAULT_RANKING, rankItems, rankRulesBase, significantOverlapPairs } from './ranking.js'
import { MemoryStore, genMemoryId, newMemoryEntry } from './store.js'
import { buildGraph } from './wiki.js'
import {
  buildExternalIdMap,
  remapRelationIds,
  sameImportedEntry,
  type ExternalIdResolution,
} from './import/common.js'
import type {
  MemoryEntry,
  MemoryFilter,
  MemoryGraph,
  MemoryImportance,
  MemoryKind,
  MemoryListResult,
  MemoryScope,
  MemoryStatus,
  MemoryTier,
} from './types.js'
import { clampImportance } from './types.js'

/** Output format of `recall`. */
export type RecallFormat = 'markdown' | 'table' | 'timeline' | 'json'

/** Number of significant common words required for a lint overlap pair. */
const LINT_OVERLAP_MIN_SCORE = 0.45

/** Age in days after which an active entry is reported as stale by lint. */
const LINT_STALE_DAYS = 180

/** Construction options of {@link MemoryEngine}. */
export interface MemoryEngineOptions {
  /** Explicit storage root; defaults to `$DSH_HOME/llm-memory` / `~/.dsh/llm-memory`. */
  storageRoot?: string
  /** Project key for `scope: 'project'` entries (usually the workspace basename). */
  project?: string
  /** Explicit `key -> absolute project root` overrides (highest priority). */
  projectRoots?: Record<string, string>
  /**
   * Fallback resolver for a project key when neither the explicit overrides nor
   * `projects.json` know the root (e.g. a workspace registry lookup).
   */
  resolveProjectRoot?: (key: string) => string | null | undefined
  /** Partial configuration merged over the defaults. */
  config?: Partial<MemoryConfig>
}

/** Input accepted by {@link MemoryEngine.save}. */
export interface SaveInput {
  text: string
  title?: string
  scope?: MemoryScope
  project?: string
  kind?: MemoryKind
  tier?: MemoryTier
  status?: MemoryStatus
  tags?: string[]
  keywords?: string
  importance?: MemoryImportance
  confidence?: number
  /** Ids this entry replaces; those entries become `superseded`. */
  supersedes?: string[]
  related?: string[]
  source?: string
  /** External key used for idempotent imports. */
  extKey?: string
  createdAt?: string
  updatedAt?: string
}

/** Editable fields accepted by {@link MemoryEngine.update}. */
export interface UpdatePatch {
  title?: string
  text?: string
  kind?: MemoryKind
  tier?: MemoryTier
  status?: MemoryStatus
  tags?: string[]
  keywords?: string
  importance?: MemoryImportance
  confidence?: number
  supersedes?: string[]
  supersededBy?: string[]
  related?: string[]
}

/** Result of {@link MemoryEngine.forget}. */
export interface ForgetResult {
  ok: boolean
  message: string
  entry?: MemoryEntry
}

/** Options of {@link MemoryEngine.recall}. */
export interface RecallOptions {
  scope?: MemoryScope | 'all'
  project?: string | 'all'
  kind?: MemoryKind | 'all'
  tier?: MemoryTier | 'all'
  limit?: number
  format?: RecallFormat
}

/** Result of {@link MemoryEngine.recall}. */
export interface RecallResult {
  items: MemoryEntry[]
  text: string
  format: RecallFormat
}

/** Counters returned by {@link MemoryEngine.statusReport}. */
export interface StatusReport {
  root: string
  dbPath: string
  dbSizeBytes: number
  total: number
  active: number
  byStatus: Record<string, number>
  byScope: Record<string, number>
  byKind: Record<string, number>
  byProject: Record<string, number>
}

/** A link pointing at an entry that does not exist. */
export interface LintBrokenLink {
  id: string
  title: string
  field: 'supersedes' | 'related' | 'supersededBy'
  missingId: string
}

/** A pair of active entries with a significant lexical overlap. */
export interface LintOverlap {
  a: string
  b: string
  aTitle: string
  bTitle: string
  common: number
  score: number
}

/** An active entry that has not been updated for a long time. */
export interface LintStale {
  id: string
  title: string
  updatedAt: string
}

/** Result of {@link MemoryEngine.lintReport}. */
export interface LintReport {
  totalCount: number
  activeCount: number
  brokenLinks: LintBrokenLink[]
  overlaps: LintOverlap[]
  /** Number of overlap pairs hidden by `lintMaxPairs`. */
  overlapsHidden: number
  stale: LintStale[]
  staleDays: number
}

/** One entry accepted by {@link MemoryEngine.importEntries}. */
export interface ImportEntry {
  /** Source-unique key used for idempotency (e.g. `kilo:<id>`). */
  extKey: string
  text: string
  title?: string
  scope?: MemoryScope
  project?: string
  kind?: MemoryKind
  tier?: MemoryTier
  status?: MemoryStatus
  tags?: string[]
  keywords?: string
  importance?: MemoryImportance
  confidence?: number
  source?: string
  /** Raw source project root, when the entry came from a foreign store. */
  projectRoot?: string | null
  related?: string[]
  supersedes?: string[]
  supersededBy?: string[]
  createdAt?: string
  updatedAt?: string
}

/** Outcome of {@link MemoryEngine.importEntries}. */
export interface ImportReport {
  source: string
  imported: number
  updated: number
  skipped: number
  /** Relation references dropped because their target was not imported. */
  droppedRelations: number
  ids: string[]
}

/** Result of {@link MemoryEngine.heal}. */
export interface HealReport {
  /** Broken relation references removed from entries. */
  removedLinks: number
  /** Missing reverse links (`supersededBy` / symmetric `related`) added. */
  addedBacklinks: number
  /** Number of entries rebuilt from markdown during reindex. */
  reindexed: number
  /** Broken link count before healing. */
  brokenBefore: number
  /** Broken link count after healing. */
  brokenAfter: number
}

function firstLine(text: string, maxLength = 120): string {
  const line = text.split(/\r?\n/, 1)[0]?.trim() ?? ''
  return line.length > maxLength ? `${line.slice(0, maxLength)}…` : line
}

function statusMarkers(entry: MemoryEntry): string {
  const markers: string[] = []
  if (entry.tier === 'immutable') markers.push('[immutable]')
  else if (entry.tier === 'important') markers.push('[important]')
  if (entry.status !== 'active') markers.push(`[${entry.status}]`)
  return markers.length > 0 ? ` ${markers.join(' ')}` : ''
}

/** Render a single entry as a markdown section (English). */
export function renderMemoryEntry(entry: MemoryEntry): string {
  const lines = [
    `### ${entry.title}${statusMarkers(entry)}`,
    `- id: \`${entry.id}\` · scope: ${entry.scope} · kind: ${entry.kind} · importance: ${entry.importance}/5 · updated: ${entry.updatedAt.slice(0, 10)}`,
    `- tags: ${entry.tags.length > 0 ? entry.tags.join(', ') : '—'}`,
  ]
  if (entry.supersedes.length > 0) lines.push(`- supersedes: ${entry.supersedes.join(', ')}`)
  lines.push('', entry.text)
  return lines.join('\n')
}

/** Render a list of entries in the requested output format. */
export function renderRecall(items: MemoryEntry[], format: RecallFormat = 'markdown'): string {
  const confidenceOf = (entry: MemoryEntry): number => Math.round((entry.confidence ?? 0.5) * 1000) / 1000
  if (format === 'table') {
    const header = ['id', 'scope', 'kind', 'tier', 'importance', 'updated', 'title']
    const rows: string[][] = [header]
    for (const entry of items) {
      rows.push([
        entry.id,
        entry.scope,
        entry.kind,
        entry.tier,
        String(entry.importance),
        entry.updatedAt.slice(0, 10),
        entry.title,
      ])
    }
    const widths = header.map((_, index) => Math.max(...rows.map((row) => (row[index] ?? '').length)))
    const renderRow = (row: string[]): string =>
      `| ${row.map((cell, index) => (cell ?? '').padEnd(widths[index] ?? 0)).join(' | ')} |`
    const separator = `|${widths.map((width) => '-'.repeat(width + 2)).join('|')}|`
    return [renderRow(header), separator, ...rows.slice(1).map(renderRow)].join('\n')
  }
  if (format === 'timeline') {
    return [...items]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .map((entry) => `- ${entry.updatedAt.slice(0, 10)} [${entry.scope}/${entry.kind}] ${entry.title} (${entry.id})`)
      .join('\n')
  }
  if (format === 'json') {
    return JSON.stringify(
      items.map((entry) => ({
        id: entry.id,
        title: entry.title,
        kind: entry.kind,
        scope: entry.scope,
        project: entry.project,
        tier: entry.tier,
        status: entry.status,
        importance: entry.importance,
        confidence: confidenceOf(entry),
        tags: entry.tags,
        supersedes: entry.supersedes,
        supersededBy: entry.supersededBy,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      })),
      null,
      2,
    )
  }
  return items.map(renderMemoryEntry).join('\n\n')
}

/**
 * Memory engine bound to one storage root and one project key.
 *
 * The SQLite connection is opened lazily by {@link MemoryStore} on first use.
 * Call {@link MemoryEngine.close} when the instance is no longer needed.
 */
export class MemoryEngine {
  readonly config: MemoryConfig
  readonly project: string
  private readonly store: MemoryStore
  private readonly externalResolver?: (key: string) => string | null | undefined

  constructor(options: MemoryEngineOptions = {}) {
    this.config = mergeConfig({
      ...(options.config ?? {}),
      ...(options.storageRoot !== undefined ? { storageRoot: options.storageRoot } : {}),
      ...(options.projectRoots !== undefined ? { projectRoots: options.projectRoots } : {}),
    })
    this.project = sanitizeProjectKey(options.project ?? '')
    this.store = new MemoryStore({ storageRoot: this.config.storageRoot })
    if (options.resolveProjectRoot) this.externalResolver = options.resolveProjectRoot
  }

  /**
   * Register (or update) the absolute root of a project so its markdown pages
   * are stored inside the repository at `<root>/.harness/llm-memory`.
   */
  registerProject(key: string, root: string): void {
    const projectKey = sanitizeProjectKey(key)
    const value = (root ?? '').trim()
    if (projectKey.length === 0 || value.length === 0) return
    this.store.setProjectRoot(projectKey, value)
  }

  /** Registered `key -> absolute root` map (from `projects.json`). */
  projectRoots(): Record<string, string> {
    return this.store.projectRoots()
  }

  /**
   * Resolve the absolute root of a project key.
   *
   * Priority: explicit `config.projectRoots` override, then the persisted
   * `projects.json` registry, then the optional external resolver. A root found
   * through the resolver is persisted so later calls stay consistent.
   */
  resolveProjectRoot(key: string): string | null {
    const projectKey = sanitizeProjectKey(key)
    if (projectKey.length === 0) return null
    const configured = this.config.projectRoots[projectKey]
    if (typeof configured === 'string' && configured.trim().length > 0) return configured.trim()
    const stored = this.store.getProjectRoot(projectKey)
    if (stored !== null) return stored
    const external = this.externalResolver?.(projectKey)
    if (typeof external === 'string' && external.trim().length > 0) {
      const value = external.trim()
      this.registerProject(projectKey, value)
      return value
    }
    return null
  }

  /** Persist the resolved root of a project before writing its pages. */
  private ensureProjectRoot(key: string): void {
    const root = this.resolveProjectRoot(key)
    if (root !== null) this.registerProject(key, root)
  }

  /** Resolved storage root of the underlying store. */
  get root(): string {
    return this.store.root
  }

  /** Absolute path of the derived SQLite index. */
  get dbPath(): string {
    return this.store.dbPath
  }

  /**
   * The derived SQLite store backing this engine. Exposed for orchestration
   * code that must hand the store to the importers (a second owner of the same
   * database file would break the single-writer contract).
   */
  getStore(): MemoryStore {
    return this.store
  }

  /** Create a new entry, or update the entry that already owns `extKey`. */
  save(input: SaveInput): MemoryEntry {
    const text = (input.text ?? '').trim()
    if (text.length === 0) throw new Error('Memory text must not be empty')

    const scope: MemoryScope = input.scope ?? 'project'
    const project = scope === 'user' ? '' : sanitizeProjectKey(input.project ?? this.project)
    if (scope === 'project') this.ensureProjectRoot(project)
    const existingExt = input.extKey ? this.store.getByExtKey(input.extKey) : null
    const now = new Date().toISOString()

    const entry = newMemoryEntry({
      id: existingExt?.id ?? genMemoryId(),
      scope,
      project,
      kind: input.kind ?? 'facts',
      tier: input.tier ?? 'normal',
      status: input.status ?? 'active',
      title: input.title ?? '',
      text,
      tags: input.tags ?? [],
      keywords: input.keywords ?? '',
      importance: input.importance ?? 3,
      related: input.related ?? [],
      ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
      ...(input.source !== undefined ? { source: input.source } : {}),
      ...(input.extKey !== undefined ? { extKey: input.extKey } : {}),
      createdAt: input.createdAt ?? existingExt?.createdAt,
      updatedAt: input.updatedAt ?? now,
    })

    const supersedes = [...new Set(input.supersedes ?? [])].filter((id) => id.length > 0)
    entry.supersedes = supersedes
    for (const oldId of supersedes) {
      const previous = this.store.get(oldId)
      if (!previous || previous.status !== 'active') continue
      previous.status = 'superseded'
      previous.supersededBy = [...new Set([...previous.supersededBy, entry.id])]
      previous.updatedAt = now
      this.store.upsert(previous)
      appendLog(this.root, 'supersede', previous.title, previous.id)
    }

    const saved = this.store.upsert(entry)
    appendLog(this.root, 'save', saved.title, saved.id)
    return saved
  }

  /** Patch an existing entry; returns null when the id is unknown. */
  update(id: string, patch: UpdatePatch): MemoryEntry | null {
    const entry = this.store.get(id)
    if (!entry) return null
    if (patch.title !== undefined) entry.title = patch.title
    if (patch.text !== undefined) entry.text = patch.text
    if (patch.kind !== undefined) entry.kind = patch.kind
    if (patch.tier !== undefined) entry.tier = patch.tier
    if (patch.status !== undefined) entry.status = patch.status
    if (patch.tags !== undefined) {
      entry.tags = [...new Set(patch.tags.map((tag) => tag.trim()).filter((tag) => tag.length > 0))]
    }
    if (patch.keywords !== undefined) entry.keywords = patch.keywords
    if (patch.importance !== undefined) entry.importance = clampImportance(patch.importance)
    if (patch.confidence !== undefined && Number.isFinite(patch.confidence)) {
      entry.confidence = Math.min(1, Math.max(0, patch.confidence))
    }
    if (patch.supersedes !== undefined) entry.supersedes = [...new Set(patch.supersedes)].filter((value) => value.length > 0)
    if (patch.supersededBy !== undefined) {
      entry.supersededBy = [...new Set(patch.supersededBy)].filter((value) => value.length > 0)
    }
    if (patch.related !== undefined) entry.related = [...new Set(patch.related)].filter((value) => value.length > 0)
    entry.updatedAt = new Date().toISOString()
    const saved = this.store.upsert(entry)
    appendLog(this.root, 'update', saved.title, saved.id)
    return saved
  }

  /**
   * Forget an entry: it is not deleted, but marked `superseded` so it stops
   * appearing in recall. Matches the kilo-memory semantics of `forget`.
   */
  forget(id: string): ForgetResult {
    const entry = this.store.get(id)
    if (!entry) return { ok: false, message: `Memory entry not found: ${id}` }
    if (entry.status !== 'active') {
      return { ok: true, message: `Memory entry "${entry.title}" is already inactive (${entry.status}).`, entry }
    }
    entry.status = 'superseded'
    entry.updatedAt = new Date().toISOString()
    const saved = this.store.upsert(entry)
    appendLog(this.root, 'forget', saved.title, saved.id)
    return { ok: true, message: `Memory entry "${saved.title}" (${saved.id}) marked as forgotten (superseded).`, entry: saved }
  }

  /** Permanently delete an entry, its page and any references to it. */
  delete(id: string): boolean {
    const entry = this.store.get(id)
    if (!entry) return false
    const now = new Date().toISOString()
    for (const other of this.store.list({ status: 'all' }).items) {
      if (other.id === id) continue
      const supersedes = other.supersedes.filter((value) => value !== id)
      const supersededBy = other.supersededBy.filter((value) => value !== id)
      const related = other.related.filter((value) => value !== id)
      if (
        supersedes.length === other.supersedes.length &&
        supersededBy.length === other.supersededBy.length &&
        related.length === other.related.length
      ) {
        continue
      }
      other.supersedes = supersedes
      other.supersededBy = supersededBy
      other.related = related
      other.updatedAt = now
      this.store.upsert(other)
    }
    const removed = this.store.delete(id)
    if (removed) appendLog(this.root, 'delete', entry.title, entry.id)
    return removed
  }

  /** Fetch an entry by id (any status). */
  get(id: string): MemoryEntry | null {
    return this.store.get(id)
  }

  /** List entries matching a filter (any status unless filtered). */
  list(filter: MemoryFilter = {}): MemoryListResult {
    return this.store.list(filter)
  }

  /** Search active entries and rank them; returns the items and their rendering. */
  recall(query = '', options: RecallOptions = {}): RecallResult {
    const scope: RecallScope = options.scope ?? this.config.recallScope
    const format: RecallFormat = options.format ?? 'markdown'
    const limit = Math.max(1, options.limit ?? this.config.recallLimit)
    const filter: MemoryFilter = { status: 'active' }
    if (scope !== 'all') filter.scope = scope
    if (options.project && options.project !== 'all') filter.project = options.project
    if (options.kind && options.kind !== 'all') filter.kind = options.kind
    if (options.tier && options.tier !== 'all') filter.tier = options.tier

    const candidates = this.store.search((query ?? '').trim(), filter)
    const ranked = rankItems(candidates, query, DEFAULT_RANKING, scope)
    const items = ranked.slice(0, limit)
    return { items, text: renderRecall(items, format), format }
  }

  /** Counters by scope/kind/status plus storage paths and database size. */
  statusReport(): StatusReport {
    const items = this.store.list({ status: 'all' }).items
    const byStatus: Record<string, number> = {}
    const byScope: Record<string, number> = {}
    const byKind: Record<string, number> = {}
    const byProject: Record<string, number> = {}
    for (const entry of items) {
      byStatus[entry.status] = (byStatus[entry.status] ?? 0) + 1
      byScope[entry.scope] = (byScope[entry.scope] ?? 0) + 1
      byKind[entry.kind] = (byKind[entry.kind] ?? 0) + 1
      if (entry.scope === 'project') byProject[entry.project] = (byProject[entry.project] ?? 0) + 1
    }
    return {
      root: this.root,
      dbPath: this.dbPath,
      dbSizeBytes: this.dbSizeBytes(),
      total: items.length,
      active: byStatus['active'] ?? 0,
      byStatus,
      byScope,
      byKind,
      byProject,
    }
  }

  /**
   * Health report: broken links (resolved against all statuses, including
   * `supersededBy`), significant overlaps of active entries, and stale entries.
   */
  lintReport(): LintReport {
    const all = this.store.list({ status: 'all' }).items
    const active = all.filter((entry) => entry.status === 'active')
    const allIds = new Set(all.map((entry) => entry.id))

    const brokenLinks: LintBrokenLink[] = []
    const checkField = (entry: MemoryEntry, field: LintBrokenLink['field'], refs: string[]): void => {
      for (const ref of refs) {
        if (!allIds.has(ref)) brokenLinks.push({ id: entry.id, title: entry.title, field, missingId: ref })
      }
    }
    for (const entry of all) {
      checkField(entry, 'supersedes', entry.supersedes)
      checkField(entry, 'related', entry.related)
      checkField(entry, 'supersededBy', entry.supersededBy)
    }

    const pairs = significantOverlapPairs(active, {
      minCommonWords: Math.max(1, this.config.lintOverlapMinCommonWords),
      minScore: LINT_OVERLAP_MIN_SCORE,
    })
    const maxPairs = Math.floor(this.config.lintMaxPairs)
    const limited = maxPairs > 0 ? pairs.slice(0, maxPairs) : pairs
    const overlaps: LintOverlap[] = limited.map((pair) => ({
      a: pair.a.id,
      b: pair.b.id,
      aTitle: pair.a.title,
      bTitle: pair.b.title,
      common: pair.common,
      score: Math.round(pair.score * 100) / 100,
    }))

    const cutoff = Date.now() - LINT_STALE_DAYS * 24 * 60 * 60 * 1000
    const stale: LintStale[] = active
      .filter((entry) => new Date(entry.updatedAt).getTime() < cutoff)
      .map((entry) => ({ id: entry.id, title: entry.title, updatedAt: entry.updatedAt }))

    return {
      totalCount: all.length,
      activeCount: active.length,
      brokenLinks,
      overlaps,
      overlapsHidden: Math.max(0, pairs.length - limited.length),
      stale,
      staleDays: LINT_STALE_DAYS,
    }
  }

  /** Heuristic knowledge graph over all entries (nodes) and their relations. */
  graph(): MemoryGraph {
    const entries = this.store.list({ status: 'all' }).items
    return buildGraph(entries, { overlapMinCommonWords: this.config.lintOverlapMinCommonWords })
  }

  /**
   * Compact English digest of active rules/preferences for the system prompt.
   * Returns an empty string when there is nothing to inject.
   */
  rulesForPrompt(limit = this.config.recallLimit): string {
    const items = this.store
      .list({ status: 'active' })
      .items.filter((entry) => entry.kind === 'rules' || entry.kind === 'preferences')
    if (items.length === 0) return ''
    const ranked = rankRulesBase(items, DEFAULT_RANKING).slice(0, Math.max(1, limit))
    const lines = ['Long-term memory: rules and preferences (respect these).']
    for (const entry of ranked) {
      lines.push(`- [${entry.tier}] ${entry.title}: ${firstLine(entry.text)}`)
    }
    return lines.join('\n')
  }

  /**
   * Import entries idempotently by `extKey`.
   *
   * Two passes are required for cross-entry relations: the first resolves every
   * entry to a stable local id (existing ids are reused through `extKey`), the
   * second rewrites `supersedes`/`supersededBy`/`related` through that map and
   * drops references to entries that were not imported, so no broken link is
   * ever stored.
   */
  importEntries(entries: ImportEntry[], source: string): ImportReport {
    const report: ImportReport = { source, imported: 0, updated: 0, skipped: 0, droppedRelations: 0, ids: [] }

    const resolutions: ExternalIdResolution[] = []
    const prepared: Array<{
      input: ImportEntry
      extKey: string
      text: string
      existing: MemoryEntry | null
      localId: string
    }> = []
    for (const input of entries) {
      const extKey = (input.extKey ?? '').trim()
      const text = (input.text ?? '').trim()
      if (extKey.length === 0 || text.length === 0) {
        report.skipped++
        continue
      }
      const existing = this.store.getByExtKey(extKey)
      const localId = existing?.id ?? genMemoryId()
      resolutions.push({ extKey, localId })
      prepared.push({ input, extKey, text, existing, localId })
    }

    const idMap = buildExternalIdMap(source, resolutions)
    for (const { input, extKey, text, existing, localId } of prepared) {
      const scope: MemoryScope = input.scope ?? 'project'
      const project = scope === 'user' ? '' : sanitizeProjectKey(input.project ?? this.project)
      if (scope === 'project') this.ensureProjectRoot(project)
      const supersedes = remapRelationIds(input.supersedes ?? [], source, idMap)
      const supersededBy = remapRelationIds(input.supersededBy ?? [], source, idMap)
      const related = remapRelationIds(input.related ?? [], source, idMap)
      report.droppedRelations += supersedes.dropped + supersededBy.dropped + related.dropped

      const candidate = newMemoryEntry({
        id: localId,
        scope,
        project,
        kind: input.kind ?? 'facts',
        tier: input.tier ?? 'normal',
        status: input.status ?? 'active',
        title: input.title ?? '',
        text,
        tags: input.tags ?? [],
        keywords: input.keywords ?? '',
        importance: input.importance ?? 3,
        supersedes: supersedes.ids,
        supersededBy: supersededBy.ids,
        related: related.ids,
        ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
        source: input.source ?? source,
        extKey,
        createdAt: input.createdAt ?? existing?.createdAt,
        updatedAt: input.updatedAt ?? new Date().toISOString(),
      })

      report.ids.push(localId)
      if (!existing) {
        this.store.upsert(candidate)
        report.imported++
        continue
      }
      if (sameImportedEntry(existing, candidate)) {
        report.skipped++
        continue
      }
      this.store.upsert({ ...candidate, createdAt: existing.createdAt || candidate.createdAt })
      report.updated++
    }
    return report
  }

  /**
   * Safe health repair: drop broken relation references, add missing reverse
   * links (`supersededBy` for `supersedes`, symmetric `related`), then rebuild
   * the derived index from the markdown pages.
   *
   * Non-destructive: no entry is deleted and no status is changed.
   */
  heal(): HealReport {
    const all = this.store.list({ status: 'all' }).items
    const ids = new Set(all.map((entry) => entry.id))
    const byId = new Map(all.map((entry) => [entry.id, entry]))
    const original = new Map(
      all.map((entry) => [
        entry.id,
        {
          supersedes: entry.supersedes.join('\u0000'),
          supersededBy: entry.supersededBy.join('\u0000'),
          related: entry.related.join('\u0000'),
        },
      ]),
    )
    const brokenBefore = this.lintReport().brokenLinks.length

    let removedLinks = 0
    for (const entry of all) {
      const keep = (refs: string[]): string[] => {
        const kept = refs.filter((ref) => ids.has(ref))
        removedLinks += refs.length - kept.length
        return kept
      }
      entry.supersedes = keep(entry.supersedes)
      entry.supersededBy = keep(entry.supersededBy)
      entry.related = keep(entry.related)
    }

    let addedBacklinks = 0
    const addUnique = (refs: string[], value: string): void => {
      if (refs.includes(value)) return
      refs.push(value)
      addedBacklinks++
    }
    for (const entry of all) {
      for (const targetId of entry.supersedes) {
        const target = byId.get(targetId)
        if (target) addUnique(target.supersededBy, entry.id)
      }
      for (const targetId of entry.related) {
        const target = byId.get(targetId)
        if (target) addUnique(target.related, entry.id)
      }
    }

    const now = new Date().toISOString()
    for (const entry of all) {
      const before = original.get(entry.id)
      if (!before) continue
      const changed =
        before.supersedes !== entry.supersedes.join('\u0000') ||
        before.supersededBy !== entry.supersededBy.join('\u0000') ||
        before.related !== entry.related.join('\u0000')
      if (!changed) continue
      entry.updatedAt = now
      this.store.upsert(entry)
    }

    const reindexed = this.store.reindexFromDisk()
    const brokenAfter = this.lintReport().brokenLinks.length
    appendLog(this.root, 'heal', `removed=${removedLinks} added=${addedBacklinks} reindexed=${reindexed}`)
    return { removedLinks, addedBacklinks, reindexed, brokenBefore, brokenAfter }
  }

  /** Close the underlying database connection. */
  close(): void {
    this.store.close()
  }

  private dbSizeBytes(): number {
    try {
      return statSync(this.dbPath).size
    } catch {
      return 0
    }
  }
}
