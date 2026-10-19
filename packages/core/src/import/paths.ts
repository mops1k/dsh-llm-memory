/**
 * Cross-environment discovery of foreign memory roots.
 *
 * Importers must work wherever the plugin runs (native Linux, WSL reaching a
 * Windows host, or native Windows) without scanning whole disks: only a fixed
 * set of well-known locations is probed, plus explicit `importRoots` from the
 * plugin config. Each candidate is validated by a cheap marker before use.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import { hasSqliteTable } from './common.js'

/** Options that control root discovery (mirrors the plugin config block). */
export interface ImportRootsOptions {
  /** Explicit root paths from the config; checked first and always trusted. */
  importRoots?: readonly string[]
  /** Master switch for auto-detection; individual toggles override it. */
  importAutoDetect?: boolean
  /** Probe `$HOME` locations (default: true). */
  detectNative?: boolean
  /** Probe `/mnt/<drive>/Users/*` locations (default: true on Linux). */
  detectWslWindows?: boolean
  /** Probe `%USERPROFILE%` / `%LOCALAPPDATA%` locations (default: true on Windows). */
  detectWindows?: boolean
}

/** Discovered roots grouped by the importer they belong to. */
export interface ImportRoots {
  kilo: string[]
  mnemon: string[]
  dshMemory: string[]
  /** Every discovered root, de-duplicated. */
  all: string[]
}

interface RootBuckets {
  kilo: string[]
  mnemon: string[]
  dshMemory: string[]
}

const DSH_MEMORY_HEADER = /^<!--\s*dsh-memory:/u

function emptyBuckets(): RootBuckets {
  return { kilo: [], mnemon: [], dshMemory: [] }
}

/** A Kilo root contains `memory/db/memory.db`. */
export function isKiloRoot(root: string): boolean {
  return existsSync(join(root, 'memory', 'db', 'memory.db'))
}

/** Absolute path of a Kilo memory database for a root. */
export function kiloMemoryDbPath(root: string): string {
  return join(root, 'memory', 'db', 'memory.db')
}

/** A mnemon root contains `data/<profile>/mnemon.db`. */
export function isMnemonRoot(root: string): boolean {
  return listMnemonDbPaths(root).length > 0
}

/** All `data/<profile>/mnemon.db` paths under a mnemon root. */
export function listMnemonDbPaths(root: string): string[] {
  const dataDir = join(root, 'data')
  const out: string[] = []
  try {
    for (const entry of readdirSync(dataDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const candidate = join(dataDir, entry.name, 'mnemon.db')
      if (existsSync(candidate)) out.push(candidate)
    }
  } catch {
    return []
  }
  return out.sort()
}

function directoryHasDshHeader(dir: string): boolean {
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue
      const text = readFileSync(join(dir, entry.name), 'utf8')
      const firstLine = text.split(/\r?\n/u, 1)[0]?.trim() ?? ''
      if (DSH_MEMORY_HEADER.test(firstLine)) return true
    }
  } catch {
    return false
  }
  return false
}

/** File name of the shared dsh-memory SQLite store. */
const DSH_MEMORY_DB_FILE = 'memory.db'

/**
 * Existing dsh-memory SQLite stores reachable from a root: `<root>/memory.db`
 * (the root *is* the store directory, e.g. `~/.dsh/memory`) and
 * `<root>/memory/memory.db` (the root is `$DSH_HOME`, e.g. `~/.dsh`). Both are
 * validated by the `memories` table so unrelated `memory.db` files are skipped.
 */
export function dshMemoryDbPaths(root: string): string[] {
  const candidates = [join(root, DSH_MEMORY_DB_FILE), join(root, 'memory', DSH_MEMORY_DB_FILE)]
  return candidates.filter((candidate) => hasSqliteTable(candidate, 'memories'))
}

/**
 * A dsh-memory root holds either the SQLite store (`memory.db` with a
 * `memories` table) or the legacy markdown pages with a JSON header
 * (`_user/*.md`, `<project>/*.md`).
 */
export function isDshMemoryRoot(root: string): boolean {
  if (dshMemoryDbPaths(root).length > 0) return true
  if (directoryHasDshHeader(join(root, '_user'))) return true
  try {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      if (entry.name === '_db' || entry.name.startsWith('.')) continue
      if (directoryHasDshHeader(join(root, entry.name))) return true
    }
  } catch {
    return false
  }
  return false
}

function unique(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const normalized = resolve(value)
    if (seen.has(normalized)) continue
    seen.add(normalized)
    out.push(normalized)
  }
  return out
}

function classifyExplicit(paths: readonly string[]): RootBuckets {
  const buckets = emptyBuckets()
  for (const raw of paths) {
    if (typeof raw !== 'string' || raw.trim().length === 0) continue
    const root = resolve(raw.trim())
    if (isKiloRoot(root)) buckets.kilo.push(root)
    if (isMnemonRoot(root)) buckets.mnemon.push(root)
    if (isDshMemoryRoot(root)) buckets.dshMemory.push(root)
  }
  return buckets
}

function dshHomeDir(): string {
  return (process.env['DSH_HOME'] ?? '').trim()
}

function nativeBuckets(): RootBuckets {
  const home = homedir()
  const buckets = emptyBuckets()
  buckets.kilo.push(join(home, '.config', 'kilo'))
  buckets.mnemon.push(join(home, '.mnemon'))
  buckets.dshMemory.push(join(home, '.dsh', 'memory'))
  buckets.dshMemory.push(join(home, '.dsh'))
  const dshHome = dshHomeDir()
  if (dshHome.length > 0) buckets.dshMemory.push(join(dshHome, 'memory'))
  return buckets
}

function wslWindowsBuckets(): RootBuckets {
  const buckets = emptyBuckets()
  for (const drive of ['c', 'd', 'e', 'f']) {
    const usersDir = `/mnt/${drive}/Users`
    if (!existsSync(usersDir)) continue
    let users: string[]
    try {
      users = readdirSync(usersDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
    } catch {
      continue
    }
    for (const user of users) {
      const userDir = join(usersDir, user)
      buckets.kilo.push(join(userDir, '.config', 'kilo'))
      buckets.mnemon.push(join(userDir, '.mnemon'))
      buckets.dshMemory.push(join(userDir, '.dsh', 'memory'))
      buckets.dshMemory.push(join(userDir, '.dsh'))
      const dshHome = join(userDir, 'AppData', 'Local', 'deepseek-harness-jetbrains', 'dsh-home')
      buckets.dshMemory.push(join(dshHome, 'memory'))
      buckets.dshMemory.push(dshHome)
    }
  }
  return buckets
}

function windowsBuckets(): RootBuckets {
  const buckets = emptyBuckets()
  const profile = (process.env['USERPROFILE'] ?? '').trim()
  if (profile.length > 0) {
    buckets.kilo.push(join(profile, '.config', 'kilo'))
    buckets.mnemon.push(join(profile, '.mnemon'))
    buckets.dshMemory.push(join(profile, '.dsh', 'memory'))
    buckets.dshMemory.push(join(profile, '.dsh'))
  }
  const localAppData = (process.env['LOCALAPPDATA'] ?? '').trim()
  if (localAppData.length > 0) {
    const dshHome = join(localAppData, 'deepseek-harness-jetbrains', 'dsh-home')
    buckets.dshMemory.push(join(dshHome, 'memory'))
    buckets.dshMemory.push(dshHome)
  }
  return buckets
}

function filterRoots(values: readonly string[], predicate: (root: string) => boolean): string[] {
  return unique(values).filter(predicate)
}

/** Discover Kilo roots (explicit config paths take priority). */
export function detectKiloRoots(options: ImportRootsOptions = {}): string[] {
  return detectAllRoots(options).kilo
}

/** Discover dsh-mnemon roots (explicit config paths take priority). */
export function detectMnemonRoots(options: ImportRootsOptions = {}): string[] {
  return detectAllRoots(options).mnemon
}

/** Discover dsh-memory roots (explicit config paths take priority). */
export function detectDshMemoryRoots(options: ImportRootsOptions = {}): string[] {
  return detectAllRoots(options).dshMemory
}

/**
 * Discover every known root, grouped by importer. Explicit `importRoots` are
 * classified by their markers and placed in front of the auto-detected ones.
 */
export function detectAllRoots(options: ImportRootsOptions = {}): ImportRoots {
  const explicit = classifyExplicit(options.importRoots ?? [])
  const auto = options.importAutoDetect ?? true
  const native = (options.detectNative ?? auto) ? nativeBuckets() : emptyBuckets()
  const wsl =
    (options.detectWslWindows ?? auto) && process.platform === 'linux' ? wslWindowsBuckets() : emptyBuckets()
  const win =
    (options.detectWindows ?? auto) && process.platform === 'win32' ? windowsBuckets() : emptyBuckets()

  const kilo = filterRoots([...explicit.kilo, ...native.kilo, ...wsl.kilo, ...win.kilo], isKiloRoot)
  const mnemon = filterRoots([...explicit.mnemon, ...native.mnemon, ...wsl.mnemon, ...win.mnemon], isMnemonRoot)
  const dshMemory = filterRoots(
    [...explicit.dshMemory, ...native.dshMemory, ...wsl.dshMemory, ...win.dshMemory],
    isDshMemoryRoot,
  )
  return { kilo, mnemon, dshMemory, all: unique([...kilo, ...mnemon, ...dshMemory]) }
}
