/**
 * Wiki file operations and heuristic knowledge graph construction.
 *
 * Markdown pages are the source of truth; the SQLite index is derived. This
 * module owns page-level reads/writes, index.md generation and graph building
 * (entities + typed edges), adapted from the kilo-memory wiki/graph algorithm.
 */
import { existsSync, renameSync } from 'node:fs'
import { basename, join, relative, resolve } from 'node:path'

import { entryFromPage, pageToText } from './frontmatter.js'
import { appendLog, debug } from './log.js'
import {
  DB_DIR,
  DIGEST_DIR,
  USER_DIR,
  ensureDir,
  entryPathFor,
  fileStatInfo,
  kindDir,
  listChildDirectories,
  listMarkdownFiles,
  projectMemoryRoot,
  readFileIfExists,
  readProjectsRegistry,
  removeFileIfExists,
  sanitizeProjectKey,
  writeFileAtomic,
} from './paths.js'
import { significantOverlapPairs, type OverlapOptions } from './ranking.js'
import type {
  MemoryEdgeType,
  MemoryEntry,
  MemoryGraph,
  MemoryGraphEdge,
  MemoryGraphEntity,
  MemoryScope,
} from './types.js'
import { MEMORY_KINDS } from './types.js'

export interface PageOnDisk {
  file: string
  /** File size in bytes, taken from the same `stat` call as `mtimeMs`. */
  size: number
  mtimeMs: number
  text: string
  scope: MemoryScope
  project: string
}

/** Create the base directory structure of the storage root. */
export function initMemoryRoot(root: string): void {
  ensureDir(root)
  ensureDir(join(root, USER_DIR))
}

/**
 * Base (kind-less) directories that may hold markdown pages: the `_user` layer,
 * every registered project tree and the legacy per-project directories under
 * the storage root.
 */
function scopeBaseDirs(
  root: string,
  projects: Record<string, string>,
): Array<{ dir: string; scope: MemoryScope; project: string }> {
  const base = resolve(root)
  const out: Array<{ dir: string; scope: MemoryScope; project: string }> = [
    { dir: join(base, USER_DIR), scope: 'user', project: '' },
  ]
  for (const [key, projectRoot] of Object.entries(projects)) {
    out.push({ dir: projectMemoryRoot(projectRoot), scope: 'project', project: sanitizeProjectKey(key) })
  }
  for (const dirName of listChildDirectories(root)) {
    if (dirName === DB_DIR || dirName === DIGEST_DIR || dirName === USER_DIR) continue
    if (Object.prototype.hasOwnProperty.call(projects, dirName)) continue
    out.push({ dir: join(base, dirName), scope: 'project', project: dirName })
  }
  return out
}

/** Result of the one-time flat-layout migration. */
export interface FlatMigrationReport {
  /** Flat pages moved into their `<kind>/` subdirectory. */
  moved: number
  /** Flat pages left in place (unreadable frontmatter or a name collision). */
  skipped: number
}

/**
 * Migrate the legacy flat layout (`<baseDir>/<name>.md`) to the category layout
 * (`<baseDir>/<kind>/<name>.md`), where `kind` is read from the page
 * frontmatter.
 *
 * Idempotent and lossless: a page whose frontmatter cannot be decoded stays in
 * place and is logged; an existing target is never overwritten. Returns how
 * many pages were moved so callers can trigger a reindex that refreshes the
 * `path` column.
 */
export function migrateFlatPages(root: string, projects?: Record<string, string>): FlatMigrationReport {
  const report: FlatMigrationReport = { moved: 0, skipped: 0 }
  const registry = projects ?? readProjectsRegistry(root)
  for (const { dir, scope, project } of scopeBaseDirs(root, registry)) {
    for (const file of listMarkdownFiles(dir)) {
      const name = basename(file)
      if (name === 'log.md' || name === 'index.md') continue
      const text = readFileIfExists(file)
      if (text === null) continue
      const entry = entryFromPage(text)
      if (!entry) {
        report.skipped++
        debug(`migrate: cannot decode frontmatter, leaving ${file} in place`)
        continue
      }
      const targetDir = kindDir(dir, entry.kind)
      const target = join(targetDir, name)
      if (existsSync(target)) {
        report.skipped++
        debug(`migrate: target already exists, leaving ${file} in place`)
        continue
      }
      try {
        ensureDir(targetDir)
        renameSync(file, target)
        report.moved++
        appendLog(root, 'migrate', `${scope}:${project.length > 0 ? project : USER_DIR}`, name)
      } catch (error) {
        report.skipped++
        debug(`migrate: cannot move ${file}: ${String(error)}`)
      }
    }
  }
  return report
}

/**
 * A page path with the storage layer it belongs to, collected before any file
 * content is read. `baseDir` groups pages by the root they live in, which the
 * incremental reconcile uses to budget slow mounts.
 */
export interface PageRef {
  file: string
  scope: MemoryScope
  project: string
  /** Base directory (before `<kind>/`) this page was found in. */
  baseDir: string
}

/**
 * Collect every markdown page path from the user layer, the registered project
 * trees and the legacy per-project directories under the storage root — without
 * reading a single page.
 *
 * Each base directory is scanned one level deep, once per known category
 * (`<baseDir>/<kind>/*.md`); a flat `*.md` left in the base directory by a
 * skipped migration is still collected so no page is lost. The flat layout is
 * migrated to `<kind>/` first.
 *
 * - `_user` holds cross-project (user) memories;
 * - each entry of `projects.json` points at a repository root whose pages live
 *   in `<projectRoot>/.dsh/llm-memory`;
 * - child directories of the storage root are the legacy/global fallback used
 *   when a project root is unknown.
 *
 * `projects` can be provided to avoid re-reading the registry (the store keeps
 * a cache); duplicate absolute file paths are collapsed.
 *
 * Listing is the cheap half of an index pass (readdir only): a page found here
 * is known to exist even when the caller decides not to read it.
 */
export function enumeratePages(root: string, projects?: Record<string, string>): PageRef[] {
  const out: PageRef[] = []
  const seen = new Set<string>()
  const pushFile = (file: string, scope: MemoryScope, project: string, baseDir: string): void => {
    if (seen.has(file)) return
    seen.add(file)
    out.push({ file, scope, project, baseDir })
  }

  const registry = projects ?? readProjectsRegistry(root)
  migrateFlatPages(root, registry)

  for (const { dir, scope, project } of scopeBaseDirs(root, registry)) {
    for (const kind of MEMORY_KINDS) {
      for (const file of listMarkdownFiles(kindDir(dir, kind))) pushFile(file, scope, project, dir)
    }
    for (const file of listMarkdownFiles(dir)) {
      if (basename(file) === 'log.md' || basename(file) === 'index.md') continue
      pushFile(file, scope, project, dir)
    }
  }
  return out
}

/**
 * Read every page listed by {@link enumeratePages}, one read and one `stat` per
 * page. This is the full-rebuild path (empty database, explicit reindex); the
 * incremental path only reads pages whose size or mtime changed.
 */
export function readAllPages(root: string, projects?: Record<string, string>): PageOnDisk[] {
  const out: PageOnDisk[] = []
  for (const ref of enumeratePages(root, projects)) {
    const text = readFileIfExists(ref.file)
    if (text === null) continue
    // One `stat` supplies both fields of the incremental index. When it fails
    // after a successful read (a race), fall back to the byte length so the
    // page still gets indexed.
    const info = fileStatInfo(ref.file)
    out.push({
      file: ref.file,
      size: info?.size ?? Buffer.byteLength(text, 'utf8'),
      mtimeMs: info?.mtimeMs ?? 0,
      text,
      scope: ref.scope,
      project: ref.project,
    })
  }
  return out
}

/** Write an entry page atomically and return its absolute path. */
export function writeItemPage(root: string, entry: MemoryEntry, projectRoot?: string | null): string {
  const file = entryPathFor(root, entry, projectRoot)
  writeFileAtomic(file, pageToText(entry))
  return file
}

/** Delete an entry page. */
export function deleteItemPage(file: string | undefined | null): boolean {
  if (!file) return false
  return removeFileIfExists(file)
}

/** Regenerate the human-readable `index.md` navigation page. */
export function regenerateIndex(root: string, entries: MemoryEntry[]): void {
  const registry = readProjectsRegistry(root)
  const pathOf = (entry: MemoryEntry): string =>
    entryPathFor(root, entry, entry.scope === 'project' ? (registry[sanitizeProjectKey(entry.project)] ?? null) : null)
  const active = entries.filter((entry) => entry.status === 'active')
  const lines: string[] = []
  lines.push('# Long-term memory — index')
  lines.push('')
  lines.push('Generated by dsh-llm-memory. Do not edit by hand.')
  lines.push('')
  lines.push('## Summary')
  lines.push(`- entries: ${entries.length}, active: ${active.length}`)
  lines.push('')
  for (const kind of MEMORY_KINDS) {
    const list = active.filter((entry) => entry.kind === kind)
    if (list.length === 0) continue
    lines.push(`## ${kind} (${list.length})`)
    lines.push('')
    for (const entry of list) {
      const file = pathOf(entry)
      const rel = relative(join(root, 'index.md'), file).replace(/\\/g, '/')
      const tierMark = entry.tier === 'immutable' ? ' [immutable]' : entry.tier === 'important' ? ' [!]' : ''
      const first = entry.text.split(/\r?\n/, 1)[0]?.trim() ?? ''
      const preview = first.length > 90 ? `${first.slice(0, 90)}…` : first
      lines.push(`- [${entry.title}](${rel})${tierMark} — ${preview}`)
    }
    lines.push('')
  }
  writeFileAtomic(join(root, 'index.md'), lines.join('\n'))
  appendLog(root, 'index', `${entries.length} entries`)
}

export interface BuildGraphOptions {
  overlapMinCommonWords?: number
  overlapMinScore?: number
  maxDfRatio?: number
  /**
   * Tags shared by more than this share of entries link nothing. A tag that
   * marks every imported entry (`dsh-memory`) carries no information, while a
   * topical tag (`plasma-keyboard`) still does.
   */
  tagMaxDfRatio?: number
  /** Minimum number of shared tags behind one tag-based edge. */
  minCommonTags?: number
  /** Maximum number of tag-based `related` edges per entry. */
  maxTagLinksPerEntry?: number
}

/**
 * Build the heuristic knowledge graph: entries are nodes, edges come from
 * supersede/related fields, `depends` for decision/architecture → fact/concept
 * links, `related` for entries sharing a topical tag, and `contradicts` from
 * significant lexical overlap of active entries.
 *
 * The tag pass matters for imported stores: `dsh-memory`/kilo rows carry no
 * relation fields at all, so their curated tags are the only topical signal
 * available. Tags that are too common to mean anything are dropped, and the
 * per-entry cap keeps the rendered graph readable instead of a clique.
 */
export function buildGraph(entries: MemoryEntry[], options: BuildGraphOptions = {}): MemoryGraph {
  const entities: MemoryGraphEntity[] = entries.map((entry) => ({
    id: entry.id,
    kind: entry.kind,
    name: entry.title,
    scope: entry.scope,
    project: entry.project,
  }))

  const ids = new Set(entries.map((entry) => entry.id))
  const edges: MemoryGraphEdge[] = []
  const seen = new Set<string>()
  const pushEdge = (source: string, target: string, type: MemoryEdgeType, weight = 1): void => {
    const key = `${source}|${target}|${type}`
    if (seen.has(key)) return
    seen.add(key)
    edges.push({ source, target, type, weight })
  }

  for (const entry of entries) {
    for (const replacedId of entry.supersedes) {
      if (ids.has(replacedId)) pushEdge(entry.id, replacedId, 'supersedes')
    }
    for (const replacedById of entry.supersededBy) {
      if (ids.has(replacedById)) pushEdge(replacedById, entry.id, 'supersedes')
    }
  }

  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  const relatedPairs = new Set<string>()
  for (const entry of entries) {
    for (const relatedId of entry.related) {
      const target = byId.get(relatedId)
      if (!target) continue
      const depends =
        (entry.kind === 'decisions' || entry.kind === 'architecture') &&
        (target.kind === 'facts' || target.kind === 'concepts')
      if (depends) {
        pushEdge(entry.id, relatedId, 'depends')
        continue
      }
      const pair = entry.id < relatedId ? `${entry.id}|${relatedId}` : `${relatedId}|${entry.id}`
      if (relatedPairs.has(pair)) continue
      relatedPairs.add(pair)
      pushEdge(entry.id, relatedId, 'related')
    }
  }

  // Tag-based relatedness. Foreign stores imported into this plugin carry no
  // relation fields, so their tags are the only topical signal: two entries
  // sharing a tag are related. A tag is only used while it is selective enough
  // to mean something (see `tagMaxDfRatio`), and every entry keeps at most
  // `maxTagLinksPerEntry` such edges — strongest (most shared tags) first.
  const tagMaxDf = Math.max(3, Math.ceil((options.tagMaxDfRatio ?? 0.5) * Math.max(1, entries.length)))
  const minCommonTags = Math.max(1, Math.floor(options.minCommonTags ?? 1))
  const maxTagLinks = Math.max(1, Math.floor(options.maxTagLinksPerEntry ?? 6))
  const tagsOf = new Map<string, string[]>()
  const tagDf = new Map<string, number>()
  for (const entry of entries) {
    const unique = [
      ...new Set(entry.tags.map((tag) => tag.trim().toLowerCase()).filter((tag) => tag.length > 0)),
    ]
    tagsOf.set(entry.id, unique)
    for (const tag of unique) tagDf.set(tag, (tagDf.get(tag) ?? 0) + 1)
  }
  const entriesByTag = new Map<string, string[]>()
  for (const entry of entries) {
    for (const tag of tagsOf.get(entry.id) ?? []) {
      const count = tagDf.get(tag) ?? 0
      if (count < 2 || count > tagMaxDf) continue
      const list = entriesByTag.get(tag)
      if (list) list.push(entry.id)
      else entriesByTag.set(tag, [entry.id])
    }
  }
  const tagPairWeights = new Map<string, { left: string; right: string; weight: number }>()
  for (const ids of entriesByTag.values()) {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const first = ids[i]!
        const second = ids[j]!
        const left = first < second ? first : second
        const right = first < second ? second : first
        const key = `${left}|${right}`
        const pair = tagPairWeights.get(key)
        if (pair) pair.weight++
        else tagPairWeights.set(key, { left, right, weight: 1 })
      }
    }
  }
  const tagDegree = new Map<string, number>()
  const rankedTagPairs = [...tagPairWeights.values()]
    .filter((pair) => pair.weight >= minCommonTags)
    .sort((a, b) => b.weight - a.weight || a.left.localeCompare(b.left) || a.right.localeCompare(b.right))
  for (const pair of rankedTagPairs) {
    const key = `${pair.left}|${pair.right}`
    if (relatedPairs.has(key)) continue
    const leftDegree = tagDegree.get(pair.left) ?? 0
    const rightDegree = tagDegree.get(pair.right) ?? 0
    if (leftDegree >= maxTagLinks || rightDegree >= maxTagLinks) continue
    tagDegree.set(pair.left, leftDegree + 1)
    tagDegree.set(pair.right, rightDegree + 1)
    relatedPairs.add(key)
    pushEdge(pair.left, pair.right, 'related', pair.weight)
  }

  const active = entries.filter((entry) => entry.status === 'active')
  const overlapOptions: OverlapOptions = {
    minCommonWords: Math.max(1, Math.floor(options.overlapMinCommonWords ?? 3)),
    minScore: options.overlapMinScore ?? 0.45,
    ...(options.maxDfRatio !== undefined ? { maxDfRatio: options.maxDfRatio } : {}),
  }
  for (const pair of significantOverlapPairs(active, overlapOptions)) {
    pushEdge(pair.a.id, pair.b.id, 'contradicts', Math.round(pair.score * 100))
  }

  return { entities, edges }
}

/** Decode a page on disk; exported for importers that walk foreign stores. */
export function decodePage(page: PageOnDisk): MemoryEntry | null {
  const entry = entryFromPage(page.text, { scope: page.scope, project: page.project })
  if (!entry) return null
  entry.scope = page.scope
  entry.project = page.project
  return entry
}
