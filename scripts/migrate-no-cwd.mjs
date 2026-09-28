#!/usr/bin/env node
/**
 * One-off migration of the placeholder project `no-cwd`.
 *
 * Before 2026-09-18 the plugin never derived a project key from the session
 * cwd, so every project-scope entry landed in the `no-cwd` placeholder. This
 * script rewrites the `scope`/`project` frontmatter of those pages, moves them
 * to their real home (a repository `.dsh/llm-memory` tree or the `_user`
 * layer), updates `projects.json` and rebuilds the derived SQLite index.
 *
 * Dry-run by default; pass `--apply` to actually move files.
 *
 * Usage: node scripts/migrate-no-cwd.mjs [--apply]
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'

const DSH_HOME = (process.env.DSH_HOME ?? '').trim() || join(homedir(), '.dsh')
const ROOT = join(DSH_HOME, 'llm-memory')
const APPLY = process.argv.includes('--apply')

/** Registered roots of the projects that own `no-cwd` entries. */
const PROJECT_ROOTS = {
  'dsh-llm-memory': '/home/deck/vibecoding/dsh-llm-memory',
  'plasma-keyboard': '/home/deck/vibecoding/plasma-keyboard',
}

/** Entry id -> new home. */
const MAP = {
  // plasma-keyboard (project)
  m_6cc813b37db1: { scope: 'project', project: 'plasma-keyboard' },
  m_bd0e959386d5: { scope: 'project', project: 'plasma-keyboard' },
  m_0a3570222d2d: { scope: 'project', project: 'plasma-keyboard' },
  m_97fac7df4098: { scope: 'project', project: 'plasma-keyboard' },
  m_648815ebbf99: { scope: 'project', project: 'plasma-keyboard' },
  m_83b74c570f74: { scope: 'project', project: 'plasma-keyboard' },
  m_cdfe36e701b4: { scope: 'project', project: 'plasma-keyboard' },
  m_65ee69c5ef37: { scope: 'project', project: 'plasma-keyboard' },
  m_f02ec905d0ee: { scope: 'project', project: 'plasma-keyboard' },
  // dsh-llm-memory (project)
  m_09ed8ce8946a: { scope: 'project', project: 'dsh-llm-memory' },
  m_01cd4728c704: { scope: 'project', project: 'dsh-llm-memory' },
  m_215191bb5bd7: { scope: 'project', project: 'dsh-llm-memory' },
  m_21f8178a062a: { scope: 'project', project: 'dsh-llm-memory' },
  m_713cb36ee212: { scope: 'project', project: 'dsh-llm-memory' },
  m_b48aa3042cb6: { scope: 'project', project: 'dsh-llm-memory' },
  m_7160628c12b0: { scope: 'project', project: 'dsh-llm-memory' },
  m_dc9b046d6970: { scope: 'project', project: 'dsh-llm-memory' },
  // written after the first migration pass, still by the old in-process code
  m_80bb2d918d0f: { scope: 'project', project: 'dsh-llm-memory' },
  m_3906bf82608f: { scope: 'project', project: 'dsh-llm-memory' },
  m_3e553bedd5e7: { scope: 'project', project: 'dsh-llm-memory' },
  // machine-wide facts (user layer)
  m_d7e5f91aa559: { scope: 'user' },
  m_6d8ef14ba464: { scope: 'user' },
  m_00681234568f: { scope: 'user' },
  m_3253f4941402: { scope: 'user' },
  m_638f14948800: { scope: 'user' },
  m_8eeeea995d18: { scope: 'user' },
  m_25629698d910: { scope: 'user' },
  m_c7c379722cb0: { scope: 'user' },
  m_f83728bb3302: { scope: 'user' },
}

/** Recursively list `*.md` files. */
function listMarkdown(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listMarkdown(full))
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(full)
  }
  return out
}

/** Read one frontmatter field from a page. */
function field(text, name) {
  const match = new RegExp(`^${name}:\\s*(.*)$`, 'mu').exec(text)
  return match ? match[1].trim() : ''
}

/** Rewrite `scope`/`project` inside the leading frontmatter block. */
function rewrite(text, scope, project) {
  const end = text.indexOf('\n---', 3)
  if (!text.startsWith('---') || end === -1) throw new Error('missing frontmatter')
  const head = text.slice(0, end)
  const rest = text.slice(end)
  const withScope = head.replace(/^scope:.*$/mu, `scope: ${scope}`)
  const withProject = withScope.replace(/^project:.*$/mu, `project: ${project}`)
  if (withProject === head) throw new Error('frontmatter does not contain scope/project lines')
  return withProject + rest
}

/** Target absolute path of a migrated page. */
function targetPath(kind, scope, project, file) {
  if (scope === 'user') return join(ROOT, '_user', kind, basename(file))
  const root = PROJECT_ROOTS[project]
  if (!root) throw new Error(`unknown project root for "${project}"`)
  return join(root, '.dsh', 'llm-memory', kind, basename(file))
}

function main() {
  const sourceDirs = [join(ROOT, 'no-cwd'), join(ROOT, '_no-cwd')].filter((dir) => existsSync(dir))
  if (sourceDirs.length === 0) {
    console.log('No no-cwd directory found; nothing to migrate.')
    return
  }

  const files = sourceDirs.flatMap((dir) => listMarkdown(dir))
  const texts = new Map(files.map((file) => [file, readFileSync(file, 'utf8')]))
  const missing = Object.keys(MAP).filter((id) => ![...texts.values()].some((text) => text.includes(`id: ${id}`)))
  if (missing.length > 0) console.warn(`Map ids already migrated (skipped): ${missing.join(', ')}`)

  const moves = []
  for (const file of files) {
    const text = texts.get(file) ?? readFileSync(file, 'utf8')
    const id = field(text, 'id')
    const kind = field(text, 'kind') || 'facts'
    const target = MAP[id]
    if (!target) throw new Error(`No migration target for ${id} (${file})`)
    const scope = target.scope
    const project = scope === 'user' ? '' : target.project
    const next = rewrite(text, scope, project)
    const destination = targetPath(kind, scope, project, file)
    if (existsSync(destination) && destination !== file) {
      throw new Error(`Target already exists: ${destination}`)
    }
    moves.push({ id, file, destination, next, scope, project })
  }

  for (const move of moves) {
    console.log(
      `${APPLY ? 'move' : 'plan'}: ${move.id} -> scope=${move.scope} project=${move.project || '(user)'} ${move.destination}`,
    )
  }
  console.log(`Total: ${moves.length} pages (${APPLY ? 'applied' : 'dry-run'}).`)

  if (!APPLY) return

  for (const move of moves) {
    mkdirSync(dirname(move.destination), { recursive: true })
    writeFileSync(move.destination, move.next, 'utf8')
    if (move.destination !== move.file) unlinkSync(move.file)
  }

  // Refresh the project registry so the moved project pages are discovered.
  const registryPath = join(ROOT, 'projects.json')
  let registry = {}
  if (existsSync(registryPath)) {
    try {
      registry = JSON.parse(readFileSync(registryPath, 'utf8'))
    } catch {
      registry = {}
    }
  }
  for (const [key, root] of Object.entries(PROJECT_ROOTS)) {
    if (moves.some((move) => move.project === key)) registry[key] = root
  }
  const sorted = {}
  for (const key of Object.keys(registry).sort()) sorted[key] = registry[key]
  writeFileSync(registryPath, `${JSON.stringify(sorted, null, 2)}\n`, 'utf8')
  console.log(`Updated ${registryPath}`)

  for (const dir of sourceDirs) {
    const leftover = listMarkdown(dir)
    if (leftover.length > 0) throw new Error(`Leftover pages in ${dir}: ${leftover.join(', ')}`)
    rmSync(dir, { recursive: true, force: true })
    console.log(`Removed ${dir}`)
  }
}

main()

// Rebuild the derived index after the files moved.
if (APPLY) {
  const { MemoryStore } = await import('../lib/core/store.js')
  const store = new MemoryStore({ storageRoot: ROOT })
  const indexed = store.reindexFromDisk()
  store.close()
  console.log(`Reindexed ${indexed} entries from markdown.`)
}
