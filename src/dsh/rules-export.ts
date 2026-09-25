/**
 * "Export rules" action: copy the rule files (by default the bundled English
 * translation, or the original Kilo files) into the dsh global instruction file
 * inside an idempotent, marker-delimited managed block.
 *
 * Sources are read strictly read-only; nothing under the Kilo config is ever
 * modified. The only write target is `$DSH_HOME/AGENTS.md`.
 *
 * @module dsh-llm-memory/dsh/rules-export
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { MemoryConfig } from '../core/config.js'
import { DSH_HOME_ENV, readFileIfExists, writeFileAtomic } from '../core/paths.js'

/** Markers delimiting the managed block inside `$DSH_HOME/AGENTS.md`. */
export const RULES_BLOCK_BEGIN = '<!-- BEGIN llm-memory-kilo-rules -->'
/** @see RULES_BLOCK_BEGIN */
export const RULES_BLOCK_END = '<!-- END llm-memory-kilo-rules -->'

/** Rule file names probed in every discovered Kilo config directory. */
export const RULE_FILE_NAMES = ['AGENTS.md', 'immutable-rules.md'] as const

/** Bundled translation exports the canonical AGENTS.md only; Kilo verbatim keeps both files. */
const BUNDLED_RULE_FILE_NAMES = ['AGENTS.md'] as const

/** Label prefix shown for sources read from the bundled English translation. */
const BUNDLED_LABEL_PREFIX = 'bundled-en'

/** Module URL the bundled `rules/en/` files are resolved against. */
const BUNDLED_RULES_BASE = import.meta.url

/** One resolved rules source file. */
export interface RulesSource {
  path: string
  content: string
}

/** Result of an export attempt. */
export interface RulesExportResult {
  target: string
  sources: string[]
  bytes: number
  changed: boolean
  /** True when the target now holds exactly the managed block for the sources. */
  alreadyExported: boolean
  /** Human-readable English note (for example when no sources were found). */
  message?: string
}

/** How the managed block would be placed into `$DSH_HOME/AGENTS.md`. */
export type RulesExportMode = 'create' | 'replace' | 'append'

/** One resolved rules source with its byte size, as shown in a preview. */
export interface RulesPreviewSource {
  path: string
  bytes: number
}

/** Read-only preview of a rules export: what would change and where. */
export interface RulesPreview {
  target: string
  sources: RulesPreviewSource[]
  /** Managed block that would be written (empty when no source exists). */
  block: string
  /** Current content of the target file (empty string when missing). */
  currentContent: string
  mode: RulesExportMode
  /** True when applying the block would modify the target file. */
  changed: boolean
  /**
   * True when the target file already contains a managed block that matches the
   * current sources exactly (after line-ending / trailing-whitespace
   * normalization). Nothing would change on export.
   */
  alreadyExported: boolean
  /** Human-readable English note (for example when no sources were found). */
  message?: string
}

/** Priority used to keep AGENTS.md before immutable-rules.md in the block. */
function sourceRank(path: string): number {
  const name = basename(path).toLowerCase()
  if (name === 'agents.md') return 0
  if (name === 'immutable-rules.md') return 1
  return 2
}

/** Resolve a candidate path into a config directory when it is a directory. */
function asConfigDirectory(path: string): string | null {
  try {
    return statSync(path).isDirectory() ? resolve(path) : null
  } catch {
    return null
  }
}

/** Resolve a candidate path into an existing rule file when it is a file. */
function asRuleFile(path: string): string | null {
  try {
    return statSync(path).isFile() ? resolve(path) : null
  } catch {
    return null
  }
}

/** List the user directories under `/mnt/<drive>/Users` (WSL reaching Windows). */
function wslUserDirs(): string[] {
  const out: string[] = []
  for (const drive of ['c', 'd', 'e', 'f']) {
    const usersDir = `/mnt/${drive}/Users`
    if (!existsSync(usersDir)) continue
    try {
      for (const entry of readdirSync(usersDir, { withFileTypes: true })) {
        if (entry.isDirectory()) out.push(join(usersDir, entry.name))
      }
    } catch {
      /* unreadable mount: skip */
    }
  }
  return out
}

/** Auto-detected Kilo config directories (native HOME, WSL, Windows). */
function autoConfigDirs(): string[] {
  const dirs: string[] = [join(homedir(), '.config', 'kilo')]
  const profile = (process.env['USERPROFILE'] ?? '').trim()
  if (profile.length > 0) dirs.push(join(profile, '.config', 'kilo'))
  if (process.platform === 'linux') {
    for (const userDir of wslUserDirs()) dirs.push(join(userDir, '.config', 'kilo'))
  }
  return dirs
}

/** Split explicit `importRoots` entries into existing files and directories. */
function explicitRulePaths(config: MemoryConfig): { files: string[]; dirs: string[] } {
  const files: string[] = []
  const dirs: string[] = []
  for (const raw of config.importRoots ?? []) {
    if (typeof raw !== 'string' || raw.trim().length === 0) continue
    const candidate = resolve(raw.trim())
    const file = asRuleFile(candidate)
    if (file) {
      files.push(file)
      continue
    }
    const dir = asConfigDirectory(candidate)
    if (dir) dirs.push(dir)
  }
  return { files, dirs }
}

/** Options for resolving rule sources (a seam for the bundled English base). */
export interface ResolveRuleSourcesOptions {
  /**
   * Module URL the bundled `rules/en/` files are resolved against. Defaults to
   * this module, so `../../rules/en/<name>` points inside the package.
   */
  bundledBase?: string | URL
}

/** Absolute path of one bundled English rule file, or null when it cannot be built. */
function bundledRuleFile(name: string, base: string | URL): string | null {
  try {
    return fileURLToPath(new URL(`../../rules/en/${name}`, base))
  } catch {
    return null
  }
}

/**
 * Read the bundled English canonical AGENTS.md. The separate immutable source
 * remains available to `kilo-verbatim` exports, but is not duplicated into the
 * bundled managed block.
 */
function resolveBundledRuleSources(base: string | URL): RulesSource[] {
  const sources: RulesSource[] = []
  for (const name of BUNDLED_RULE_FILE_NAMES) {
    const file = bundledRuleFile(name, base)
    if (file === null) continue
    const content = readFileIfExists(file)
    if (content === null) continue
    sources.push({ path: `${BUNDLED_LABEL_PREFIX}:${name}`, content })
  }
  return sources
}

/**
 * Resolve the Kilo rule files that exist on this machine, read-only.
 *
 * Explicit `config.importRoots` are always honoured (a config directory or a
 * file directly). Auto-detection of the native `$HOME`, WSL
 * `/mnt/<drive>/Users/*` and Windows `%USERPROFILE%` roots runs unless
 * `config.importAutoDetect` is `false`. The result keeps `AGENTS.md` before
 * `immutable-rules.md`.
 */
function resolveKiloRuleSources(config: MemoryConfig): RulesSource[] {
  const files: string[] = []
  const seen = new Set<string>()
  const addFile = (file: string | null): void => {
    if (!file || seen.has(file)) return
    seen.add(file)
    files.push(file)
  }

  const explicit = explicitRulePaths(config)
  for (const file of explicit.files) addFile(file)
  for (const dir of explicit.dirs) {
    for (const name of RULE_FILE_NAMES) addFile(asRuleFile(join(dir, name)))
  }

  if (config.importAutoDetect) {
    for (const dir of autoConfigDirs()) {
      for (const name of RULE_FILE_NAMES) addFile(asRuleFile(join(dir, name)))
    }
  }

  const ordered = [...files].sort((a, b) => sourceRank(a) - sourceRank(b))
  const sources: RulesSource[] = []
  for (const file of ordered) {
    const content = readFileIfExists(file)
    if (content === null) continue
    sources.push({ path: file, content })
  }
  return sources
}

/**
 * Resolve the rule sources for the export action.
 *
 * `config.rulesSource === 'bundled-en'` (the default) reads the canonical
 * English translation shipped in this package, labelled `bundled-en:AGENTS.md`.
 * `'kilo-verbatim'` resolves the original Kilo files on this machine, honouring
 * explicit `importRoots` and optional auto-detection. Nothing under the Kilo
 * config is ever modified.
 */
export function resolveRuleSources(
  config: MemoryConfig,
  options: ResolveRuleSourcesOptions = {},
): RulesSource[] {
  if (config.rulesSource === 'kilo-verbatim') return resolveKiloRuleSources(config)
  return resolveBundledRuleSources(options.bundledBase ?? BUNDLED_RULES_BASE)
}

/** English note explaining why no rule sources were resolved. */
function noRuleSourcesMessage(config: MemoryConfig): string {
  if (config.rulesSource === 'kilo-verbatim') {
    return 'No Kilo rule sources were found. Checked the native HOME, WSL/Windows Kilo config roots and config.importRoots.'
  }
  return 'The bundled English canonical rules file is missing from the package (rules/en/AGENTS.md).'
}

/** Build the managed block body for the resolved sources. */
export function buildRulesBlock(sources: readonly RulesSource[]): string {
  const lines: string[] = [
    RULES_BLOCK_BEGIN,
    '<!-- Generated by dsh-llm-memory from the Kilo rule files below. Do not edit this block by hand. -->',
  ]
  for (const source of sources) {
    lines.push('', `### Kilo source: ${source.path}`, '', source.content.trim())
  }
  lines.push('', RULES_BLOCK_END)
  return lines.join('\n')
}

/**
 * Normalize a managed block before comparison: unify line endings (`\r\n`/`\r`
 * to `\n`), drop trailing blanks at the end of every line and drop the
 * leading/trailing blank lines. Content differences inside a line are kept.
 */
export function normalizeRulesBlock(text: string): string {
  return text
    .replace(/\r\n?/gu, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/u, ''))
    .join('\n')
    .replace(/^\n+/u, '')
    .replace(/\n+$/u, '')
}

/** Extract the managed block (`BEGIN`..`END` inclusive) or `null` when absent. */
function extractManagedBlock(content: string): string | null {
  const begin = content.indexOf(RULES_BLOCK_BEGIN)
  if (begin === -1) return null
  const end = content.indexOf(RULES_BLOCK_END, begin)
  if (end === -1) return null
  return content.slice(begin, end + RULES_BLOCK_END.length)
}

/** Count complete managed blocks (`BEGIN`..`END`) present in `content`. */
function countManagedBlocks(content: string): number {
  let count = 0
  let cursor = 0
  while (true) {
    const begin = content.indexOf(RULES_BLOCK_BEGIN, cursor)
    if (begin === -1) break
    const end = content.indexOf(RULES_BLOCK_END, begin)
    if (end === -1) break
    count += 1
    cursor = end + RULES_BLOCK_END.length
  }
  return count
}

/** Drop every managed block from `content`, keeping all other text untouched. */
export function stripManagedBlocks(content: string): string {
  let out = ''
  let cursor = 0
  while (true) {
    const begin = content.indexOf(RULES_BLOCK_BEGIN, cursor)
    if (begin === -1) {
      out += content.slice(cursor)
      break
    }
    out += content.slice(cursor, begin)
    const end = content.indexOf(RULES_BLOCK_END, begin)
    if (end === -1) {
      out += content.slice(begin)
      break
    }
    cursor = end + RULES_BLOCK_END.length
  }
  return out
}

/** True when `content` holds exactly one managed block matching `block`. */
function blockMatches(content: string, block: string): boolean {
  const extracted = extractManagedBlock(content)
  if (extracted === null) return false
  // Duplicated blocks never count as "already exported": they must be collapsed.
  if (countManagedBlocks(content) !== 1) return false
  return normalizeRulesBlock(extracted) === normalizeRulesBlock(block)
}

/**
 * Replace every managed block inside `existing` with a single `block`.
 *
 * Any previous duplicates are collapsed into one block placed where the first
 * block used to be; every byte outside the blocks is preserved (leading and
 * trailing blank lines around the block are normalized).
 */
export function applyManagedBlock(existing: string, block: string): string {
  const begin = existing.indexOf(RULES_BLOCK_BEGIN)
  let head: string
  let tail: string
  if (begin === -1) {
    head = existing.replace(/\s+$/u, '')
    tail = ''
  } else {
    head = existing.slice(0, begin).replace(/\s+$/u, '')
    const firstEnd = existing.indexOf(RULES_BLOCK_END, begin)
    const rest = firstEnd === -1 ? '' : existing.slice(firstEnd + RULES_BLOCK_END.length)
    tail = stripManagedBlocks(rest).replace(/^\s+/u, '')
  }
  const parts: string[] = []
  if (head.length > 0) parts.push(head)
  parts.push(block)
  if (tail.length > 0) parts.push(tail)
  return `${parts.join('\n\n').replace(/\s+$/u, '')}\n`
}

/** Resolve the dsh home directory (`$DSH_HOME`, else `~/.dsh`). */
export function resolveDshHome(): string {
  const fromEnv = (process.env[DSH_HOME_ENV] ?? '').trim()
  return fromEnv.length > 0 ? resolve(fromEnv) : resolve(join(homedir(), '.dsh'))
}

/**
 * Build a read-only preview of the rules export: the target path, the sources
 * that would be embedded with their byte sizes, the managed block and how the
 * target file would change (`create`, `replace` or `append`).
 *
 * Nothing is written to disk and the rule sources are only read.
 */
export function previewRulesExport(
  config: MemoryConfig,
  options: ResolveRuleSourcesOptions = {},
): RulesPreview {
  const target = join(resolveDshHome(), 'AGENTS.md')
  const sources = resolveRuleSources(config, options)
  const existing = readFileIfExists(target)
  const currentContent = existing ?? ''
  const hasBlock =
    currentContent.includes(RULES_BLOCK_BEGIN) && currentContent.includes(RULES_BLOCK_END)
  const mode: RulesExportMode = hasBlock
    ? 'replace'
    : existing !== null && currentContent.trim().length > 0
      ? 'append'
      : 'create'

  if (sources.length === 0) {
    return {
      target,
      sources: [],
      block: '',
      currentContent,
      mode,
      changed: false,
      alreadyExported: false,
      message: noRuleSourcesMessage(config),
    }
  }

  const block = buildRulesBlock(sources)
  const next = applyManagedBlock(currentContent, block)
  return {
    target,
    sources: sources.map((source) => ({
      path: source.path,
      bytes: Buffer.byteLength(source.content, 'utf8'),
    })),
    block,
    currentContent,
    mode,
    changed: next !== currentContent,
    alreadyExported: blockMatches(currentContent, block),
  }
}

/**
 * Write the managed rules block into `$DSH_HOME/AGENTS.md`, idempotently:
 * a repeated call rewrites the same block and never duplicates it, and any
 * unrelated content already present in the file is preserved.
 *
 * @returns the export report; `changed:false` with an English `message` when no
 *   rule source exists.
 */
export function exportRulesToDshAgents(
  config: MemoryConfig,
  options: ResolveRuleSourcesOptions = {},
): RulesExportResult {
  const target = join(resolveDshHome(), 'AGENTS.md')
  const sources = resolveRuleSources(config, options)
  if (sources.length === 0) {
    return {
      target,
      sources: [],
      bytes: 0,
      changed: false,
      alreadyExported: false,
      message: noRuleSourcesMessage(config),
    }
  }

  const block = buildRulesBlock(sources)
  const existing = readFileIfExists(target) ?? ''
  const next = applyManagedBlock(existing, block)
  const changed = next !== existing
  if (changed) writeFileAtomic(target, next)

  return {
    target,
    sources: sources.map((source) => source.path),
    bytes: Buffer.byteLength(block, 'utf8'),
    changed,
    alreadyExported: blockMatches(next, block),
  }
}
