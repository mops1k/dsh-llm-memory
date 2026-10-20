/**
 * Kilo memory service on top of the shared core: storage, ranking, wiki pages,
 * maintenance and graph. The adapter stays thin — all logic lives in core.
 */
import { consolidate, crystallize as crystallizeEntries, reinforce, selfHeal, DEFAULT_MAINTENANCE } from '../../core/application/maintenance.js'
import { DEFAULT_RANKING, KILO_RANKING_WEIGHTS, rankItems } from '../../core/application/ranking.js'
import { buildGraph, deleteItemPage, initMemoryRoot, writeItemPage } from '../../core/application/wiki.js'
import { entryFromKiloRow, entryToKiloRow } from '../../core/domain/mapping.js'
import { clampImportance, type MemoryEntry, type MemoryGraph, type MemoryKind, type MemoryScope, type MemoryTier } from '../../core/domain/types.js'
import { ModelManager, type ModelStatus } from '../../core/application/model-manager.js'
import { DEFAULT_CONFIG, type EmbeddingConfig, type MemoryConfig } from '../../core/domain/config.js'
import { writeSettingValue } from '../../core/domain/settings-schema.js'
import {
  settingsSnapshot as buildSettingsSnapshot,
  type UISettingsSnapshot,
} from '../../core/domain/ui-contract.js'
import { createBackup, deleteBackup, listBackups, resolveBackupDir, restoreBackup, verifyBackup, type BackupRecord, type BackupReport, type RestoreReport, type VerifyReport } from '../../core/infrastructure/backup.js'
import { createEmbeddingProvider } from '../../core/infrastructure/embeddings.js'
import { MemoryStore, newMemoryEntry } from '../../core/infrastructure/store.js'
import { entryPathFor } from '../../core/layout/paths.js'
import { createKiloLayout, type LayoutPort } from '../../core/layout/index.js'
import { createIsolation } from '../../core/isolation/index.js'
import { mkdirSync, writeFileSync } from 'node:fs'
import { basename } from 'node:path'
import { join } from 'node:path'

import type { KiloMemoryConfig } from './config.js'

const KILO_PROJECT_DIR = '.kilo/memory'

/** Core settings the Kilo runtime does not apply yet (parity work in progress). */
const SETTINGS_UNSUPPORTED_IN_KILO: string[] = [
  'projectRoots',
  'projectScanBudgetMs',
  'webPath',
  'recallTotalChars',
  'recallFormat',
  'recallScope',
  'recallAllowFormatOverride',
  'recallLiteralLookup',
  'promptRulesLimit',
  'rulesPromptScope',
  'sessionStartGuide',
  'systemPrompt',
  'lintOverlapMinCommonWords',
  'lintMaxPairs',
  'autonomous',
  'requireConfirmation',
  'embeddings.backend',
  'embeddings.quantization',
  'embeddings.batchSize',
  'embeddings.queryPrefix',
  'embeddings.passagePrefix',
  'embeddings.semanticEdgesPerEntry',
  'embeddings.semanticMaxEdges',
]

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
  /** Embedding-model lifecycle shared with the other harnesses (core). */
  readonly model: ModelManager
  private readonly config: KiloMemoryConfig
  private readonly projectRoot: string | undefined

  constructor(options: KiloServiceOptions) {
    this.config = options.config
    this.projectRoot = options.projectRoot
    this.layout = options.layout ?? createKiloLayout()
    const root = options.config.memory.storageRoot || this.layout.userRoot()
    // Kilo keeps its database in <store>/db/memory.db (not the core _db dialect).
    this.store = new MemoryStore({ storageRoot: root, dbPath: join(root, 'db', 'memory.db') })
    this.model = new ModelManager({
      settings: this.embeddingsConfig(),
      cacheDir: join(root, '_models'),
      // The Kilo plugin ships as a single file, so there is no compiled
      // `embed-worker.js` next to it: run the model in-process instead.
      createProvider: (settings, options) => createEmbeddingProvider(settings, { ...options, inline: true }),
      isConfigured: () => this.config.embeddings.provider !== 'off',
      // The Kilo adapter has no vector leg yet (stage 9), so nothing is live.
      isEnabled: () => false,
    })
  }

  /** Kilo settings folded into the core embedding shape. */
  private embeddingsConfig(): EmbeddingConfig {
    const defaults = DEFAULT_CONFIG.embeddings
    const embeddings = this.config.embeddings
    return {
      ...defaults,
      provider: embeddings.provider,
      model: embeddings.model.includes('/') ? embeddings.model : `Xenova/${embeddings.model}`,
      dim: embeddings.dim,
      topK: embeddings.topK,
      minScore: embeddings.minScore,
      chunkChars: embeddings.chunkChars,
      chunkOverlap: embeddings.chunkOverlap,
      prewarm: embeddings.prewarm,
      backend: embeddings.provider === 'off' ? 'off' : 'js',
    }
  }

  /**
   * Settings surface of the core for the panel: the same schema and values as in
   * every harness. Paths the Kilo runtime does not apply yet are reported as
   * unsupported instead of being silently editable.
   */
  settingsSnapshot(locale: 'en' | 'ru' = this.config.uiLocale): { snapshot: UISettingsSnapshot; unsupported: string[] } {
    const values: Record<string, unknown> = structuredClone(DEFAULT_CONFIG) as unknown as Record<string, unknown>
    const memory = this.config.memory
    const supported: Record<string, unknown> = {
      storageRoot: memory.storageRoot,
      recallLimit: memory.recallLimit,
      recallTextChars: memory.recallTextChars,
      backupDir: memory.backupDir,
    }
    for (const [path, value] of Object.entries(supported)) writeSettingValue(values, path, value)
    const embeddings = this.embeddingsConfig()
    for (const key of ['provider', 'model', 'dim', 'topK', 'minScore', 'chunkChars', 'chunkOverlap', 'prewarm'] as const) {
      writeSettingValue(values, `embeddings.${key}`, embeddings[key])
    }
    const snapshot = buildSettingsSnapshot(values as unknown as MemoryConfig, locale)
    return { snapshot, unsupported: SETTINGS_UNSUPPORTED_IN_KILO.filter(path => !Object.hasOwn(supported, path) && !path.startsWith('embeddings.')) }
  }

  /**
   * Apply a dotted settings patch from the panel. Returns the paths this runtime
   * cannot apply yet so the panel can say so instead of pretending.
   */
  applySettingsPatch(patch: Record<string, unknown>): { applied: string[]; unsupported: string[] } {
    const applied: string[] = []
    const unsupported: string[] = []
    for (const [path, value] of Object.entries(patch)) {
      const memory = this.config.memory
      switch (path) {
        case 'storageRoot':
          memory.storageRoot = String(value ?? '').trim()
          break
        case 'recallLimit':
          memory.recallLimit = Number(value)
          break
        case 'recallTextChars':
          memory.recallTextChars = Number(value)
          break
        case 'backupDir':
          memory.backupDir = String(value ?? '').trim()
          break
        default: {
          if (!path.startsWith('embeddings.')) {
            unsupported.push(path)
            break
          }
          const key = path.slice('embeddings.'.length) as keyof typeof this.config.embeddings
          if (!(key in this.config.embeddings)) {
            unsupported.push(path)
            break
          }
          if (typeof this.config.embeddings[key] === 'number') (this.config.embeddings as Record<string, unknown>)[key] = Number(value)
          else if (typeof this.config.embeddings[key] === 'boolean') (this.config.embeddings as Record<string, unknown>)[key] = Boolean(value)
          else (this.config.embeddings as Record<string, unknown>)[key] = String(value ?? '')
        }
      }
      if (!unsupported.includes(path)) applied.push(path)
    }
    return { applied, unsupported }
  }

  /** State of the embedding model shown by the panel. */
  modelStatus(): ModelStatus {
    return this.model.status()
  }

  /** Start (or report) the model download. */
  downloadModel(): ModelStatus {
    return this.model.download()
  }

  /** Delete the cached model files. */
  removeModel(): ModelStatus {
    return this.model.remove()
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

  status(project?: string): KiloStatus {
    const items = this.store.list({ limit: 1_000_000, ...(project ? { project } : {}) }).items
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

  /** Distinct project keys present in the store (raw paths as written by the harness). */
  projects(): string[] {
    const items = this.store.list({ limit: 1_000_000 }).items
    const keys = new Set<string>()
    for (const item of items) if (item.project) keys.add(item.project)
    for (const key of Object.keys(this.store.projectRoots())) keys.add(key)
    return [...keys].sort((left, right) => left.localeCompare(right))
  }

  lint(project?: string): { issues: { entryId: string; kind: string; detail: string }[] } {
    const report = selfHeal(this.store.list({ limit: 1_000_000, ...(project ? { project } : {}) }).items, 'report')
    return {
      issues: report.issues.map(issue => ({ entryId: issue.entryId, kind: issue.kind, detail: issue.detail })),
    }
  }

  graph(project?: string): MemoryGraph {
    return buildGraph(this.store.list({ limit: 1_000_000, ...(project ? { project } : {}) }).items)
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
      backupsDir: resolveBackupDir(storeDir, this.config.memory.backupDir),
    }
  }

  /** Backups of this store (pages + db), the same .llmmem format as DSH. */
  backupCreate(): BackupReport {
    return createBackup({ harness: 'kilo', ...this.backupTarget() })
  }

  backupList(): BackupRecord[] {
    return listBackups(this.backupTarget().backupsDir)
  }

  backupVerify(name: string): VerifyReport {
    return verifyBackup(this.backupArchive(name))
  }

  /** Restore replaces the live store, so the DB is closed for the duration. */
  backupRestore(name: string, confirm: string | undefined): RestoreReport {
    const archive = this.backupArchive(name)
    this.store.close()
    try {
      return restoreBackup({ harness: 'kilo', ...this.backupTarget(), archive, confirm })
    } finally {
      this.store.open()
    }
  }

  backupDelete(name: string, confirm: string | undefined): boolean {
    return deleteBackup(this.backupArchive(name), confirm, this.backupTarget().backupsDir)
  }

  /** Accept only a file name inside the backups directory, never a path. */
  private backupArchive(name: string): string {
    const safe = basename(String(name ?? ''))
    if (!safe || safe !== String(name)) throw new Error('Invalid backup name')
    return join(this.backupTarget().backupsDir, safe)
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

  /** Compatibility helper for migrations: canonical rows of this store. */
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
