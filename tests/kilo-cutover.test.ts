import { copyFileSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { cleanupRoot } from './helpers'

import { cleanupWorkDir, rehearseCutover } from '@llm-memory/adapter/kilo/cutover'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) cleanupRoot(dir)
})

function sourceStore(): string {
  const root = mkdtempSync(join(tmpdir(), 'llm-kilo-cutover-src-'))
  dirs.push(root)
  const storeDir = join(root, 'store')
  mkdirSync(join(storeDir, '_db'), { recursive: true })
  mkdirSync(join(storeDir, 'pages', 'facts'), { recursive: true })
  copyFileSync(join(import.meta.dirname, 'fixtures', 'kilo', 'memory.db'), join(storeDir, '_db', 'memory.db'))
  writeFileSync(join(storeDir, 'pages', 'facts', 'one.md'), '---\nid: m_1\n---\nfact\n')
  const projectDir = join(root, 'repo', '.kilo', 'memory')
  mkdirSync(projectDir, { recursive: true })
  writeFileSync(join(projectDir, 'page.md'), '---\nid: m_2\n---\nproject\n')
  return storeDir
}

describe('kilo cutover rehearsal', () => {
  it('is production-ready on a source copy and keeps every record', async () => {
    const storeDir = sourceStore()
    const workDir = mkdtempSync(join(tmpdir(), 'llm-kilo-cutover-work-'))
    dirs.push(workDir)
    const report = await rehearseCutover({
      source: { storeDir, dbPath: join(storeDir, '_db', 'memory.db'), projectDirs: [join(storeDir, '..', 'repo', '.kilo', 'memory')] },
      workDir,
      queries: 24,
    })
    expect(report.productionReady).toBe(true)
    expect(report.preservation).toEqual({ entries: true, active: true, relations: true, projectPages: true })
    expect(report.migration.integrityCheck).toBe('ok')
    expect(report.migration.addedColumns).toHaveLength(17)
    expect(report.recall.passed).toBe(true)
    expect(report.recall.averageIntersection).toBeGreaterThanOrEqual(0.9)
    expect(report.smoke.tools).toBe(7)
    expect(report.smoke.hookInjectsGuide).toBe(true)
    expect(report.smoke.panel).toBe(true)
    expect(report.smoke.backupRestore).toBe(true)
    expect(report.rollback.ok).toBe(true)
    expect(report.rollback.logicalHashMatches).toBe(true)
    expect(existsSync(join(workDir, 'migration-report.json'))).toBe(true)
    cleanupWorkDir(workDir)
  })
})
