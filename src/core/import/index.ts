/**
 * Import orchestration: discover foreign memory roots, map their entries into
 * the core model and write them to the local store idempotently.
 *
 * Idempotency is keyed on `extKey` (`kilo:<id>`, `mnemon:<id>`,
 * `dsh-memory:<scope>:<name>`): re-running an import updates changed entries and
 * skips unchanged ones instead of creating duplicates.
 */
import type { MemoryStore } from '../store.js'
import type { MemoryEntry } from '../types.js'
import {
  buildExternalIdMap,
  mergeImportedProjects,
  remapRelationIds,
  sameImportedEntry,
  type ExternalIdResolution,
  type ImportedProject,
} from './common.js'
import { importDshMemory } from './dsh-memory.js'
import { importKilo } from './kilo.js'
import { importMnemon } from './mnemon.js'
import { detectAllRoots, type ImportRoots, type ImportRootsOptions } from './paths.js'

export type ImportSourceName = 'kilo' | 'mnemon' | 'dsh-memory'

/** All import sources in their default processing order. */
export const IMPORT_SOURCES: readonly ImportSourceName[] = ['kilo', 'mnemon', 'dsh-memory']

/** Plugin config block that controls import root discovery. */
export type ImportConfig = ImportRootsOptions

/** Per-source outcome of an import run. */
export interface ImportReport {
  source: ImportSourceName
  imported: number
  updated: number
  skipped: number
  /** Relation references dropped because their target was not imported. */
  droppedRelations: number
  errors: string[]
  rootsFound: string[]
  /** Unique projects seen in this source (`root` may be null). */
  projects: ImportedProject[]
}

export interface RunImportOptions {
  /** Subset of sources to process; defaults to {@link IMPORT_SOURCES}. */
  sources?: readonly ImportSourceName[]
  /** Root discovery options (explicit `importRoots` plus auto-detect toggles). */
  config?: ImportConfig
  /** Target store that receives the imported entries. */
  store: MemoryStore
  /** Pre-resolved roots; when omitted they are detected from `config`. */
  roots?: ImportRoots
}

interface SourceResult {
  entries: MemoryEntry[]
  rootsFound: string[]
  errors: string[]
  projects: ImportedProject[]
}

/**
 * Import one source in two passes so cross-entry relations survive the id
 * rewrite:
 *
 * 1. resolve every entry to a local id (`extKey` idempotency keeps existing
 *    ids stable) and build an `externalId -> localId` map;
 * 2. rewrite `supersedes`/`supersededBy`/`related` through that map, dropping
 *    references to entries that were not imported, and persist each entry once.
 */
function applySource(source: ImportSourceName, result: SourceResult, store: MemoryStore): ImportReport {
  const errors = [...result.errors]
  let imported = 0
  let updated = 0
  let skipped = 0
  let droppedRelations = 0

  const resolutions: ExternalIdResolution[] = []
  const prepared: Array<{ entry: MemoryEntry; existingId: string | null; localId: string }> = []
  for (const entry of result.entries) {
    try {
      const extKey = (entry.extKey ?? '').trim()
      const existing = extKey.length > 0 ? store.getByExtKey(extKey) : null
      const localId = existing?.id ?? entry.id
      if (extKey.length > 0) resolutions.push({ extKey, localId })
      prepared.push({ entry, existingId: existing?.id ?? null, localId })
    } catch (error) {
      errors.push(`${source}: failed to resolve "${entry.title}": ${String(error)}`)
    }
  }

  const idMap = buildExternalIdMap(source, resolutions)
  for (const { entry, existingId, localId } of prepared) {
    try {
      const supersedes = remapRelationIds(entry.supersedes, source, idMap)
      const supersededBy = remapRelationIds(entry.supersededBy, source, idMap)
      const related = remapRelationIds(entry.related, source, idMap)
      droppedRelations += supersedes.dropped + supersededBy.dropped + related.dropped

      const candidate: MemoryEntry = {
        ...entry,
        id: localId,
        supersedes: supersedes.ids,
        supersededBy: supersededBy.ids,
        related: related.ids,
      }
      if (existingId === null) {
        store.upsert(candidate)
        imported++
        continue
      }
      const existing = store.get(existingId)
      if (existing && sameImportedEntry(existing, candidate)) {
        skipped++
        continue
      }
      store.upsert({ ...candidate, createdAt: existing?.createdAt || candidate.createdAt })
      updated++
    } catch (error) {
      errors.push(`${source}: failed to upsert "${entry.title}": ${String(error)}`)
    }
  }

  return {
    source,
    imported,
    updated,
    skipped,
    droppedRelations,
    errors,
    rootsFound: result.rootsFound,
    projects: result.projects,
  }
}

/** Options for a read-only project detection (no store writes). */
export interface DetectProjectsOptions {
  config?: ImportConfig
  /** Pre-resolved roots; when omitted they are detected from `config`. */
  roots?: ImportRoots
}

/**
 * Read foreign stores and collect their projects without writing anything to
 * the local memory store. Sources are still opened read-only, so this is safe
 * to run purely for workspace registration.
 */
export function detectImportProjects(options: DetectProjectsOptions = {}): ImportedProject[] {
  const roots = options.roots ?? detectAllRoots(options.config ?? {})
  return mergeImportedProjects([
    importKilo(roots.kilo).projects,
    importMnemon(roots.mnemon).projects,
    importDshMemory(roots.dshMemory).projects,
  ])
}

/**
 * Import the requested sources into the store and return one report per source
 * (even when a source is empty or missing).
 */
export function runImport(options: RunImportOptions): ImportReport[] {
  const { store } = options
  const roots = options.roots ?? detectAllRoots(options.config ?? {})
  const sources = options.sources && options.sources.length > 0 ? options.sources : IMPORT_SOURCES
  const reports: ImportReport[] = []

  for (const source of sources) {
    if (source === 'kilo') reports.push(applySource(source, importKilo(roots.kilo), store))
    else if (source === 'mnemon') reports.push(applySource(source, importMnemon(roots.mnemon), store))
    else if (source === 'dsh-memory') reports.push(applySource(source, importDshMemory(roots.dshMemory), store))
  }
  return reports
}

export * from './paths.js'
export * from './kilo.js'
export * from './mnemon.js'
export * from './dsh-memory.js'
export { addImportedProject, mergeImportedProjects } from './common.js'
export type { ImportedProject } from './common.js'
