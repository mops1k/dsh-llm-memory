/**
 * Architecture contract (ADR-008): domain/application/layout/sync must not
 * import harness SDKs or database drivers. Drivers live in infrastructure only.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const CORE_SRC = join(import.meta.dirname, '..', 'packages', 'core', 'src')
const GUARDED_LAYERS = ['domain', 'application', 'layout', 'sync']
const FORBIDDEN =
  /from\s+['"](?:node:sqlite|bun:[^'"]+|@deepseek-ai\/[^'"]+|@kilocode\/[^'"]+|@opencode-ai\/[^'"]+)['"]/

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...walk(path))
    else if (name.endsWith('.ts')) out.push(path)
  }
  return out
}

describe('architecture', () => {
  it('guarded core layers do not import drivers or harness SDKs', () => {
    const violations: string[] = []
    for (const layer of GUARDED_LAYERS) {
      for (const file of walk(join(CORE_SRC, layer))) {
        const text = readFileSync(file, 'utf8')
        if (FORBIDDEN.test(text)) violations.push(file.replace(CORE_SRC, 'packages/core/src'))
      }
    }
    expect(violations).toEqual([])
  })

  it('core does not import harness adapters', () => {
    const violations = walk(CORE_SRC).filter(file =>
      /from\s+['"](?:\.\.\/)+(?:src\/)?dsh\//.test(readFileSync(file, 'utf8')),
    )
    expect(violations).toEqual([])
  })
})
