/**
 * Cross-platform path policy for the memory store and the model cache.
 *
 * A stored `storageRoot` may be typed by hand on any platform (`~/memory`,
 * `%USERPROFILE%\memory`, `$HOME/memory`, a quoted path copied from Explorer),
 * so it has to be normalised before it reaches SQLite. The same helper rejects
 * paths the store cannot live on: a network share (WAL over 9p/SMB is broken,
 * spikes A1/A10) and a Windows absolute path on a non-Windows host.
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  isUncPath,
  normalizeStoragePath,
  resolveStorageRoot,
  windowsExtendedPath,
} from '@llm-memory/core/layout/paths'

describe('normalizeStoragePath', () => {
  it('expands the home shortcuts of both platforms', () => {
    expect(normalizeStoragePath('~/llm-memory')).toBe(join(homedir(), 'llm-memory'))
    expect(normalizeStoragePath('~\\llm-memory')).toBe(join(homedir(), 'llm-memory'))
    expect(normalizeStoragePath('~')).toBe(homedir())
  })

  it('expands environment variables in the Unix and the Windows form', () => {
    process.env.LLM_MEMORY_TEST_ROOT = join(homedir(), 'from-env')
    try {
      expect(normalizeStoragePath('$LLM_MEMORY_TEST_ROOT')).toBe(join(homedir(), 'from-env'))
      expect(normalizeStoragePath('${LLM_MEMORY_TEST_ROOT}/memory')).toBe(join(homedir(), 'from-env', 'memory'))
      expect(normalizeStoragePath('%LLM_MEMORY_TEST_ROOT%/memory')).toBe(join(homedir(), 'from-env', 'memory'))
    } finally {
      delete process.env.LLM_MEMORY_TEST_ROOT
    }
  })

  it('keeps unknown variables and spaces untouched and strips wrapping quotes', () => {
    expect(normalizeStoragePath('"C:\\My Memory\\x"')).toBe('C:\\My Memory\\x')
    expect(normalizeStoragePath('$LLM_MEMORY_NOT_SET/x')).toBe(join('$LLM_MEMORY_NOT_SET', 'x'))
  })
})

describe('isUncPath', () => {
  it('recognises Windows and POSIX network shares', () => {
    expect(isUncPath('\\\\wsl.localhost\\archlinux\\home')).toBe(true)
    expect(isUncPath('//server/share/memory')).toBe(true)
    expect(isUncPath('C:\\Users\\me\\memory')).toBe(false)
    expect(isUncPath('/home/me/memory')).toBe(false)
  })
})

describe('resolveStorageRoot', () => {
  it('normalises a configured root instead of resolving it literally', () => {
    process.env.LLM_MEMORY_TEST_ROOT = join(homedir(), 'root-from-env')
    try {
      expect(resolveStorageRoot('$LLM_MEMORY_TEST_ROOT')).toBe(join(homedir(), 'root-from-env'))
    } finally {
      delete process.env.LLM_MEMORY_TEST_ROOT
    }
  })

  it('refuses a network share before SQLite sees it', () => {
    expect(() => resolveStorageRoot('//server/share/memory')).toThrow(/UNC|local disk/)
    expect(() => resolveStorageRoot('\\\\server\\share\\memory')).toThrow(/UNC|local disk/)
  })
})

describe('windowsExtendedPath', () => {
  it('leaves short and POSIX paths alone', () => {
    expect(windowsExtendedPath('C:\\short', 'win32')).toBe('C:\\short')
    expect(windowsExtendedPath('/home/me/memory', 'linux')).toBe('/home/me/memory')
  })

  it('prefixes long Windows paths, including UNC shares', () => {
    const long = `C:\\Users\\me\\${'x'.repeat(240)}`
    expect(windowsExtendedPath(long, 'win32')).toBe(`\\\\?\\${long}`)
    const unc = `\\\\server\\share\\${'x'.repeat(240)}`
    expect(windowsExtendedPath(unc, 'win32')).toBe(`\\\\?\\UNC\\server\\share\\${'x'.repeat(240)}`)
  })
})
