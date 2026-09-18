import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { entryFilePath } from '../src/core/paths'
import { MemoryStore, newMemoryEntry } from '../src/core/store'
import { buildGraph, initMemoryRoot, readAllPages, regenerateIndex, writeItemPage } from '../src/core/wiki'
import { cleanupRoot, makeTempRoot } from './helpers'

let root: string

beforeEach(() => {
  root = makeTempRoot()
})

afterEach(() => {
  cleanupRoot(root)
})

describe('wiki', () => {
  it('writes pages and reads them back with the derived scope', () => {
    initMemoryRoot(root)
    const project = newMemoryEntry({ id: 'm_w1', scope: 'project', project: 'proj', title: 'Project note', text: 'p' })
    const user = newMemoryEntry({ id: 'm_w2', scope: 'user', title: 'User note', text: 'u' })
    writeItemPage(root, project)
    writeItemPage(root, user)

    const pages = readAllPages(root)
    expect(pages).toHaveLength(2)
    const projectPage = pages.find((page) => page.file === entryFilePath(root, project))
    expect(projectPage).toMatchObject({ scope: 'project', project: 'proj' })
    expect(pages.find((page) => page.file === entryFilePath(root, user))).toMatchObject({ scope: 'user', project: '' })
  })

  it('regenerates index.md', () => {
    const entry = newMemoryEntry({ id: 'm_idx', title: 'Indexed', text: 'body' })
    regenerateIndex(root, [entry])
    expect(existsSync(join(root, 'index.md'))).toBe(true)
  })

  it('builds supersedes, depends and contradicts edges', () => {
    const old = newMemoryEntry({ id: 'm_g1', kind: 'rules', title: 'Old rule', text: 'tabs indentation required' })
    const decision = newMemoryEntry({
      id: 'm_g2',
      kind: 'decisions',
      title: 'Decision',
      text: 'tabs indentation chosen',
      supersedes: ['m_g1'],
      related: ['m_g3'],
    })
    const fact = newMemoryEntry({ id: 'm_g3', kind: 'facts', title: 'Fact', text: 'default spacing convention' })

    const graph = buildGraph([old, decision, fact], { overlapMinCommonWords: 2, overlapMinScore: 0.1 })
    expect(graph.entities).toHaveLength(3)
    expect(graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'm_g2', target: 'm_g1', type: 'supersedes' }),
        expect.objectContaining({ source: 'm_g2', target: 'm_g3', type: 'depends' }),
      ]),
    )
    expect(graph.edges.some((edge) => edge.type === 'contradicts')).toBe(true)
  })

  it('builds reverse supersededBy edges and de-duplicates related edges', () => {
    const old = newMemoryEntry({ id: 'm_r1', kind: 'facts', title: 'Old', text: 'old body' })
    const fresh = newMemoryEntry({
      id: 'm_r2',
      kind: 'facts',
      title: 'Fresh',
      text: 'fresh body',
      supersedes: ['m_r1'],
    })
    old.supersededBy = ['m_r2']
    const third = newMemoryEntry({ id: 'm_r3', kind: 'facts', title: 'Third', text: 'third body' })
    old.related = ['m_r3']
    third.related = ['m_r1']

    const graph = buildGraph([old, fresh, third], { overlapMinCommonWords: 50, overlapMinScore: 0.99 })
    const supersedeEdges = graph.edges.filter((edge) => edge.type === 'supersedes')
    expect(supersedeEdges).toEqual([
      expect.objectContaining({ source: 'm_r2', target: 'm_r1', type: 'supersedes' }),
    ])
    expect(graph.edges.filter((edge) => edge.type === 'related')).toHaveLength(1)
  })

  it('relates entries that share a topical tag and ignores tags shared by nearly all', () => {
    const topical = [
      newMemoryEntry({ id: 'm_g_t1', kind: 'facts', title: 'A', text: 'alpha', tags: ['plasma-keyboard', 'build'] }),
      newMemoryEntry({ id: 'm_g_t2', kind: 'facts', title: 'B', text: 'beta', tags: ['plasma-keyboard', 'packaging'] }),
    ]
    // Six entries marked by the importer's source tag: 6/8 = 75% > the 50% cap.
    const imported = Array.from({ length: 6 }, (_, index) =>
      newMemoryEntry({
        id: `m_g_i${index}`,
        kind: 'facts',
        title: `imported ${index}`,
        text: `imported body ${index}`,
        tags: ['dsh-memory'],
      }),
    )

    const graph = buildGraph([...topical, ...imported], { overlapMinCommonWords: 50, overlapMinScore: 0.99 })
    const related = graph.edges.filter((edge) => edge.type === 'related')
    expect(related).toEqual([
      expect.objectContaining({ source: 'm_g_t1', target: 'm_g_t2', type: 'related', weight: 1 }),
    ])
    expect(graph.edges).toHaveLength(1)
  })

  it('weights tag edges by the number of shared tags and caps them per entry', () => {
    const strong = [
      newMemoryEntry({ id: 'm_g_s1', kind: 'facts', title: 'S1', text: 's1', tags: ['one', 'two'] }),
      newMemoryEntry({ id: 'm_g_s2', kind: 'facts', title: 'S2', text: 's2', tags: ['one', 'two'] }),
    ]
    const common = Array.from({ length: 3 }, (_, index) =>
      newMemoryEntry({
        id: `m_g_c${index}`,
        kind: 'facts',
        title: `C${index}`,
        text: `c${index}`,
        tags: ['common'],
      }),
    )
    // Nine entries keep `common` (df 3) under the 50% cap, so it still links.
    const fillers = Array.from({ length: 4 }, (_, index) =>
      newMemoryEntry({ id: `m_g_f${index}`, kind: 'facts', title: `F${index}`, text: `f${index}` }),
    )

    const weighted = buildGraph([...strong, ...common, ...fillers], {
      overlapMinCommonWords: 50,
      overlapMinScore: 0.99,
    })
    const strongEdge = weighted.edges.find((edge) => edge.type === 'related' && edge.weight === 2)
    expect(strongEdge).toMatchObject({ source: 'm_g_s1', target: 'm_g_s2', weight: 2 })

    const capped = buildGraph([...common, ...fillers], {
      overlapMinCommonWords: 50,
      overlapMinScore: 0.99,
      maxTagLinksPerEntry: 1,
    })
    expect(capped.edges.filter((edge) => edge.type === 'related')).toHaveLength(1)
  })

  it('keeps the store and wiki pages consistent', () => {
    const store = new MemoryStore({ storageRoot: root })
    try {
      const entry = newMemoryEntry({ id: 'm_c1', scope: 'user', title: 'Consistent', text: 'value' })
      store.upsert(entry)
      const pages = readAllPages(root)
      expect(pages.map((page) => page.file)).toContain(entryFilePath(root, entry))
      expect(store.get('m_c1')?.text).toBe('value')
    } finally {
      store.close()
    }
  })
})
