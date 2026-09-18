import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { mergeConfig } from '../src/core/config'
import {
  RULES_BLOCK_BEGIN,
  RULES_BLOCK_END,
  applyManagedBlock,
  exportRulesToDshAgents,
  previewRulesExport,
  resolveRuleSources,
} from '../src/dsh/rules-export'
import { cleanupRoot, makeTempRoot } from './helpers'

const ORIGINAL_HOME = process.env['HOME']
const ORIGINAL_DSH_HOME = process.env['DSH_HOME']

let base: string
let home: string
let dshHome: string
let kiloDir: string

beforeEach(() => {
  base = makeTempRoot('dsh-rules-')
  home = join(base, 'home')
  dshHome = join(base, 'dsh')
  kiloDir = join(home, '.config', 'kilo')
  mkdirSync(kiloDir, { recursive: true })
  mkdirSync(dshHome, { recursive: true })
  process.env['HOME'] = home
  process.env['DSH_HOME'] = dshHome
})

afterEach(() => {
  if (ORIGINAL_HOME === undefined) delete process.env['HOME']
  else process.env['HOME'] = ORIGINAL_HOME
  if (ORIGINAL_DSH_HOME === undefined) delete process.env['DSH_HOME']
  else process.env['DSH_HOME'] = ORIGINAL_DSH_HOME
  cleanupRoot(base)
})

function writeKiloRules(): void {
  writeFileSync(join(kiloDir, 'AGENTS.md'), '# Kilo AGENTS\n\nKilo rule A.\n', 'utf8')
  writeFileSync(join(kiloDir, 'immutable-rules.md'), '# Kilo immutable\n\nKilo rule B.\n', 'utf8')
}

function explicitConfig(...roots: string[]) {
  return mergeConfig({ importAutoDetect: false, importRoots: roots, rulesSource: 'kilo-verbatim' })
}

describe('resolveRuleSources', () => {
  it('reads existing rule files from explicit config directories in order', () => {
    writeKiloRules()
    const sources = resolveRuleSources(explicitConfig(kiloDir))
    expect(sources.map((source) => source.path)).toEqual([
      join(kiloDir, 'AGENTS.md'),
      join(kiloDir, 'immutable-rules.md'),
    ])
    expect(sources[0]?.content).toContain('Kilo rule A')
  })

  it('accepts an explicit file root and skips missing paths', () => {
    writeKiloRules()
    const sources = resolveRuleSources(explicitConfig(join(kiloDir, 'immutable-rules.md'), join(base, 'nope')))
    expect(sources.map((source) => source.path)).toEqual([join(kiloDir, 'immutable-rules.md')])
  })

  it('auto-detects the native HOME config when enabled', () => {
    writeKiloRules()
    const sources = resolveRuleSources(
      mergeConfig({ importAutoDetect: true, importRoots: [], rulesSource: 'kilo-verbatim' }),
    )
    expect(sources.map((source) => source.path)).toContain(join(kiloDir, 'AGENTS.md'))
  })
})

describe('bundled-en source', () => {
  it('resolves the two bundled English rule files from the package in order', () => {
    const sources = resolveRuleSources(mergeConfig({ rulesSource: 'bundled-en' }))
    expect(sources.map((source) => source.path)).toEqual([
      'bundled-en:AGENTS.md',
      'bundled-en:immutable-rules.md',
    ])
    expect(sources[0]?.content).toContain('English translation maintained by dsh-llm-memory')
    expect(sources[0]?.content).toContain('Immutable rules (highest priority)')
    expect(sources[1]?.content).toContain('Confidence threshold 90%')
    expect(sources[0]?.content).not.toMatch(/[\u0400-\u04FF]/u)
    expect(sources[1]?.content).not.toMatch(/[\u0400-\u04FF]/u)
  })

  it('is the default source', () => {
    const sources = resolveRuleSources(mergeConfig({}))
    expect(sources.map((source) => source.path)).toEqual([
      'bundled-en:AGENTS.md',
      'bundled-en:immutable-rules.md',
    ])
  })

  it('ignores explicit importRoots and auto-detection in bundled-en mode', () => {
    writeKiloRules()
    const sources = resolveRuleSources(
      mergeConfig({ rulesSource: 'bundled-en', importAutoDetect: true, importRoots: [kiloDir] }),
    )
    expect(sources.map((source) => source.path)).toEqual([
      'bundled-en:AGENTS.md',
      'bundled-en:immutable-rules.md',
    ])
  })

  it('previews an English managed block for the bundled sources', () => {
    const preview = previewRulesExport(mergeConfig({ rulesSource: 'bundled-en' }))
    expect(preview.mode).toBe('create')
    expect(preview.changed).toBe(true)
    expect(preview.sources.map((source) => source.path)).toEqual([
      'bundled-en:AGENTS.md',
      'bundled-en:immutable-rules.md',
    ])
    expect(preview.block).toContain(RULES_BLOCK_BEGIN)
    expect(preview.block).toContain(RULES_BLOCK_END)
    expect(preview.block).toContain('## Immutable rules (highest priority)')
    expect(preview.block).toContain('## Memory')
    expect(preview.block).not.toMatch(/[\u0400-\u04FF]/u)
  })

  it('exports the bundled sources and reports alreadyExported', () => {
    const config = mergeConfig({ rulesSource: 'bundled-en' })
    expect(previewRulesExport(config).alreadyExported).toBe(false)

    const result = exportRulesToDshAgents(config)
    expect(result.changed).toBe(true)
    expect(result.sources).toEqual(['bundled-en:AGENTS.md', 'bundled-en:immutable-rules.md'])
    expect(result.alreadyExported).toBe(true)

    expect(previewRulesExport(config).alreadyExported).toBe(true)
    const content = readFileSync(join(dshHome, 'AGENTS.md'), 'utf8')
    expect(content).toContain('## Immutable rules (highest priority)')
    expect(content).not.toMatch(/[\u0400-\u04FF]/u)
  })

  it('returns empty sources with an English message when the bundled files are missing', () => {
    const fakeBase = pathToFileURL(join(base, 'sub1', 'sub2', 'module.js')).href
    const config = mergeConfig({ rulesSource: 'bundled-en' })

    const preview = previewRulesExport(config, { bundledBase: fakeBase })
    expect(preview.sources).toEqual([])
    expect(preview.block).toBe('')
    expect(preview.changed).toBe(false)
    expect(preview.message).toBeTruthy()
    expect(preview.message).not.toMatch(/[\u0400-\u04FF]/u)
    expect(existsSync(join(dshHome, 'AGENTS.md'))).toBe(false)

    const result = exportRulesToDshAgents(config, { bundledBase: fakeBase })
    expect(result.sources).toEqual([])
    expect(result.changed).toBe(false)
    expect(result.message).toBeTruthy()
    expect(result.message).not.toMatch(/[\u0400-\u04FF]/u)
  })
})

describe('exportRulesToDshAgents', () => {
  it('writes a managed block idempotently and preserves foreign content', () => {
    writeKiloRules()
    const target = join(dshHome, 'AGENTS.md')
    writeFileSync(target, '# My global instructions\n\nKeep this.\n', 'utf8')
    const config = explicitConfig(kiloDir)

    const first = exportRulesToDshAgents(config)
    expect(first.changed).toBe(true)
    expect(first.sources).toHaveLength(2)
    expect(first.bytes).toBeGreaterThan(0)

    const afterFirst = readFileSync(target, 'utf8')
    expect(afterFirst).toContain('Keep this.')
    expect(afterFirst).toContain('Kilo rule A.')
    expect(afterFirst).toContain('Kilo rule B.')
    expect(afterFirst.split(RULES_BLOCK_BEGIN)).toHaveLength(2)
    expect(afterFirst.split(RULES_BLOCK_END)).toHaveLength(2)
    expect(afterFirst.indexOf(join(kiloDir, 'AGENTS.md'))).toBeLessThan(
      afterFirst.indexOf(join(kiloDir, 'immutable-rules.md')),
    )

    const second = exportRulesToDshAgents(config)
    expect(second.changed).toBe(false)
    expect(readFileSync(target, 'utf8')).toBe(afterFirst)
  })

  it('replaces the block instead of duplicating it when rules change', () => {
    writeKiloRules()
    const target = join(dshHome, 'AGENTS.md')
    const config = explicitConfig(kiloDir)

    exportRulesToDshAgents(config)
    writeFileSync(join(kiloDir, 'AGENTS.md'), '# Kilo AGENTS\n\nKilo rule A v2.\n', 'utf8')
    const result = exportRulesToDshAgents(config)

    expect(result.changed).toBe(true)
    const content = readFileSync(target, 'utf8')
    expect(content).toContain('Kilo rule A v2.')
    expect(content).not.toContain('Kilo rule A.')
    expect(content.split(RULES_BLOCK_BEGIN)).toHaveLength(2)
  })

  it('reports changed:false and writes nothing when there are no sources', () => {
    const config = explicitConfig()
    const result = exportRulesToDshAgents(config)
    expect(result.changed).toBe(false)
    expect(result.sources).toEqual([])
    expect(result.message).toBeTruthy()
    expect(existsSync(join(dshHome, 'AGENTS.md'))).toBe(false)
  })

  it('never modifies the Kilo rule files', () => {
    writeKiloRules()
    const agentsPath = join(kiloDir, 'AGENTS.md')
    const immutablePath = join(kiloDir, 'immutable-rules.md')
    const beforeAgents = readFileSync(agentsPath, 'utf8')
    const beforeImmutable = readFileSync(immutablePath, 'utf8')
    const entriesBefore = readdirSync(kiloDir).sort()

    exportRulesToDshAgents(explicitConfig(kiloDir))

    expect(readFileSync(agentsPath, 'utf8')).toBe(beforeAgents)
    expect(readFileSync(immutablePath, 'utf8')).toBe(beforeImmutable)
    expect(readdirSync(kiloDir).sort()).toEqual(entriesBefore)
    expect(statSync(agentsPath).isFile()).toBe(true)
  })
})

describe('previewRulesExport', () => {
  it('reports mode "create" on a clean DSH_HOME without writing the file', () => {
    writeKiloRules()
    const target = join(dshHome, 'AGENTS.md')
    const preview = previewRulesExport(explicitConfig(kiloDir))

    expect(preview.target).toBe(target)
    expect(preview.mode).toBe('create')
    expect(preview.changed).toBe(true)
    expect(preview.currentContent).toBe('')
    expect(preview.sources.map((source) => source.path)).toEqual([
      join(kiloDir, 'AGENTS.md'),
      join(kiloDir, 'immutable-rules.md'),
    ])
    expect(preview.sources[0]?.bytes).toBeGreaterThan(0)
    expect(preview.block).toContain(RULES_BLOCK_BEGIN)
    expect(preview.block).toContain(RULES_BLOCK_END)
    expect(preview.block).toContain('Kilo rule A.')
    expect(preview.block).toContain('Kilo rule B.')
    expect(existsSync(target)).toBe(false)
  })

  it('reports mode "replace" when the managed block already exists', () => {
    writeKiloRules()
    const config = explicitConfig(kiloDir)
    exportRulesToDshAgents(config)
    const target = join(dshHome, 'AGENTS.md')
    const before = readFileSync(target, 'utf8')

    const preview = previewRulesExport(config)
    expect(preview.mode).toBe('replace')
    expect(preview.changed).toBe(false)
    expect(preview.currentContent).toBe(before)
    expect(readFileSync(target, 'utf8')).toBe(before)
  })

  it('reports mode "replace" and changed:true when the rules changed', () => {
    writeKiloRules()
    const config = explicitConfig(kiloDir)
    exportRulesToDshAgents(config)
    writeFileSync(join(kiloDir, 'AGENTS.md'), '# Kilo AGENTS\n\nKilo rule A v2.\n', 'utf8')

    const preview = previewRulesExport(config)
    expect(preview.mode).toBe('replace')
    expect(preview.changed).toBe(true)
    expect(preview.block).toContain('Kilo rule A v2.')
    expect(preview.block).not.toContain('Kilo rule A.')
    expect(readFileSync(join(dshHome, 'AGENTS.md'), 'utf8')).not.toContain('Kilo rule A v2.')
  })

  it('reports mode "append" for an existing file without a managed block', () => {
    writeKiloRules()
    const target = join(dshHome, 'AGENTS.md')
    writeFileSync(target, '# My global instructions\n\nKeep this.\n', 'utf8')
    const before = readFileSync(target, 'utf8')

    const preview = previewRulesExport(explicitConfig(kiloDir))
    expect(preview.mode).toBe('append')
    expect(preview.changed).toBe(true)
    expect(preview.currentContent).toBe(before)
    expect(preview.block).toContain('Kilo rule A.')
    expect(readFileSync(target, 'utf8')).toBe(before)
  })

  it('returns an empty block and no change when there are no sources', () => {
    const preview = previewRulesExport(explicitConfig())
    expect(preview.sources).toEqual([])
    expect(preview.block).toBe('')
    expect(preview.changed).toBe(false)
    expect(preview.message).toBeTruthy()
    expect(existsSync(join(dshHome, 'AGENTS.md'))).toBe(false)
  })
})

describe('alreadyExported', () => {
  it('is false before the export and true once the block matches the sources', () => {
    writeKiloRules()
    const config = explicitConfig(kiloDir)

    expect(previewRulesExport(config).alreadyExported).toBe(false)
    exportRulesToDshAgents(config)
    expect(previewRulesExport(config).alreadyExported).toBe(true)
  })

  it('is true on an unchanged re-export and true from the export result', () => {
    writeKiloRules()
    const config = explicitConfig(kiloDir)

    const first = exportRulesToDshAgents(config)
    expect(first.changed).toBe(true)
    expect(first.alreadyExported).toBe(true)

    const second = exportRulesToDshAgents(config)
    expect(second.changed).toBe(false)
    expect(second.alreadyExported).toBe(true)
  })

  it('is false when the managed block differs from the current sources', () => {
    writeKiloRules()
    const config = explicitConfig(kiloDir)
    exportRulesToDshAgents(config)

    writeFileSync(join(kiloDir, 'AGENTS.md'), '# Kilo AGENTS\n\nKilo rule A v2.\n', 'utf8')
    const preview = previewRulesExport(config)
    expect(preview.alreadyExported).toBe(false)
    expect(preview.changed).toBe(true)
  })

  it('is false when a change inside the block is not whitespace-only', () => {
    writeKiloRules()
    const config = explicitConfig(kiloDir)
    exportRulesToDshAgents(config)
    const target = join(dshHome, 'AGENTS.md')

    const content = readFileSync(target, 'utf8')
    writeFileSync(target, content.replace('Kilo rule A.', 'Kilo  rule A.'), 'utf8')
    expect(previewRulesExport(config).alreadyExported).toBe(false)
  })

  it('normalizes CRLF line endings and trailing blank lines', () => {
    writeKiloRules()
    const config = explicitConfig(kiloDir)
    exportRulesToDshAgents(config)
    const target = join(dshHome, 'AGENTS.md')

    const content = readFileSync(target, 'utf8')
    writeFileSync(target, `${content.replace(/\n/gu, '\r\n')}\r\n\r\n`, 'utf8')
    expect(previewRulesExport(config).alreadyExported).toBe(true)
  })

  it('is false without sources even when a managed block exists', () => {
    writeKiloRules()
    exportRulesToDshAgents(explicitConfig(kiloDir))

    const preview = previewRulesExport(explicitConfig())
    expect(preview.sources).toEqual([])
    expect(preview.alreadyExported).toBe(false)
  })
})

describe('managed block de-duplication', () => {
  function countBegin(text: string): number {
    return text.split(RULES_BLOCK_BEGIN).length - 1
  }

  function oneBlock(body: string): string {
    return `${RULES_BLOCK_BEGIN}\n${body}\n${RULES_BLOCK_END}`
  }

  it('collapses several managed blocks into exactly one', () => {
    const existing = `# User notes\n\n${oneBlock('old one')}\n\n\n${oneBlock('old two')}\n\ntrailing notes\n`
    const out = applyManagedBlock(existing, oneBlock('fresh'))

    expect(countBegin(out)).toBe(1)
    expect(out).toContain('# User notes')
    expect(out).toContain('trailing notes')
    expect(out).not.toContain('old one')
    expect(out).not.toContain('old two')
    expect(out).toContain('fresh')
  })

  it('does not duplicate the block across repeated exports', () => {
    writeKiloRules()
    const config = explicitConfig(kiloDir)
    exportRulesToDshAgents(config)
    exportRulesToDshAgents(config)
    const content = readFileSync(join(dshHome, 'AGENTS.md'), 'utf8')
    expect(countBegin(content)).toBe(1)
    expect(previewRulesExport(config).alreadyExported).toBe(true)
  })

  it('reports not exported while duplicated blocks remain', () => {
    writeKiloRules()
    const config = explicitConfig(kiloDir)
    const block = previewRulesExport(config).block
    writeFileSync(join(dshHome, 'AGENTS.md'), `${block}\n\n${block}\n`, 'utf8')
    expect(previewRulesExport(config).alreadyExported).toBe(false)
    exportRulesToDshAgents(config)
    expect(countBegin(readFileSync(join(dshHome, 'AGENTS.md'), 'utf8'))).toBe(1)
  })
})
