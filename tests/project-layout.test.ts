import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { MemoryEngine } from '../src/core/engine'
import {
  PROJECTS_FILE,
  USER_DIR,
  entryFileName,
  projectMemoryRoot,
  projectsRegistryPath,
  readProjectsRegistry,
  upsertProjectRoot,
  writeProjectsRegistry,
} from '../src/core/paths'
import { MemoryStore } from '../src/core/store'
import { cleanupRoot, makeTempRoot } from './helpers'

/** Absolute path of an entry page inside a project repository. */
function projectPagePath(projectRoot: string, entry: { id: string; kind: string; title: string }): string {
  return join(projectMemoryRoot(projectRoot), entry.kind, entryFileName(entry))
}

describe('paths: project registry', () => {
  let root: string

  beforeEach(() => {
    root = makeTempRoot('dsh-layout-paths-')
  })

  afterEach(() => {
    cleanupRoot(root)
  })

  it('builds the project memory directory', () => {
    expect(projectMemoryRoot('/repo/proj')).toBe(join('/repo/proj', '.dsh', 'llm-memory'))
  })

  it('writes and reads projects.json round-trip', () => {
    upsertProjectRoot(root, 'proj', '/repos/proj')
    upsertProjectRoot(root, 'other', '/repos/other')
    expect(existsSync(projectsRegistryPath(root))).toBe(true)
    expect(projectsRegistryPath(root).endsWith(PROJECTS_FILE)).toBe(true)
    expect(readProjectsRegistry(root)).toEqual({ proj: '/repos/proj', other: '/repos/other' })
  })

  it('sorts registry keys and drops invalid entries', () => {
    writeProjectsRegistry(root, { zeta: '/z', alpha: '/a', empty: '' })
    const text = readFileSync(projectsRegistryPath(root), 'utf8')
    expect(text.indexOf('alpha')).toBeLessThan(text.indexOf('zeta'))
    expect(readProjectsRegistry(root)).toEqual({ alpha: '/a', zeta: '/z' })
  })
})

describe('project memory layout', () => {
  let globalRoot: string
  let projectRoot: string
  let engine: MemoryEngine

  beforeEach(() => {
    globalRoot = makeTempRoot('dsh-layout-global-')
    projectRoot = makeTempRoot('dsh-layout-project-')
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

  it('writes project pages into the repository and user pages into _user', () => {
    const projectEntry = engine.save({ text: 'Project fact body.', title: 'Project fact' })
    const userEntry = engine.save({ text: 'User preference body.', title: 'User preference', scope: 'user' })

    const projectFile = projectPagePath(projectRoot, projectEntry)
    expect(existsSync(projectFile)).toBe(true)
    expect(existsSync(join(globalRoot, 'myproj', projectEntry.kind, entryFileName(projectEntry)))).toBe(false)

    expect(existsSync(join(globalRoot, USER_DIR, userEntry.kind, entryFileName(userEntry)))).toBe(true)
    expect(projectEntry.project).toBe('myproj')
    expect(userEntry.project).toBe('')

    expect(readProjectsRegistry(globalRoot)).toEqual({ myproj: projectRoot })
  })

  it('regularizes the project root through registerProject()', () => {
    const otherRoot = makeTempRoot('dsh-layout-other-')
    try {
      engine.registerProject('other', otherRoot)
      const entry = engine.save({ text: 'Other body.', title: 'Other fact', project: 'other' })
      expect(existsSync(projectPagePath(otherRoot, entry))).toBe(true)
      expect(engine.resolveProjectRoot('other')).toBe(otherRoot)
    } finally {
      cleanupRoot(otherRoot)
    }
  })

  it('deletes a project page from the repository on delete()', () => {
    const entry = engine.save({ text: 'Delete me body.', title: 'Delete me' })
    const file = projectPagePath(projectRoot, entry)
    expect(existsSync(file)).toBe(true)

    expect(engine.delete(entry.id)).toBe(true)
    expect(existsSync(file)).toBe(false)
    expect(engine.get(entry.id)).toBeNull()
  })

  it('reindexes project and user pages from disk', () => {
    const projectEntry = engine.save({ text: 'Project body.', title: 'Project' })
    const userEntry = engine.save({ text: 'User body.', title: 'User', scope: 'user' })
    engine.close()

    const fresh = new MemoryStore({ storageRoot: globalRoot })
    try {
      expect(fresh.reindexFromDisk()).toBe(2)
      expect(fresh.get(projectEntry.id)).toMatchObject({ project: 'myproj', scope: 'project' })
      expect(fresh.get(userEntry.id)).toMatchObject({ scope: 'user', project: '' })

      const db = new DatabaseSync(fresh.dbPath)
      try {
        const row = db.prepare('SELECT path FROM memories WHERE id = ?').get(projectEntry.id) as
          | { path?: string }
          | undefined
        expect(row?.path).toBe(projectPagePath(projectRoot, projectEntry))
      } finally {
        db.close()
      }
    } finally {
      fresh.close()
    }
  })

  it('keeps lint and graph working across split storage', () => {
    const projectEntry = engine.save({ text: 'Shared alpha beta gamma.', title: 'Project', kind: 'facts' })
    const userEntry = engine.save({
      text: 'Shared alpha beta gamma.',
      title: 'Preference',
      scope: 'user',
      kind: 'preferences',
      related: [projectEntry.id],
    })

    expect(engine.lintReport().totalCount).toBe(2)
    expect(engine.lintReport().brokenLinks).toHaveLength(0)
    const entities = engine.graph().entities.map((entity) => entity.id)
    expect(entities).toContain(projectEntry.id)
    expect(entities).toContain(userEntry.id)
  })

  it('falls back to the global directory when the project has no known root', () => {
    const fallbackRoot = makeTempRoot('dsh-layout-fallback-')
    const fallback = new MemoryEngine({ storageRoot: fallbackRoot, project: 'unknown-proj' })
    try {
      const entry = fallback.save({ text: 'Fallback body.', title: 'Fallback fact' })
      expect(existsSync(join(fallbackRoot, 'unknown-proj', entry.kind, entryFileName(entry)))).toBe(true)
      expect(readProjectsRegistry(fallbackRoot)).toEqual({})
    } finally {
      fallback.close()
      cleanupRoot(fallbackRoot)
    }
  })
})
