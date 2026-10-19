/**
 * Kilo memory service on top of the shared core: storage, ranking, wiki pages,
 * maintenance and graph. The adapter stays thin — all logic lives in core.
 */
import { consolidate, crystallize as crystallizeEntries, reinforce, selfHeal, DEFAULT_MAINTENANCE } from '@llm-memory/core/application/maintenance'
import { DEFAULT_RANKING, KILO_RANKING_WEIGHTS, rankItems } from '@llm-memory/core/application/ranking'
import { buildGraph, deleteItemPage, initMemoryRoot, writeItemPage } from '@llm-memory/core/application/wiki'
import { entryFromKiloRow, entryToKiloRow } from '@llm-memory/core/domain/mapping'
import { clampImportance, type MemoryEntry, type MemoryGraph, type MemoryKind, type MemoryScope, type MemoryTier } from '@llm-memory/core/domain/types'
import { MemoryStore, newMemoryEntry } from '@llm-memory/core/infrastructure/store'
import { entryPathFor } from '@llm-memory/core/layout/paths'
import { createKiloLayout, type LayoutPort } from '@llm-memory/core/layout/index'
import { createIsolation } from '@llm-memory/core/isolation/index'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { KiloMemoryConfig } from './config.js'

const KILO_PROJECT_DIR = '.kilo/memory'

export interface KiloServiceOptions {
  config: KiloMemoryConfig
  /** Repository root of the current Kilo window. */
  projectRoot?: string
  layout?: LayoutPort
}

export interface SaveInput {
  text: string
  title?: string
  kind?: MemoryKind
  tier?: MemoryTier
  scope?: MemoryScope | 'global'
  project?: string
  importance?: number
  tags?: string[]
  keywords?: string
  supersedes?: string[]
  related?: string[]
  confidence?: number
}

export interface RecallOptions {
  limit?: number
  scope?: 'global' | 'project' | 'all'
  kind?: MemoryKind | 'all'
  format?: 'markdown' | 'table' | 'timeline' | 'json'
  /** Reinforce returned entries (accessCount/confidence/consolidation). */
  touch?: boolean
}

export interface RecallResult {
  items: MemoryEntry[]
  text: string
}

export interface KiloStatus {
  total: number
  active: number
  byScope: Record<string, number>
  byKind: Record<string, number>
  byConsolidation: Record<string, number>
  projects: number
}

export class KiloService {
  readonly layout: LayoutPort
  readonly store: MemoryStore
  private readonly config: KiloMemoryConfig
  private readonly projectRoot: string | undefined

  constructor(options: KiloServiceOptions) {
    this.config = options.config
    this.projectRoot = options.projectRoot
    this.layout = options.layout ?? createKiloLayout()
    const root = options.config.memory.storageRoot || this.layout.userRoot()
    this.store = new MemoryStore({ storageRoot: root })
  }

  /** Validate paths, create the wiki root and open the store. */
  init(): void {
    const isolation = createIsolation({
      identity: { harness: 'kilo', instanceId: `kilo-${process.pid}`, storeId: 'kilo' },
      storeRoot: this.store.root,
    })
    isolation.assertNoForeignPaths()
    initMemoryRoot(this.store.root)
    this.store.open()
  }

  save(input: SaveInput): MemoryEntry {
    const scope: MemoryScope = input.scope === 'project' ? 'project' : 'user'
    const project = scope === 'project' ? (input.project ?? this.projectRoot ?? '') : ''
    const entry = newMemoryEntry({
      scope,
      project,
      kind: input.kind ?? 'facts',
      tier: input.tier ?? 'normal',
      title: input.title ?? input.text.split(/\r?\n/)[0]?.slice(0, 80) ?? '',
      text: input.text,
      tags: input.tags ?? [],
      keywords: input.keywords ?? '',
      importance: clampImportance(input.importance ?? 3),
      supersedes: input.supersedes ?? [],
      related: input.related ?? [],
      ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
      origin: 'kilo',
      consolidation: 'episodic',
    })
    const stored = this.store.upsert(entry)
    writeItemPage(this.store.root, stored, scope === 'project' ? project : null, KILO_PROJECT_DIR)
    return stored
  }

  recall(query: string, options: RecallOptions = {}): RecallResult {
    const limit = options.limit ?? this.config.memory.recallLimit
    const scope = options.scope ?? (this.config.memory.recallScope === 'all' ? 'all' : this.config.memory.recallScope)
    const filter = {
      status: 'active' as const,
      ...(scope !== 'all' ? { scope: scope === 'global' ? ('user' as const) : ('project' as const) } : {}),
      ...(options.kind && options.kind !== 'all' ? { kind: options.kind } : {}),
      limit: Math.max(limit * 4, 40),
    }
    const found = query.trim().length > 0 ? this.store.search(query, filter) : this.store.list(filter).items
    const ranked = rankItems(found, query, { ...DEFAULT_RANKING, weights: KILO_RANKING_WEIGHTS }).slice(0, limit)
    const items = options.touch === false ? ranked : ranked.map(item => this.reinforced(item))
    const format = options.format ?? this.config.memory.recallFormat
    return { items, text: renderRecall(items, format, this.config.memory.recallTextChars) }
  }

  private reinforced(entry: MemoryEntry): MemoryEntry {
    const next = reinforce(entry, DEFAULT_MAINTENANCE)
    const stored = this.store.upsert(next)
    writeItemPage(this.store.root, stored, stored.scope === 'project' ? stored.project : null, KILO_PROJECT_DIR)
    return stored
  }

  forget(id: string): boolean {
    const entry = this.store.get(id)
    if (!entry) return false
    const now = new Date().toISOString()
    const stored = this.store.upsert({ ...entry, status: 'superseded', updatedAt: now })
    writeItemPage(this.store.root, stored, stored.scope === 'project' ? stored.project : null, KILO_PROJECT_DIR)
    return true
  }

  delete(id: string): boolean {
    const entry = this.store.get(id)
    if (!entry) return false
    const file = entryPathFor(this.store.root, entry, entry.scope === 'project' ? entry.project : null, KILO_PROJECT_DIR)
    this.store.delete(id)
    deleteItemPage(file)
    return true
  }

  status(): KiloStatus {
    const items = this.store.list({ limit: 1_000_000 }).items
    const byScope: Record<string, number> = {}
    const byKind: Record<string, number> = {}
    const byConsolidation: Record<string, number> = {}
    let active = 0
    for (const item of items) {
      byScope[item.scope] = (byScope[item.scope] ?? 0) + 1
      byKind[item.kind] = (byKind[item.kind] ?? 0) + 1
      const key = item.consolidation ?? 'raw'
      byConsolidation[key] = (byConsolidation[key] ?? 0) + 1
      if (item.status === 'active') active += 1
    }
    return {
      total: items.length,
      active,
      byScope,
      byKind,
      byConsolidation,
      projects: Object.keys(this.store.projectRoots()).length,
    }
  }

  lint(): { issues: { entryId: string; kind: string; detail: string }[] } {
    const report = selfHeal(this.store.list({ limit: 1_000_000 }).items, 'report')
    return {
      issues: report.issues.map(issue => ({ entryId: issue.entryId, kind: issue.kind, detail: issue.detail })),
    }
  }

  graph(): MemoryGraph {
    return buildGraph(this.store.list({ limit: 1_000_000 }).items)
  }

  consolidate(): number {
    const { items, changed } = consolidate(this.store.list({ limit: 1_000_000 }).items, DEFAULT_MAINTENANCE)
    for (const entry of changed) {
      this.store.upsert(entry)
      writeItemPage(this.store.root, entry, entry.scope === 'project' ? entry.project : null, KILO_PROJECT_DIR)
    }
    return items.length
  }

  /** Paths handed to the shared backup service (ADR-005). */
  backupTarget(): { storeDir: string; dbPath: string; projectDirs: string[]; backupsDir: string } {
    const storeDir = this.store.root
    return {
      storeDir,
      dbPath: this.store.dbPath,
      projectDirs: this.projectRoot ? [join(this.projectRoot, KILO_PROJECT_DIR)] : [],
      backupsDir: this.config.memory.backupDir || join(storeDir, 'backups'),
    }
  }

  /** Strip a session id down to a safe filename (Kilo wrote the same names). */
  crystallize(sessionId: string): { path: string; markdown: string } {
    const result = crystallizeEntries(this.store.list({ limit: 1_000_000 }).items, sessionId)
    if (result.disabled) return { path: '', markdown: '' }
    const dir = join(this.layout.userRoot(), 'raw')
    mkdirSync(dir, { recursive: true })
    const name = (sessionId || 'session').replace(/[\\/:*?"<>|]+/g, '-').slice(0, 120)
    const path = join(dir, `crystallize-${name}.md`)
    writeFileSync(path, result.markdown, 'utf8')
    return { path, markdown: result.markdown }
  }

  close(): void {
    this.store.close()
  }

  /** Compatibility helper for importers/migrations: canonical rows of this store. */
  rows(): Record<string, unknown>[] {
    return this.store.list({ limit: 1_000_000 }).items.map(entryToKiloRow)
  }

  static fromRow(row: Record<string, unknown>): MemoryEntry {
    return entryFromKiloRow(row)
  }
}

function renderRecall(items: MemoryEntry[], format: string, limitChars: number): string {
  if (items.length === 0) return 'Память: совпадений нет.'
  if (format === 'json') return JSON.stringify(items.map(item => ({ id: item.id, title: item.title, kind: item.kind, text: item.text })), null, 2)
  const lines = items.map(item => {
    const excerpt = item.text.replace(/\s+/g, ' ').slice(0, limitChars)
    if (format === 'table') return `| ${item.kind} | ${item.title} | ${excerpt} |`
    if (format === 'timeline') return `- ${item.updatedAt.slice(0, 10)} [${item.kind}] ${item.title} — ${excerpt}`
    return `- [${item.scope}/${item.kind}] ${item.title} (${item.id}) — ${excerpt}`
  })
  if (format === 'table') {
    return ['| kind | title | excerpt |', '| --- | --- | --- |', ...lines].join('\n')
  }
  return `## Память\n${lines.join('\n')}`
}
