import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { MemoryEngine } from '../src/core/engine'
import { pageToText } from '../src/core/frontmatter'
import {
  USER_DIR,
  entryFileName,
  projectMemoryRoot,
  writeFileAtomic,
} from '../src/core/paths'
import { MemoryStore, newMemoryEntry } from '../src/core/store'
import { migrateFlatPages } from '../src/core/wiki'
import { cleanupRoot, makeTempRoot } from './helpers'

/** Flat `*.md` files directly inside a directory (the legacy layout). */
function flatMarkdown(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
      .map((entry) => entry.name)
  } catch {
    return []
  }
}

/** `path` column of an entry inside a store database. */
function storedPath(dbPath: string, id: string): string | undefined {
  const db = new DatabaseSync(dbPath)
  try {
    const row = db.prepare('SELECT path FROM memories WHERE id = ?').get(id) as { path?: string } | undefined
    return row?.path
  } finally {
    db.close()
  }
}

describe('kind subfolders: writes', () => {
  let globalRoot: string
  let projectRoot: string
  let engine: MemoryEngine

  beforeEach(() => {
    globalRoot = makeTempRoot('dsh-kind-global-')
    projectRoot = makeTempRoot('dsh-kind-project-')
    engine = new MemoryEngine({
      storageRoot: globalRoot,
      project: 'myproj',
      config: { projectRoots: { myproj: projectRoot } },
    })
  })

  afterEach(() => {
    engine.close()
    cleanupRoot(globalRoot)
    cleanupRoot(projectRoot)
  })

  it('writes project pages into <projectRoot>/.dsh/llm-memory/<kind>/', () => {
    const entry = engine.save({ text: 'A decision body.', title: 'Use tabs', kind: 'decisions' })
    const base = projectMemoryRoot(projectRoot)
    const file = join(base, 'decisions', entryFileName(entry))

    expect(existsSync(file)).toBe(true)
    expect(flatMarkdown(base)).toEqual([])
    expect(storedPath(engine.dbPath, entry.id)).toBe(file)
  })

  it('writes user pages into <root>/_user/<kind>/', () => {
    const entry = engine.save({ text: 'A preference body.', title: 'Prefer pnpm', kind: 'preferences', scope: 'user' })
    const userDir = join(globalRoot, USER_DIR)
    const file = join(userDir, 'preferences', entryFileName(entry))

    expect(existsSync(file)).toBe(true)
    expect(flatMarkdown(userDir)).toEqual([])
    expect(storedPath(engine.dbPath, entry.id)).toBe(file)
  })

  it('moves the page when update() changes the kind', () => {
    const entry = engine.save({ text: 'Body.', title: 'Move me', kind: 'facts' })
    const base = projectMemoryRoot(projectRoot)
    const before = join(base, 'facts', entryFileName(entry))
    const after = join(base, 'decisions', entryFileName(entry))
    expect(existsSync(before)).toBe(true)

    const updated = engine.update(entry.id, { kind: 'decisions' })

    expect(updated?.kind).toBe('decisions')
    expect(existsSync(before)).toBe(false)
    expect(existsSync(after)).toBe(true)
    expect(storedPath(engine.dbPath, entry.id)).toBe(after)
  })

  it('reindexes pages from the kind subfolders', () => {
    const projectEntry = engine.save({ text: 'Project body.', title: 'Project', kind: 'architecture' })
    const userEntry = engine.save({ text: 'User body.', title: 'User', kind: 'concepts', scope: 'user' })
    engine.close()

    const fresh = new MemoryStore({ storageRoot: globalRoot })
    try {
      expect(fresh.reindexFromDisk()).toBe(2)
      expect(fresh.get(projectEntry.id)).toMatchObject({ kind: 'architecture', project: 'myproj' })
      expect(fresh.get(userEntry.id)).toMatchObject({ kind: 'concepts', scope: 'user' })
    } finally {
      fresh.close()
    }
  })
})

describe('kind subfolders: flat-layout migration', () => {
  let root: string

  beforeEach(() => {
    root = makeTempRoot('dsh-kind-migrate-')
  })

  afterEach(() => {
    cleanupRoot(root)
  })

  it('migrates a flat page into its kind subfolder and is idempotent', () => {
    const userDir = join(root, USER_DIR)
    const entry = newMemoryEntry({ id: 'm_mig1', scope: 'user', kind: 'decisions', title: 'Migrate me', text: 'body' })
    const flat = join(userDir, 'migrate-me-m_mig1.md')
    writeFileAtomic(flat, pageToText(entry))

    const first = migrateFlatPages(root)
    expect(first.moved).toBe(1)
    expect(first.skipped).toBe(0)

    const moved = join(userDir, 'decisions', 'migrate-me-m_mig1.md')
    expect(existsSync(flat)).toBe(false)
    expect(existsSync(moved)).toBe(true)
    expect(flatMarkdown(userDir)).toEqual([])

    const second = migrateFlatPages(root)
    expect(second.moved).toBe(0)
    expect(second.skipped).toBe(0)
    expect(existsSync(moved)).toBe(true)
  })

  it('leaves a page without readable frontmatter in place', () => {
    const userDir = join(root, USER_DIR)
    const flat = join(userDir, 'no-frontmatter.md')
    writeFileAtomic(flat, 'plain text without frontmatter\n')

    const report = migrateFlatPages(root)
    expect(report.moved).toBe(0)
    expect(report.skipped).toBe(1)
    expect(existsSync(flat)).toBe(true)
  })

  it('migrates on startup and refreshes the stored path', () => {
    const userDir = join(root, USER_DIR)
    const entry = newMemoryEntry({ id: 'm_mig2', scope: 'user', kind: 'rules', title: 'Flat rule', text: 'body' })
    const flat = join(userDir, 'flat-rule-m_mig2.md')
    writeFileAtomic(flat, pageToText(entry))

    const store = new MemoryStore({ storageRoot: root })
    try {
      expect(store.get('m_mig2')?.kind).toBe('rules')
      const moved = join(userDir, 'rules', 'flat-rule-m_mig2.md')
      expect(existsSync(flat)).toBe(false)
      expect(existsSync(moved)).toBe(true)
      expect(storedPath(store.dbPath, 'm_mig2')).toBe(moved)
    } finally {
      store.close()
    }
  })
})
