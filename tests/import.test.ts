import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { runImport } from '../src/core/import/index'
import { detectAllRoots, detectDshMemoryRoots, detectKiloRoots, detectMnemonRoots } from '../src/core/import/paths'
import { MemoryStore } from '../src/core/store'
import { cleanupRoot, makeTempRoot } from './helpers'

const OFF = { detectNative: false, detectWslWindows: false, detectWindows: false } as const

let root: string
let store: MemoryStore

beforeEach(() => {
  root = makeTempRoot('dsh-import-')
  store = new MemoryStore({ storageRoot: join(root, 'store') })
})

afterEach(() => {
  store.close()
  cleanupRoot(root)
})

const KILO_SCHEMA = `
  CREATE TABLE memories (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL DEFAULT 'global',
    kind TEXT NOT NULL DEFAULT 'facts',
    tier TEXT NOT NULL DEFAULT 'normal',
    status TEXT NOT NULL DEFAULT 'active',
    title TEXT NOT NULL DEFAULT '',
    content TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '[]',
    keywords TEXT NOT NULL DEFAULT '',
    importance INTEGER NOT NULL DEFAULT 3,
    source TEXT NOT NULL DEFAULT 'user',
    supersedes TEXT NOT NULL DEFAULT '[]',
    supersededBy TEXT NOT NULL DEFAULT '[]',
    related TEXT NOT NULL DEFAULT '[]',
    createdAt TEXT NOT NULL DEFAULT '',
    updatedAt TEXT NOT NULL DEFAULT '',
    lastAccess TEXT,
    accessCount INTEGER,
    file TEXT,
    mtimeMs INTEGER,
    project_root TEXT NOT NULL DEFAULT '',
    confidence REAL,
    consolidation TEXT
  );
  CREATE VIRTUAL TABLE memories_fts USING fts5(id, title, content, keywords, tags, tokenize = 'unicode61');
`

function createKiloFixture(base: string): string {
  const kiloRoot = join(base, 'kilo-src')
  const dir = join(kiloRoot, 'memory', 'db')
  mkdirSync(dir, { recursive: true })
  const db = new DatabaseSync(join(dir, 'memory.db'))
  db.exec(KILO_SCHEMA)
  const insert = db.prepare(`
    INSERT INTO memories (
      id, scope, kind, tier, status, title, content, tags, keywords, importance,
      supersedes, supersededBy, related, createdAt, updatedAt, project_root, confidence
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  insert.run(
    'm_k1', 'global', 'preferences', 'important', 'active', 'Global pref', 'Prefers dark mode',
    '["ui","theme"]', '', 4, '[]', '[]', '[]', '2026-01-01T00:00:00.000Z', '2026-01-02T00:00:00.000Z', '', 0.5,
  )
  insert.run(
    'm_k2', 'project', 'decisions', 'normal', 'active', 'Project decision', 'Use FTS5',
    '[]', 'sqlite', 3, '[]', '[]', '["m_k1"]', '2026-02-01T00:00:00.000Z', '2026-02-02T00:00:00.000Z',
    '/home/mops1k/Development/tv2.local', null,
  )
  insert.run(
    'm_k3', 'project', 'facts', 'normal', 'superseded', 'Old fact', 'Replaced fact',
    '[]', '', 2, '[]', '["m_k2"]', '[]', '2026-03-01T00:00:00.000Z', '2026-03-02T00:00:00.000Z',
    '/home/mops1k/Development/tv2.local', null,
  )
  db.close()
  return kiloRoot
}

function createMnemonFixture(base: string, withRows: boolean): string {
  const mnemonRoot = join(base, 'mnemon-src')
  const dir = join(mnemonRoot, 'data', 'default')
  mkdirSync(dir, { recursive: true })
  const db = new DatabaseSync(join(dir, 'mnemon.db'))
  db.exec(`
    CREATE TABLE insights (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL DEFAULT '',
      category TEXT,
      importance INTEGER,
      tags TEXT,
      entities TEXT,
      source TEXT,
      access_count INTEGER,
      stored_at TEXT,
      created_at TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT '',
      deleted_at TEXT,
      last_accessed_at TEXT,
      embedding BLOB,
      effective_importance REAL
    );
  `)
  if (withRows) {
    const insert = db.prepare(`
      INSERT INTO insights (
        id, content, category, importance, tags, entities, source,
        created_at, updated_at, effective_importance
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    insert.run(
      'mn_1', 'User prefers concise answers', 'preference', 5, '["style"]', '["answers"]', 'user',
      '2026-04-01T00:00:00.000Z', '2026-04-02T00:00:00.000Z', 4.5,
    )
    insert.run(
      'mn_2', 'Deleted insight', 'facts', 2, '[]', '[]', 'user',
      '2026-04-03T00:00:00.000Z', '2026-04-04T00:00:00.000Z', null,
    )
    db.prepare('UPDATE insights SET deleted_at = ? WHERE id = ?').run('2026-04-05T00:00:00.000Z', 'mn_2')
  }
  db.close()
  return mnemonRoot
}

function dshPage(header: Record<string, unknown>, body: string): string {
  return `<!-- dsh-memory: ${JSON.stringify(header)} -->\n${body}\n`
}

/** Schema of the current dsh-memory plugin (`~/.dsh/memory/memory.db`). */
const DSH_MEMORY_DB_SCHEMA = `
  CREATE TABLE memories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL,
    tags TEXT NOT NULL DEFAULT '',
    pinned INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`

function dshMemoryDbPath(root: string): string {
  return join(root, 'memory', 'memory.db')
}

function insertDshMemoryRow(
  db: DatabaseSync,
  text: string,
  tags: string,
  pinned: number,
  createdAt: number,
  updatedAt: number,
): void {
  db.prepare(
    'INSERT INTO memories (text, tags, pinned, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  ).run(text, tags, pinned, createdAt, updatedAt)
}

/** A `$DSH_HOME`-shaped root holding the SQLite store under `memory/`. */
function createDshMemoryDbFixture(base: string, withRows = true): string {
  const dshRoot = join(base, 'dsh-home')
  mkdirSync(join(dshRoot, 'memory'), { recursive: true })
  const db = new DatabaseSync(dshMemoryDbPath(dshRoot))
  db.exec(DSH_MEMORY_DB_SCHEMA)
  if (withRows) {
    insertDshMemoryRow(db, 'User prefers concise answers', 'preference style', 1, 1750000000000, 1750000100000)
    // The source may already carry the `dsh-memory` tag itself; the importer
    // must deduplicate it, otherwise every re-import rewrites the entry.
    insertDshMemoryRow(db, 'The project uses pnpm', 'dsh-memory build tooling', 0, 1750000200000, 1750000300000)
    // A title cut at exactly 120 chars ends on a space; the store trims it, so
    // a raw `slice` would make the entry look changed on every re-import.
    insertDshMemoryRow(db, `${'x'.repeat(119)} tail`, 'long', 0, 1750000400000, 1750000500000)
  }
  db.close()
  return dshRoot
}

function createDshMemoryFixture(base: string): string {
  const dshRoot = join(base, 'dsh-memory-src')
  mkdirSync(join(dshRoot, '_user'), { recursive: true })
  mkdirSync(join(dshRoot, 'tv2.local'), { recursive: true })
  writeFileSync(
    join(dshRoot, '_user', 'alpha.md'),
    dshPage(
      { name: 'alpha', description: 'Alpha note', type: 'user', citations: ['src/a.ts'], createdAt: 1750000000000, updatedAt: 1750000100000, rev: 1 },
      'Alpha body text.',
    ),
  )
  writeFileSync(
    join(dshRoot, 'tv2.local', 'beta.md'),
    dshPage(
      { name: 'beta', description: 'Beta note', type: 'project', citations: ['docs/b.md'], createdAt: 1750000200000, updatedAt: 1750000300000, rev: 2 },
      'Beta body text.',
    ),
  )
  writeFileSync(join(dshRoot, 'tv2.local', 'broken.md'), 'no json header here\n')
  return dshRoot
}

describe('import root detection', () => {
  it('classifies explicit roots and validates markers', () => {
    const kiloRoot = createKiloFixture(root)
    const mnemonRoot = createMnemonFixture(root, false)
    const dshRoot = createDshMemoryFixture(root)

    expect(detectKiloRoots({ importRoots: [kiloRoot], ...OFF })).toEqual([kiloRoot])
    expect(detectMnemonRoots({ importRoots: [mnemonRoot], ...OFF })).toEqual([mnemonRoot])
    expect(detectDshMemoryRoots({ importRoots: [dshRoot], ...OFF })).toEqual([dshRoot])

    const all = detectAllRoots({ importRoots: [kiloRoot, mnemonRoot, dshRoot], ...OFF })
    expect(all.kilo).toEqual([kiloRoot])
    expect(all.mnemon).toEqual([mnemonRoot])
    expect(all.dshMemory).toEqual([dshRoot])
    expect(all.all).toHaveLength(3)
  })
})

describe('kilo importer', () => {
  it('maps entries, scopes and external keys', () => {
    const kiloRoot = createKiloFixture(root)
    const reports = runImport({ sources: ['kilo'], config: { importRoots: [kiloRoot], ...OFF }, store })

    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatchObject({ source: 'kilo', imported: 3, updated: 0, skipped: 0, errors: [] })
    expect(reports[0]?.rootsFound).toEqual([kiloRoot])
    expect(reports[0]?.projects).toEqual([
      { key: 'tv2.local', root: '/home/mops1k/Development/tv2.local' },
    ])

    expect(store.getByExtKey('kilo:m_k1')).toMatchObject({
      scope: 'user',
      project: '',
      kind: 'preferences',
      tier: 'important',
      importance: 4,
      tags: ['ui', 'theme'],
      source: 'kilo',
    })
    const k1 = store.getByExtKey('kilo:m_k1')
    const k2 = store.getByExtKey('kilo:m_k2')
    expect(k2).toMatchObject({
      scope: 'project',
      project: 'tv2.local',
      kind: 'decisions',
      keywords: 'sqlite',
    })
    expect(k2?.related).toEqual([k1?.id])
    expect(store.getByExtKey('kilo:m_k3')).toMatchObject({ status: 'superseded' })
    expect(store.getByExtKey('kilo:m_k3')?.supersededBy).toEqual([k2?.id])
    expect(store.getByExtKey('kilo:m_k1')?.confidence).toBe(0.5)

    const dbDir = join(kiloRoot, 'memory', 'db')
    expect(existsSync(join(dbDir, 'memory.db-wal'))).toBe(false)
    expect(existsSync(join(dbDir, 'memory.db-shm'))).toBe(false)
  })

  it('reads a live WAL database through a snapshot without touching the source', () => {
    const kiloRoot = join(root, 'kilo-wal')
    const dir = join(kiloRoot, 'memory', 'db')
    mkdirSync(dir, { recursive: true })
    const dbPath = join(dir, 'memory.db')
    const db = new DatabaseSync(dbPath)
    db.exec('PRAGMA journal_mode = WAL;')
    db.exec(KILO_SCHEMA)
    db.prepare(
      `INSERT INTO memories (
         id, scope, kind, tier, status, title, content, tags, keywords, importance,
         supersedes, supersededBy, related, createdAt, updatedAt, project_root
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'm_wal', 'global', 'facts', 'normal', 'active', 'WAL fact', 'Written to the WAL',
      '[]', '', 3, '[]', '[]', '[]', '2026-05-01T00:00:00.000Z', '2026-05-02T00:00:00.000Z', '',
    )

    expect(existsSync(`${dbPath}-wal`)).toBe(true)
    expect(statSync(`${dbPath}-wal`).size).toBeGreaterThan(0)

    const reports = runImport({ sources: ['kilo'], config: { importRoots: [kiloRoot], ...OFF }, store })
    expect(reports[0]).toMatchObject({ imported: 1, errors: [] })
    expect(store.getByExtKey('kilo:m_wal')?.title).toBe('WAL fact')

    db.close()
  })

  it('is idempotent on a second run', () => {
    const kiloRoot = createKiloFixture(root)
    const config = { importRoots: [kiloRoot], ...OFF }
    runImport({ sources: ['kilo'], config, store })
    const second = runImport({ sources: ['kilo'], config, store })

    expect(second[0]).toMatchObject({ imported: 0, updated: 0, skipped: 3 })
    expect(store.allIds()).toHaveLength(3)
  })

  it('remaps cross-entry relations to local ids and drops missing targets', () => {
    const kiloRoot = join(root, 'kilo-relations')
    const dir = join(kiloRoot, 'memory', 'db')
    mkdirSync(dir, { recursive: true })
    const db = new DatabaseSync(join(dir, 'memory.db'))
    db.exec(KILO_SCHEMA)
    const insert = db.prepare(`
      INSERT INTO memories (
        id, scope, kind, tier, status, title, content, tags, keywords, importance,
        supersedes, supersededBy, related, createdAt, updatedAt, project_root, confidence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    insert.run(
      'a', 'global', 'facts', 'normal', 'active', 'A', 'A body', '[]', '', 3,
      '["b"]', '[]', '["c","d"]', '2026-06-01T00:00:00.000Z', '2026-06-02T00:00:00.000Z', '', null,
    )
    insert.run(
      'b', 'global', 'facts', 'normal', 'active', 'B', 'B body', '[]', '', 3,
      '[]', '[]', '[]', '2026-06-01T00:00:00.000Z', '2026-06-02T00:00:00.000Z', '', null,
    )
    insert.run(
      'c', 'global', 'facts', 'normal', 'active', 'C', 'C body', '[]', '', 3,
      '[]', '[]', '[]', '2026-06-01T00:00:00.000Z', '2026-06-02T00:00:00.000Z', '', null,
    )
    db.close()

    const config = { importRoots: [kiloRoot], ...OFF }
    const first = runImport({ sources: ['kilo'], config, store })
    expect(first[0]).toMatchObject({ imported: 3, updated: 0, skipped: 0, droppedRelations: 1, errors: [] })

    const a = store.getByExtKey('kilo:a')
    const b = store.getByExtKey('kilo:b')
    const c = store.getByExtKey('kilo:c')
    expect(a?.supersedes).toEqual([b?.id])
    expect(a?.related).toEqual([c?.id])

    const idsBefore = store.allIds().sort()
    const second = runImport({ sources: ['kilo'], config, store })
    expect(second[0]).toMatchObject({ imported: 0, updated: 0, skipped: 3, droppedRelations: 1 })
    expect(store.allIds().sort()).toEqual(idsBefore)
  })

  it('returns an empty report when the root has no database', () => {
    const emptyRoot = join(root, 'empty-kilo')
    mkdirSync(emptyRoot, { recursive: true })
    const reports = runImport({ sources: ['kilo'], config: { importRoots: [emptyRoot], ...OFF }, store })
    expect(reports[0]).toMatchObject({ imported: 0, updated: 0, skipped: 0, rootsFound: [] })
  })
})

describe('mnemon importer', () => {
  it('maps insights and marks deleted rows as archived', () => {
    const mnemonRoot = createMnemonFixture(root, true)
    const reports = runImport({ sources: ['mnemon'], config: { importRoots: [mnemonRoot], ...OFF }, store })

    expect(reports[0]).toMatchObject({ source: 'mnemon', imported: 2, errors: [] })
    expect(store.getByExtKey('mnemon:mn_1')).toMatchObject({
      scope: 'user',
      kind: 'preferences',
      tier: 'normal',
      status: 'active',
      importance: 5,
      tags: ['style'],
      keywords: 'answers',
    })
    expect(store.getByExtKey('mnemon:mn_2')).toMatchObject({ status: 'archived', kind: 'facts' })
  })

  it('handles an empty insights table without failing', () => {
    const mnemonRoot = createMnemonFixture(root, false)
    const reports = runImport({ sources: ['mnemon'], config: { importRoots: [mnemonRoot], ...OFF }, store })
    expect(reports[0]).toMatchObject({ imported: 0, updated: 0, skipped: 0, errors: [] })
    expect(reports[0]?.rootsFound).toEqual([mnemonRoot])
  })
})

describe('dsh-memory importer', () => {
  it('imports md pages and reports broken files without aborting', () => {
    const dshRoot = createDshMemoryFixture(root)
    const reports = runImport({ sources: ['dsh-memory'], config: { importRoots: [dshRoot], ...OFF }, store })

    expect(reports[0]).toMatchObject({ source: 'dsh-memory', imported: 2, updated: 0, skipped: 0 })
    expect(reports[0]?.errors).toHaveLength(1)
    expect(reports[0]?.errors[0]).toContain('broken.md')
    expect(reports[0]?.projects).toEqual([{ key: 'tv2.local', root: null }])

    expect(store.getByExtKey('dsh-memory:_user:alpha')).toMatchObject({
      scope: 'user',
      project: '',
      title: 'Alpha note',
      text: 'Alpha body text.',
      createdAt: new Date(1750000000000).toISOString(),
    })
    const beta = store.getByExtKey('dsh-memory:tv2.local:beta')
    expect(beta).toMatchObject({ scope: 'project', project: 'tv2.local', title: 'Beta note' })
    expect(beta?.tags.some((tag) => tag.startsWith('citations:'))).toBe(true)
    expect(beta?.keywords).toContain('rev:2')
  })

  it('updates changed pages and skips unchanged ones', () => {
    const dshRoot = createDshMemoryFixture(root)
    const config = { importRoots: [dshRoot], ...OFF }
    runImport({ sources: ['dsh-memory'], config, store })

    writeFileSync(
      join(dshRoot, '_user', 'alpha.md'),
      dshPage({ name: 'alpha', description: 'Alpha note', type: 'user', createdAt: 1750000000000 }, 'Updated body.'),
    )
    const second = runImport({ sources: ['dsh-memory'], config, store })
    expect(second[0]).toMatchObject({ imported: 0, updated: 1, skipped: 1 })
    expect(store.getByExtKey('dsh-memory:_user:alpha')?.text).toBe('Updated body.')

    const third = runImport({ sources: ['dsh-memory'], config, store })
    expect(third[0]).toMatchObject({ imported: 0, updated: 0, skipped: 2 })
  })

  it('detects and imports the SQLite store', () => {
    const dshRoot = createDshMemoryDbFixture(root)
    expect(detectDshMemoryRoots({ importRoots: [dshRoot], ...OFF })).toEqual([dshRoot])

    const reports = runImport({ sources: ['dsh-memory'], config: { importRoots: [dshRoot], ...OFF }, store })
    expect(reports[0]).toMatchObject({
      source: 'dsh-memory',
      imported: 3,
      updated: 0,
      skipped: 0,
      errors: [],
      rootsFound: [dshRoot],
    })

    const pinned = store.getByExtKey('dsh-memory:db:1')
    expect(pinned).toMatchObject({
      scope: 'user',
      project: '',
      kind: 'facts',
      tier: 'important',
      status: 'active',
      importance: 5,
      title: 'User prefers concise answers',
      text: 'User prefers concise answers',
      createdAt: new Date(1750000000000).toISOString(),
      updatedAt: new Date(1750000100000).toISOString(),
    })
    expect(pinned?.tags).toEqual(['dsh-memory', 'preference', 'style', 'pinned'])

    const plain = store.getByExtKey('dsh-memory:db:2')
    expect(plain).toMatchObject({ tier: 'normal', importance: 3, text: 'The project uses pnpm' })
    expect(plain?.tags).toEqual(['dsh-memory', 'build', 'tooling'])

    const longTitle = store.getByExtKey('dsh-memory:db:3')
    expect(longTitle?.title).toBe('x'.repeat(119))
    expect(longTitle?.title.length).toBe(119)
  })

  it('imports an overlapping SQLite store once', () => {
    const dshRoot = createDshMemoryDbFixture(root)
    const storeDir = join(dshRoot, 'memory')
    const reports = runImport({
      sources: ['dsh-memory'],
      config: { importRoots: [dshRoot, storeDir], ...OFF },
      store,
    })

    expect(reports[0]).toMatchObject({ imported: 3, errors: [], rootsFound: [dshRoot] })
    expect(store.list().total).toBe(3)
  })

  it('re-imports the SQLite store idempotently', () => {
    const dshRoot = createDshMemoryDbFixture(root)
    const config = { importRoots: [dshRoot], ...OFF }
    runImport({ sources: ['dsh-memory'], config, store })
    const idsBefore = store.allIds().sort()

    const second = runImport({ sources: ['dsh-memory'], config, store })
    expect(second[0]).toMatchObject({ imported: 0, updated: 0, skipped: 3 })
    expect(store.allIds().sort()).toEqual(idsBefore)
  })

  it('reads rows committed to a pending WAL', () => {
    const dshRoot = join(root, 'dsh-wal')
    mkdirSync(join(dshRoot, 'memory'), { recursive: true })
    const db = new DatabaseSync(dshMemoryDbPath(dshRoot))
    db.exec('PRAGMA journal_mode = WAL')
    db.exec(DSH_MEMORY_DB_SCHEMA)
    try {
      insertDshMemoryRow(db, 'WAL row', 'wal', 0, 1750000000000, 1750000000000)
      const reports = runImport({
        sources: ['dsh-memory'],
        config: { importRoots: [dshRoot], ...OFF },
        store,
      })
      expect(reports[0]).toMatchObject({ imported: 1, errors: [] })
      expect(store.getByExtKey('dsh-memory:db:1')?.text).toBe('WAL row')
    } finally {
      db.close()
    }
  })
})

describe('runImport', () => {
  it('returns one empty report per source when no roots are available', () => {
    const reports = runImport({
      sources: ['kilo', 'mnemon', 'dsh-memory'],
      roots: { kilo: [], mnemon: [], dshMemory: [], all: [] },
      store,
    })
    expect(reports.map((report) => report.source)).toEqual(['kilo', 'mnemon', 'dsh-memory'])
    expect(reports.map((report) => report.imported)).toEqual([0, 0, 0])
    expect(reports.every((report) => report.errors.length === 0)).toBe(true)
  })

  it('imports all three sources in one run', () => {
    const kiloRoot = createKiloFixture(root)
    const mnemonRoot = createMnemonFixture(root, true)
    const dshRoot = createDshMemoryFixture(root)
    const reports = runImport({
      config: { importRoots: [kiloRoot, mnemonRoot, dshRoot], ...OFF },
      store,
    })
    expect(reports.map((report) => report.imported)).toEqual([3, 2, 2])
    expect(store.list().total).toBe(7)
  })
})
