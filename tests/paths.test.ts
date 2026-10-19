import { chmodSync, existsSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  NO_CWD_KEY,
  USER_DIR,
  entryFileName,
  entryFilePath,
  fileMtimeMs,
  fileStatInfo,
  isPathInside,
  projectKeyFromCwd,
  readFileIfExists,
  removeFileIfExists,
  resolveStoragePaths,
  resolveStorageRoot,
  safeJoin,
  sanitizeProjectKey,
  scopeDir,
  titleSlug,
  writeFileAtomic,
} from '@llm-memory/core/layout/paths'
import { cleanupRoot, makeTempRoot } from './helpers'

describe('paths', () => {
  const envBackup = process.env['DSH_HOME']

  afterEach(() => {
    if (envBackup === undefined) delete process.env['DSH_HOME']
    else process.env['DSH_HOME'] = envBackup
  })

  it('resolves the storage root from override, DSH_HOME and home dir', () => {
    process.env['DSH_HOME'] = '/tmp/dsh-home'
    expect(resolveStorageRoot()).toBe(join('/tmp/dsh-home', 'llm-memory'))
    expect(resolveStorageRoot('/tmp/custom')).toBe('/tmp/custom')
    delete process.env['DSH_HOME']
    expect(resolveStorageRoot()).toContain('.dsh')
  })

  it('sanitizes a project key from cwd basename', () => {
    expect(projectKeyFromCwd('/home/user/my project!')).toBe('my-project')
    expect(projectKeyFromCwd('C:\\work\\tv2.local\\')).toBe('tv2.local')
    expect(projectKeyFromCwd()).toBe(NO_CWD_KEY)
    expect(projectKeyFromCwd('///')).toBe(NO_CWD_KEY)
  })

  it('keeps the no-cwd placeholder stable when sanitized again', () => {
    expect(sanitizeProjectKey(NO_CWD_KEY)).toBe(NO_CWD_KEY)
    expect(sanitizeProjectKey('')).toBe(NO_CWD_KEY)
    expect(projectKeyFromCwd(sanitizeProjectKey(NO_CWD_KEY))).toBe(NO_CWD_KEY)
    expect(scopeDir('/tmp/root', 'project', NO_CWD_KEY)).toBe(join('/tmp/root', NO_CWD_KEY))
  })

  it('slugs titles keeping unicode letters', () => {
    expect(titleSlug('Use node:sqlite for the index')).toBe('use-node-sqlite-for-the-index')
    expect(titleSlug('Правила проекта')).toBe('правила-проекта')
    expect(titleSlug('!!!')).toBe('untitled')
  })

  it('builds entry file names (kind is a directory) and paths', () => {
    expect(entryFileName({ id: 'm_abc123', title: 'Hello World' })).toBe('hello-world-m_abc123.md')
    const root = '/tmp/root'
    expect(entryFilePath(root, { id: 'm_1', kind: 'facts', title: 'x', scope: 'user', project: '' })).toBe(
      join(root, USER_DIR, 'facts', 'x-m_1.md'),
    )
    expect(entryFilePath(root, { id: 'm_1', kind: 'facts', title: 'x', scope: 'project', project: 'proj' })).toBe(
      join(root, 'proj', 'facts', 'x-m_1.md'),
    )
    expect(scopeDir(root, 'project', 'a b')).toBe(join(root, 'a-b'))
  })

  it('resolves storage paths', () => {
    const paths = resolveStoragePaths('/tmp/root')
    expect(paths.dbPath).toBe(join('/tmp/root', '_db', 'memory.db'))
    expect(paths.userDir).toBe(join('/tmp/root', USER_DIR))
  })

  it('refuses paths escaping the base directory', () => {
    expect(isPathInside('/tmp/root', '/tmp/root/a.md')).toBe(true)
    expect(isPathInside('/tmp/root', '/tmp/other/a.md')).toBe(false)
    expect(() => safeJoin('/tmp/root', '../escape.md')).toThrow()
  })

  it('writes, reads and removes files atomically', () => {
    const root = makeTempRoot()
    try {
      const file = join(root, 'nested', 'page.md')
      writeFileAtomic(file, 'hello')
      expect(existsSync(file)).toBe(true)
      expect(readFileIfExists(file)).toBe('hello')
      expect(removeFileIfExists(file)).toBe(true)
      expect(removeFileIfExists(file)).toBe(false)
      expect(readFileIfExists(file)).toBeNull()
    } finally {
      cleanupRoot(root)
    }
  })

  it('treats a missing file, a directory and an unreadable file as absent', () => {
    const root = makeTempRoot()
    try {
      expect(readFileIfExists(join(root, 'nope.md'))).toBeNull()
      expect(readFileIfExists(root)).toBeNull()

      const locked = join(root, 'locked.md')
      writeFileAtomic(locked, 'secret')
      chmodSync(locked, 0o000)
      try {
        expect(readFileIfExists(locked)).toBeNull()
      } finally {
        chmodSync(locked, 0o600)
      }
    } finally {
      cleanupRoot(root)
    }
  })

  it('stats size and mtime in one call and reports missing files as null', () => {
    const root = makeTempRoot()
    try {
      const file = join(root, 'page.md')
      writeFileAtomic(file, 'héllo')
      const info = fileStatInfo(file)
      expect(info).not.toBeNull()
      expect(info?.size).toBe(Buffer.byteLength('héllo', 'utf8'))
      expect(info?.mtimeMs).toBeGreaterThan(0)
      expect(fileMtimeMs(file)).toBe(info?.mtimeMs)
      expect(fileStatInfo(join(root, 'missing.md'))).toBeNull()
      expect(fileMtimeMs(join(root, 'missing.md'))).toBe(0)
    } finally {
      cleanupRoot(root)
    }
  })
})
