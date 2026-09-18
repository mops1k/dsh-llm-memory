import { describe, expect, it } from 'vitest'

import { entryFromPage, parsePage, pageToText, serializeFrontmatter } from '../src/core/frontmatter'
import { newMemoryEntry } from '../src/core/store'

describe('frontmatter', () => {
  it('round-trips a fully populated entry', () => {
    const entry = newMemoryEntry({
      id: 'm_roundtrip1',
      scope: 'project',
      project: 'my-project',
      kind: 'decisions',
      tier: 'important',
      status: 'active',
      title: 'Use node:sqlite for the index',
      text: 'Multi line\nbody with: colons and "quotes".',
      tags: ['storage', 'fts5', 'spaced tag'],
      keywords: 'sqlite, database',
      importance: 5,
      confidence: 0.75,
      source: 'agent',
      extKey: 'kilo:m_abc',
      supersedes: ['m_old1'],
      supersededBy: [],
      related: ['m_rel1', 'm_rel2'],
      createdAt: '2026-01-02T03:04:05.000Z',
      updatedAt: '2026-02-03T04:05:06.000Z',
    })

    const decoded = entryFromPage(pageToText(entry))
    expect(decoded).toEqual(entry)
  })

  it('parses a page without frontmatter as raw content', () => {
    const parsed = parsePage('just text')
    expect(parsed.data).toBeNull()
    expect(parsed.content).toBe('just text')
  })

  it('decodes snake_case keys produced by kilo-memory', () => {
    const page = [
      '---',
      'id: m_legacy1',
      'scope: project',
      'kind: facts',
      'tier: normal',
      'status: active',
      'title: Legacy entry',
      'importance: 4',
      'superseded_by: [m_x]',
      'created_at: 2026-01-01T00:00:00.000Z',
      'updated_at: 2026-01-02T00:00:00.000Z',
      'tags: [a, "b c"]',
      '---',
      'Legacy body',
      '',
    ].join('\n')

    const decoded = entryFromPage(page)
    expect(decoded?.id).toBe('m_legacy1')
    expect(decoded?.supersededBy).toEqual(['m_x'])
    expect(decoded?.createdAt).toBe('2026-01-01T00:00:00.000Z')
    expect(decoded?.tags).toEqual(['a', 'b c'])
    expect(decoded?.text).toBe('Legacy body')
  })

  it('returns null when the page has no id', () => {
    expect(entryFromPage('---\ntitle: x\n---\nbody')).toBeNull()
  })

  it('serializes arrays and empty strings safely', () => {
    const frontmatter = serializeFrontmatter({ id: 'm_x', keywords: '', tags: ['true', 'a b'] })
    expect(frontmatter).toContain('keywords: ')
    expect(frontmatter).toContain('tags: ["true", "a b"]')
  })
})
