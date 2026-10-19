import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { entryFromPage, pageToText } from '@llm-memory/core/infrastructure/frontmatter'

const PAGES = join(import.meta.dirname, 'fixtures', 'kilo', 'pages')

function page(relative: string): string {
  return readFileSync(join(PAGES, relative), 'utf8')
}

describe('frontmatter dual-read', () => {
  it('reads Kilo snake_case fields plus Kilo-only metadata', () => {
    const entry = entryFromPage(page('facts/kilo-style-cyrillic.md'))
    expect(entry).not.toBeNull()
    expect(entry?.scope).toBe('user')
    expect(entry?.consolidation).toBe('procedural')
    expect(entry?.accessCount).toBe(7)
    expect(entry?.lastAccess).toBe('2026-03-01T10:00:00.000Z')
    expect(entry?.text).toContain('Кириллический текст')
    expect(entry?.related).toEqual(['m_000000000102'])
  })

  it('reads a superseded project page and its project scope', () => {
    const entry = entryFromPage(page('decisions/kilo-style-superseded.md'))
    expect(entry?.scope).toBe('project')
    expect(entry?.status).toBe('superseded')
    expect(entry?.supersededBy).toEqual(['m_000000000103'])
    expect(entry?.consolidation).toBe('semantic')
  })

  it('keeps unknown keys in extra and preserves them on rewrite', () => {
    const entry = entryFromPage(page('rules/dsh-style-camelcase.md'))
    expect(entry?.extra).toEqual({ unknownKey: 'preserved-in-extra' })
    expect(entry?.origin).toBe('dsh')
    expect(entry?.extKey).toBe('kilo:m_000000000103')
    const rewritten = pageToText({ ...entry!, id: entry!.id }, 'dsh')
    expect(rewritten).toContain('unknownKey: preserved-in-extra')
    const again = entryFromPage(rewritten)
    expect(again?.extra).toEqual({ unknownKey: 'preserved-in-extra' })
    expect(again?.accessCount).toBe(12)
  })

  it('writes Kilo dialect in snake_case and reads it back', () => {
    const entry = entryFromPage(page('facts/kilo-style-cyrillic.md'))!
    const kilo = pageToText(entry, 'kilo')
    expect(kilo).toContain('access_count: 7')
    expect(kilo).toContain('last_access: 2026-03-01T10:00:00.000Z')
    expect(kilo).toContain('superseded_by: []')
    expect(kilo).not.toContain('accessCount:')
    const back = entryFromPage(kilo)
    expect(back?.accessCount).toBe(7)
    expect(back?.lastAccess).toBe(entry.lastAccess)
    expect(back?.text).toBe(entry.text)
  })
})
