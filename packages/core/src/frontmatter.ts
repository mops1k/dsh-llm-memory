/**
 * Minimal YAML frontmatter encoder/decoder for memory pages.
 *
 * Adapted from the kilo-memory frontmatter algorithm: a handwritten parser that
 * supports strings, numbers, booleans, inline string arrays and empty values.
 * Nested structures are intentionally not supported because the memory model is
 * flat. Decoding also accepts the snake_case keys used by kilo-memory pages so
 * that existing stores can be read without a conversion step.
 */
import {
  clampImportance,
  isMemoryKind,
  isMemoryScope,
  isMemoryStatus,
  isMemoryTier,
  type MemoryEntry,
  type MemoryScope,
} from './types.js'

/** Order of keys in the serialized frontmatter (readability first). */
const KEY_ORDER = [
  'id',
  'scope',
  'project',
  'kind',
  'tier',
  'status',
  'title',
  'importance',
  'confidence',
  'source',
  'extKey',
  'tags',
  'keywords',
  'supersedes',
  'supersededBy',
  'related',
  'createdAt',
  'updatedAt',
] as const

/** Serialize a scalar or an inline string array as a YAML value. */
function yamlValue(value: unknown): string {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return '[' + value.map((item) => yamlString(String(item))).join(', ') + ']'
  return '[]'
}

function yamlString(value: string): string {
  if (value.length === 0) return '""'
  if (/^[A-Za-z0-9_.-]+$/.test(value) && !/^(true|false|null|yes|no)$/i.test(value)) {
    return value
  }
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return `"${escaped}"`
}

/** Parse a single YAML scalar or inline array from a raw value string. */
function parseYamlValue(raw: string): unknown {
  const value = raw.trim()
  if (value.length === 0) return ''
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1)
    if (inner.trim().length === 0) return []
    const out: string[] = []
    let current = ''
    let quote: string | null = null
    for (let i = 0; i < inner.length; i++) {
      const char = inner[i] ?? ''
      if (quote) {
        if (char === '\\' && i + 1 < inner.length) {
          current += inner[i + 1] ?? ''
          i++
          continue
        }
        if (char === quote) quote = null
        else current += char
        continue
      }
      if (char === '"' || char === "'") {
        quote = char
        continue
      }
      if (char === ',') {
        out.push(current.trim())
        current = ''
        continue
      }
      current += char
    }
    if (current.trim().length > 0) out.push(current.trim())
    return out
  }
  if (value === 'true') return true
  if (value === 'false') return false
  const n = Number(value)
  if (value !== '' && Number.isFinite(n) && /^-?\d+(\.\d+)?$/.test(value)) return n
  return value.replace(/^["']|["']$/g, '')
}

/**
 * Split a markdown page into frontmatter data and body content.
 * Pages without frontmatter yield `{ data: null, content: text }`.
 */
export function parsePage(text: string): { data: Record<string, unknown> | null; content: string } {
  if (!text.startsWith('---')) return { data: null, content: text }
  const firstNewline = text.indexOf('\n')
  if (firstNewline < 0) return { data: null, content: text }
  const end = text.indexOf('\n---', firstNewline + 1)
  if (end < 0) return { data: null, content: text }
  const frontmatter = text.slice(firstNewline + 1, end)
  const content = text.slice(end + 4).replace(/^\r?\n/, '')
  const data: Record<string, unknown> = {}
  for (const line of frontmatter.split(/\r?\n/)) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line)
    if (!match) continue
    const key = match[1]
    const value = match[2]
    if (key === undefined || value === undefined) continue
    data[key] = parseYamlValue(value)
  }
  return { data, content }
}

/** Serialize the frontmatter block (without the `---` fences). */
export function serializeFrontmatter(entry: Partial<MemoryEntry> & { id: string }): string {
  const fields: Record<string, unknown> = {
    id: entry.id,
    scope: entry.scope ?? 'project',
    project: entry.project ?? '',
    kind: entry.kind ?? 'facts',
    tier: entry.tier ?? 'normal',
    status: entry.status ?? 'active',
    title: entry.title ?? '',
    importance: entry.importance ?? 3,
    tags: entry.tags ?? [],
    keywords: entry.keywords ?? '',
    supersedes: entry.supersedes ?? [],
    supersededBy: entry.supersededBy ?? [],
    related: entry.related ?? [],
    createdAt: entry.createdAt ?? new Date().toISOString(),
    updatedAt: entry.updatedAt ?? new Date().toISOString(),
  }
  if (typeof entry.confidence === 'number') fields.confidence = entry.confidence
  if (typeof entry.source === 'string' && entry.source.length > 0) fields.source = entry.source
  if (typeof entry.extKey === 'string' && entry.extKey.length > 0) fields.extKey = entry.extKey

  const lines: string[] = []
  for (const key of KEY_ORDER) {
    if (!(key in fields)) continue
    lines.push(`${key}: ${yamlValue(fields[key])}`)
  }
  return lines.join('\n')
}

/** Build a full markdown page from an entry. */
export function pageToText(entry: Partial<MemoryEntry> & { id: string }): string {
  const body = (entry.text ?? '').trimEnd()
  return `---\n${serializeFrontmatter(entry)}\n---\n${body}\n`
}

export interface EntryPageDefaults {
  scope?: MemoryScope
  project?: string
}

function pickString(data: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = data[key]
    if (typeof value === 'string') return value
  }
  return undefined
}

function pickNumber(data: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = data[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim().length > 0) {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) return parsed
    }
  }
  return undefined
}

function pickArray(data: Record<string, unknown>, keys: string[]): string[] {
  for (const key of keys) {
    const value = data[key]
    if (Array.isArray(value)) return value.map(String)
    if (typeof value === 'string' && value.trim().length > 0) return [value]
  }
  return []
}

/**
 * Decode a markdown page into a memory entry.
 * Returns null when the page has no usable `id`.
 */
export function entryFromPage(text: string, defaults: EntryPageDefaults = {}): MemoryEntry | null {
  const { data, content } = parsePage(text)
  if (!data) return null
  const id = pickString(data, ['id'])
  if (!id) return null

  const scopeRaw = pickString(data, ['scope'])
  const scope: MemoryScope = isMemoryScope(scopeRaw) ? scopeRaw : defaults.scope ?? 'project'
  const project = pickString(data, ['project', 'project_root', 'projectRoot']) ?? defaults.project ?? ''
  const kindRaw = pickString(data, ['kind'])
  const tierRaw = pickString(data, ['tier'])
  const statusRaw = pickString(data, ['status'])
  const title = pickString(data, ['title']) ?? '(untitled)'
  const keywords = pickString(data, ['keywords']) ?? ''
  const source = pickString(data, ['source'])
  const extKey = pickString(data, ['extKey', 'ext_key'])
  const createdAt = pickString(data, ['createdAt', 'created_at'])
  const updatedAt = pickString(data, ['updatedAt', 'updated_at'])
  const confidence = pickNumber(data, ['confidence'])
  const now = new Date().toISOString()

  return {
    id,
    scope,
    project,
    kind: isMemoryKind(kindRaw) ? kindRaw : 'facts',
    tier: isMemoryTier(tierRaw) ? tierRaw : 'normal',
    status: isMemoryStatus(statusRaw) ? statusRaw : 'active',
    title,
    text: content.trim(),
    tags: pickArray(data, ['tags']),
    keywords,
    importance: clampImportance(pickNumber(data, ['importance'])),
    supersedes: pickArray(data, ['supersedes']),
    supersededBy: pickArray(data, ['supersededBy', 'superseded_by']),
    related: pickArray(data, ['related']),
    ...(source !== undefined ? { source } : {}),
    ...(extKey !== undefined ? { extKey } : {}),
    createdAt: createdAt ?? now,
    updatedAt: updatedAt ?? now,
    ...(confidence !== undefined ? { confidence } : {}),
  }
}
