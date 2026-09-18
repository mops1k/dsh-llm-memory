/**
 * Model-facing memory tools registered on `ctx.tools`.
 *
 * Seven tools map one-to-one onto {@link MemoryEngine} operations:
 * `llm_memory_recall`, `llm_memory_save`, `llm_memory_forget`,
 * `llm_memory_delete`, `llm_memory_status`, `llm_memory_lint` and
 * `llm_memory_heal`. Every tool is
 * autonomous: it performs the requested operation without asking the user for
 * confirmation, regardless of the UI-level `requireConfirmation` flag. Names
 * carry the `llm_memory_` prefix and registration skips a name another plugin
 * already owns.
 *
 * @module dsh-llm-memory/dsh/tools
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools'

import type { MemoryConfig } from '../core/config.js'
import type { MemoryEngine } from '../core/engine.js'
import { projectKeyFromCwd } from '../core/paths.js'
import type { MemoryEntry } from '../core/types.js'
import { MEMORY_KINDS, MEMORY_SCOPES, MEMORY_TIERS, clampImportance } from '../core/types.js'

/** Shared autonomy clause appended to every tool description. */
const AUTONOMY_NOTE = 'Runs autonomously: never asks the user for confirmation.'

/** Enum options for the `format` parameter of `memory_recall`. */
const RECALL_FORMATS = ['markdown', 'table', 'timeline', 'json'] as const

/** Structural view of `ctx.sessions` limited to what a memory tool needs. */
export interface SessionStoreLike {
  get(id: string): { header?: { cwd?: string } } | undefined
}

/** Structural view of the tool execution needed to find the calling session. */
export interface ToolExecutionLike {
  agent?: { id?: unknown }
}

/**
 * Resolve `ctx.sessions` without requiring it to be injected: try the reflected
 * property, the `ctx.get` mixin and finally the non-strict reflection lookup,
 * which works without an `inject` declaration. Mirrors the workspace-registry
 * resolution in `web.ts`.
 */
export function resolveSessionStore(ctx: Context): SessionStoreLike | undefined {
  const source = ctx as unknown as {
    sessions?: unknown
    get?: (name: string) => unknown
    reflect?: { get?: (name: string, strict?: boolean) => unknown }
  }
  const candidates: Array<() => unknown> = [
    () => source.sessions,
    () => source.get?.('sessions'),
    () => source.reflect?.get?.('sessions', false),
  ]
  for (const read of candidates) {
    try {
      const value = read()
      if (value !== null && typeof value === 'object' && typeof (value as SessionStoreLike).get === 'function') {
        return value as SessionStoreLike
      }
    } catch {
      /* try the next resolution path */
    }
  }
  return undefined
}

/**
 * Project key of the session that issued a tool call (basename of its cwd).
 *
 * Returns `null` when the host has no session store, the execution has no
 * agent, or the session carries no cwd — callers then fall back to the engine's
 * own default key instead of inventing a project.
 */
export function sessionProjectKey(ctx: Context, exec: unknown): string | null {
  const sessions = resolveSessionStore(ctx)
  if (!sessions) return null
  const agentId = (exec as ToolExecutionLike | undefined)?.agent?.id
  if (agentId === undefined || agentId === null) return null
  const id = String(agentId)
  if (id.length === 0) return null
  try {
    const cwd = sessions.get(id)?.header?.cwd
    if (typeof cwd !== 'string' || cwd.trim().length === 0) return null
    return projectKeyFromCwd(cwd)
  } catch {
    return null
  }
}

/**
 * Unique, plugin-prefixed tool names. The `llm_memory_` prefix keeps the seven
 * tools from colliding with other memory plugins (dsh-mnemon, dsh-memory, …).
 */
export const MEMORY_TOOL_NAMES = [
  'llm_memory_recall',
  'llm_memory_save',
  'llm_memory_forget',
  'llm_memory_delete',
  'llm_memory_status',
  'llm_memory_lint',
  'llm_memory_heal',
] as const

/** Sink for non-fatal registration problems (a colliding name, a failed register). */
export interface MemoryToolLogger {
  warn(message: string): void
}

/** Describe an unknown thrown value for a warning message. */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Log a warning through the Cordis logger, falling back to the console. */
function warnTool(ctx: Context, message: string): void {
  try {
    ctx.logger.warn(message)
  } catch {
    console.warn(`[dsh-llm-memory] ${message}`)
  }
}

/**
 * Register one tool without ever colliding with an existing registration.
 *
 * The name is probed through the public registry first (`ctx.tools.get`); a
 * taken name is skipped with a warning. `register` itself is wrapped so an
 * unexpected duplicate (or a registry without a public `get`) also degrades to
 * a warning instead of failing plugin activation.
 *
 * @returns `true` when the tool was registered.
 */
function registerMemoryTool(ctx: Context, definition: ToolDefinition): boolean {
  try {
    const existing = ctx.tools.get(definition.name)
    if (existing) {
      warnTool(
        ctx,
        `Tool "${definition.name}" is already registered by another plugin; skipping to avoid a name collision.`,
      )
      return false
    }
  } catch (error) {
    warnTool(ctx, `Could not probe tool name "${definition.name}": ${errorMessage(error)}.`)
  }
  try {
    ctx.tools.register(definition)
    return true
  } catch (error) {
    warnTool(ctx, `Tool "${definition.name}" could not be registered: ${errorMessage(error)}; skipping.`)
    return false
  }
}

/**
 * JSON projection of a memory entry shared by the recall and save output
 * schemas. Kept in sync with {@link toEntryView}.
 */
const ENTRY_VIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true, description: 'Stable entry id.' },
    title: { type: 'string', required: true, description: 'Short entry title.' },
    text: { type: 'string', required: true, description: 'Entry body without frontmatter.' },
    kind: { type: 'string', required: true, description: 'Entry category.' },
    scope: { type: 'string', required: true, description: 'project or user layer.' },
    project: { type: 'string', required: true, description: 'Project key; empty for the user layer.' },
    tier: { type: 'string', required: true, description: 'normal, important or immutable.' },
    status: { type: 'string', required: true, description: 'active, superseded or archived.' },
    importance: { type: 'integer', required: true, description: 'Importance from 1 to 5.' },
    confidence: { type: 'number', required: true, description: 'Confidence from 0 to 1.' },
    tags: { type: 'array', required: true, items: { type: 'string' }, description: 'Entry tags.' },
    supersedes: { type: 'array', required: true, items: { type: 'string' }, description: 'Replaced entry ids.' },
    supersededBy: {
      type: 'array',
      required: true,
      items: { type: 'string' },
      description: 'Ids of entries that replaced this one.',
    },
    related: { type: 'array', required: true, items: { type: 'string' }, description: 'Related entry ids.' },
    createdAt: { type: 'string', required: true, description: 'ISO-8601 creation time.' },
    updatedAt: { type: 'string', required: true, description: 'ISO-8601 last update time.' },
  },
} as const

/** Project a `MemoryEntry` onto the shape declared by {@link ENTRY_VIEW_SCHEMA}. */
function toEntryView(entry: MemoryEntry): {
  id: string
  title: string
  text: string
  kind: string
  scope: string
  project: string
  tier: string
  status: string
  importance: number
  confidence: number
  tags: string[]
  supersedes: string[]
  supersededBy: string[]
  related: string[]
  createdAt: string
  updatedAt: string
} {
  return {
    id: entry.id,
    title: entry.title,
    text: entry.text,
    kind: entry.kind,
    scope: entry.scope,
    project: entry.project,
    tier: entry.tier,
    status: entry.status,
    importance: entry.importance,
    confidence: entry.confidence ?? 0.5,
    tags: [...entry.tags],
    supersedes: [...entry.supersedes],
    supersededBy: [...entry.supersededBy],
    related: [...entry.related],
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  }
}

/** Render a `Record<string, number>`-shaped counter as `key=value` pairs. */
function formatCounts(record: Record<string, unknown>): string {
  const entries = Object.entries(record)
  if (entries.length === 0) return 'none'
  return entries.map(([key, value]) => `${key}=${String(value)}`).join(', ')
}

/**
 * Register the seven memory tools (recall/save/forget/delete/status/lint/heal).
 *
 * A tool whose name is already owned by another plugin is skipped with a
 * warning instead of failing activation.
 *
 * @returns the names that were actually registered.
 */
export function registerMemoryTools(ctx: Context, engine: MemoryEngine, config: MemoryConfig): string[] {
  const defaultLimit = config.recallLimit
  const registered: string[] = []
  const register = (definition: ToolDefinition): void => {
    if (registerMemoryTool(ctx, definition)) registered.push(definition.name)
  }

  register(
    defineTool({
      name: 'llm_memory_recall',
      description:
        'Search long-term memory and return the most relevant entries, ranked for the current query. ' +
        'Call it before answering questions about user preferences, past decisions, project facts or earlier work. ' +
        'The default `markdown` rendering is human-readable; `table`, `timeline` and `json` are available for structured consumption. ' +
        AUTONOMY_NOTE,
      parameters: {
        query: { type: 'string', required: true, description: 'Search query; use the user question or task topic.' },
        kind: {
          type: 'string',
          enum: [...MEMORY_KINDS],
          description: 'Restrict results to one entry category.',
        },
        scope: {
          type: 'string',
          enum: ['project', 'user', 'all'],
          description:
            'Restrict results: project = the current session project plus the cross-project user layer (default); ' +
            'user = the cross-project layer only; all = every project and the user layer.',
        },
        project: {
          type: 'string',
          description: 'Restrict project entries to one project key (default: the current session project).',
        },
        limit: { type: 'integer', description: `Maximum number of entries to return (default ${defaultLimit}).` },
        format: {
          type: 'string',
          enum: [...RECALL_FORMATS],
          description: 'Rendering format of the returned text.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            format: { type: 'string', required: true, enum: [...RECALL_FORMATS] },
            count: { type: 'integer', required: true, description: 'Number of returned entries.' },
            text: { type: 'string', required: true, description: 'Rendered entries in the requested format.' },
            items: { type: 'array', required: true, items: ENTRY_VIEW_SCHEMA, description: 'Ranked entries.' },
          },
        },
        render: (_args, value) => [
          { type: 'text', text: value.text.length > 0 ? value.text : 'No matching memory entries.' },
        ],
      },
      execute: async (args, exec) => {
        const effectiveScope = args.scope ?? config.recallScope
        const projectKey = sessionProjectKey(ctx, exec)
        const project =
          args.project ?? (effectiveScope === 'project' && projectKey !== null ? projectKey : undefined)
        const result = engine.recall(args.query, {
          ...(args.kind !== undefined ? { kind: args.kind } : {}),
          ...(args.scope !== undefined ? { scope: args.scope } : {}),
          ...(project !== undefined ? { project } : {}),
          ...(args.limit !== undefined ? { limit: args.limit } : {}),
          ...(args.format !== undefined ? { format: args.format } : {}),
        })
        return {
          format: result.format,
          count: result.items.length,
          text: result.text,
          items: result.items.map(toEntryView),
        }
      },
    }),
  )

  register(
    defineTool({
      name: 'llm_memory_save',
      description:
        'Save one durable memory entry (a fact, decision, preference, rule, architecture detail or concept). ' +
        'Save immediately after learning durable knowledge; do not wait for the user to ask. ' +
        'Choose `kind`, `scope`, `tier` (`normal`, `important` or `immutable`) and `importance` (1-5) yourself. ' +
        'Project entries are attached to the project of the calling session (basename of its working directory). ' +
        'To replace outdated knowledge, list the old entry ids in `supersedes`; those entries are marked superseded. ' +
        AUTONOMY_NOTE,
      parameters: {
        title: { type: 'string', required: true, description: 'Short, specific title.' },
        text: { type: 'string', required: true, description: 'Self-contained entry body with concrete facts.' },
        kind: { type: 'string', enum: [...MEMORY_KINDS], description: 'Entry category (default facts).' },
        scope: { type: 'string', enum: [...MEMORY_SCOPES], description: 'project (default) or user layer.' },
        tier: {
          type: 'string',
          enum: [...MEMORY_TIERS],
          description: 'How strongly the entry resists forgetting (default normal).',
        },
        importance: { type: 'integer', description: 'Importance from 1 to 5 (default 3).' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Search tags.' },
        keywords: { type: 'string', description: 'Extra search terms, synonyms or word forms.' },
        supersedes: { type: 'array', items: { type: 'string' }, description: 'Ids of entries this one replaces.' },
        related: { type: 'array', items: { type: 'string' }, description: 'Ids of related entries.' },
      },
      output: {
        schema: ENTRY_VIEW_SCHEMA,
        render: (_args, value) => [
          { type: 'text', text: `Saved memory entry ${value.id} "${value.title}" (${value.kind}, ${value.scope}).` },
        ],
      },
      execute: async (args, exec) => {
        if (
          args.importance !== undefined &&
          (!Number.isInteger(args.importance) || args.importance < 1 || args.importance > 5)
        ) {
          throw new Error('importance must be an integer between 1 and 5')
        }
        const scope = args.scope ?? 'project'
        const projectKey = scope === 'user' ? null : sessionProjectKey(ctx, exec)
        const saved = engine.save({
          title: args.title,
          text: args.text,
          ...(args.kind !== undefined ? { kind: args.kind } : {}),
          ...(args.scope !== undefined ? { scope: args.scope } : {}),
          ...(projectKey !== null ? { project: projectKey } : {}),
          ...(args.tier !== undefined ? { tier: args.tier } : {}),
          ...(args.importance !== undefined ? { importance: clampImportance(args.importance) } : {}),
          ...(args.tags !== undefined ? { tags: args.tags } : {}),
          ...(args.keywords !== undefined ? { keywords: args.keywords } : {}),
          ...(args.supersedes !== undefined ? { supersedes: args.supersedes } : {}),
          ...(args.related !== undefined ? { related: args.related } : {}),
        })
        return toEntryView(saved)
      },
    }),
  )

  register(
    defineTool({
      name: 'llm_memory_forget',
      description:
        'Mark a memory entry as forgotten (superseded) so it stops appearing in recall. ' +
        'Non-destructive: the markdown page is kept and can still be inspected. ' +
        'Use it for outdated knowledge that is not replaced by a new entry. ' +
        AUTONOMY_NOTE,
      parameters: {
        id: { type: 'string', required: true, description: 'Memory entry id to forget.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true, description: 'Forgotten entry id.' },
            title: { type: 'string', required: true, description: 'Forgotten entry title.' },
            status: { type: 'string', required: true, description: 'New entry status.' },
            message: { type: 'string', required: true, description: 'Human-readable result message.' },
          },
        },
        render: (_args, value) => [{ type: 'text', text: value.message }],
      },
      execute: async (args) => {
        const result = engine.forget(args.id)
        if (!result.ok || !result.entry) {
          throw new Error(result.message.length > 0 ? result.message : `Memory entry not found: ${args.id}`)
        }
        return {
          id: result.entry.id,
          title: result.entry.title,
          status: result.entry.status,
          message: result.message,
        }
      },
    }),
  )

  register(
    defineTool({
      name: 'llm_memory_delete',
      description:
        'Permanently delete a memory entry, its markdown page and every reference to it. ' +
        'This is irreversible; prefer `memory_forget` unless the entry must be erased. ' +
        AUTONOMY_NOTE,
      parameters: {
        id: { type: 'string', required: true, description: 'Memory entry id to delete.' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string', required: true, description: 'Deleted entry id.' },
            deleted: { type: 'boolean', required: true, description: 'Always true on success.' },
          },
        },
        render: (args) => [{ type: 'text', text: `Deleted memory entry ${args.id}.` }],
      },
      execute: async (args) => {
        const deleted = engine.delete(args.id)
        if (!deleted) throw new Error(`Memory entry not found: ${args.id}`)
        return { id: args.id, deleted: true }
      },
    }),
  )

  register(
    defineTool({
      name: 'llm_memory_status',
      description:
        'Report memory storage statistics: storage root, database path and size, totals and ' +
        'breakdowns by status, scope, kind and project. ' +
        AUTONOMY_NOTE,
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            root: { type: 'string', required: true, description: 'Storage root directory.' },
            dbPath: { type: 'string', required: true, description: 'SQLite index path.' },
            dbSizeBytes: { type: 'integer', required: true, description: 'Index file size in bytes.' },
            total: { type: 'integer', required: true, description: 'Total number of entries.' },
            active: { type: 'integer', required: true, description: 'Number of active entries.' },
            byStatus: {
              type: 'object',
              additionalProperties: true,
              required: true,
              description: 'Counts keyed by status.',
            },
            byScope: {
              type: 'object',
              additionalProperties: true,
              required: true,
              description: 'Counts keyed by scope.',
            },
            byKind: {
              type: 'object',
              additionalProperties: true,
              required: true,
              description: 'Counts keyed by kind.',
            },
            byProject: {
              type: 'object',
              additionalProperties: true,
              required: true,
              description: 'Counts keyed by project.',
            },
          },
        },
        render: (_args, value) => {
          const lines = [
            `Memory status: ${value.total} entries (${value.active} active).`,
            `- root: ${value.root}`,
            `- database: ${value.dbPath} (${value.dbSizeBytes} bytes)`,
            `- by status: ${formatCounts(value.byStatus)}`,
            `- by scope: ${formatCounts(value.byScope)}`,
            `- by kind: ${formatCounts(value.byKind)}`,
            `- by project: ${formatCounts(value.byProject)}`,
          ]
          return [{ type: 'text', text: lines.join('\n') }]
        },
      },
      execute: async () => {
        const report = engine.statusReport()
        return {
          root: report.root,
          dbPath: report.dbPath,
          dbSizeBytes: report.dbSizeBytes,
          total: report.total,
          active: report.active,
          byStatus: report.byStatus,
          byScope: report.byScope,
          byKind: report.byKind,
          byProject: report.byProject,
        }
      },
    }),
  )

  register(
    defineTool({
      name: 'llm_memory_lint',
      description:
        'Run a health check over long-term memory: broken relation links, significantly ' +
        'overlapping active entries and stale entries. Use it to keep the store clean. ' +
        AUTONOMY_NOTE,
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            totalCount: { type: 'integer', required: true, description: 'Total number of entries.' },
            activeCount: { type: 'integer', required: true, description: 'Number of active entries.' },
            overlapsHidden: { type: 'integer', required: true, description: 'Overlap pairs hidden by the cap.' },
            staleDays: { type: 'integer', required: true, description: 'Staleness threshold in days.' },
            brokenLinks: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  id: { type: 'string', required: true },
                  title: { type: 'string', required: true },
                  field: { type: 'string', required: true },
                  missingId: { type: 'string', required: true },
                },
              },
              description: 'Links pointing at entries that do not exist.',
            },
            overlaps: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  a: { type: 'string', required: true },
                  b: { type: 'string', required: true },
                  aTitle: { type: 'string', required: true },
                  bTitle: { type: 'string', required: true },
                  common: { type: 'integer', required: true },
                  score: { type: 'number', required: true },
                },
              },
              description: 'Active entry pairs with a significant lexical overlap.',
            },
            stale: {
              type: 'array',
              required: true,
              items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  id: { type: 'string', required: true },
                  title: { type: 'string', required: true },
                  updatedAt: { type: 'string', required: true },
                },
              },
              description: 'Active entries not updated for a long time.',
            },
          },
        },
        render: (_args, value) => {
          const lines = [
            `Memory lint: ${value.totalCount} entries, ${value.activeCount} active.`,
            `- broken relation links: ${value.brokenLinks.length}`,
            `- overlapping active pairs: ${value.overlaps.length} (hidden by cap: ${value.overlapsHidden})`,
            `- stale entries older than ${value.staleDays} days: ${value.stale.length}`,
          ]
          return [{ type: 'text', text: lines.join('\n') }]
        },
      },
      execute: async () => {
        const report = engine.lintReport()
        return {
          totalCount: report.totalCount,
          activeCount: report.activeCount,
          overlapsHidden: report.overlapsHidden,
          staleDays: report.staleDays,
          brokenLinks: report.brokenLinks.map((link) => ({
            id: link.id,
            title: link.title,
            field: link.field,
            missingId: link.missingId,
          })),
          overlaps: report.overlaps.map((overlap) => ({
            a: overlap.a,
            b: overlap.b,
            aTitle: overlap.aTitle,
            bTitle: overlap.bTitle,
            common: overlap.common,
            score: overlap.score,
          })),
          stale: report.stale.map((entry) => ({
            id: entry.id,
            title: entry.title,
            updatedAt: entry.updatedAt,
          })),
        }
      },
    }),
  )

  register(
    defineTool({
      name: 'llm_memory_heal',
      description:
        'Repair long-term memory safely: remove relation links that point at missing entries and add ' +
        'missing reverse links (`supersededBy` for `supersedes`, symmetric `related`), then rebuild the ' +
        'search index. Non-destructive: it never deletes entries or changes their status. ' +
        AUTONOMY_NOTE,
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            removedLinks: { type: 'integer', required: true, description: 'Broken relation references removed.' },
            addedBacklinks: { type: 'integer', required: true, description: 'Missing reverse links added.' },
            reindexed: { type: 'integer', required: true, description: 'Entries rebuilt from markdown.' },
            brokenBefore: { type: 'integer', required: true, description: 'Broken links before healing.' },
            brokenAfter: { type: 'integer', required: true, description: 'Broken links after healing.' },
          },
        },
        render: (_args, value) => {
          const lines = [
            `Memory heal: removed ${value.removedLinks} broken link(s), added ${value.addedBacklinks} backlink(s).`,
            `- reindexed entries: ${value.reindexed}`,
            `- broken links: ${value.brokenBefore} -> ${value.brokenAfter}`,
          ]
          return [{ type: 'text', text: lines.join('\n') }]
        },
      },
      execute: async () => {
        const report = engine.heal()
        return {
          removedLinks: report.removedLinks,
          addedBacklinks: report.addedBacklinks,
          reindexed: report.reindexed,
          brokenBefore: report.brokenBefore,
          brokenAfter: report.brokenAfter,
        }
      },
    }),
  )

  return registered
}
