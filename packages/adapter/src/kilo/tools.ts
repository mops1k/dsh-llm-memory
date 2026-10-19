/**
 * Kilo tool surface: canonical `llm_memory_*` names, no `memory_*` aliases
 * (ADR-003). Descriptors are SDK-free; the plugin entry wraps them with the
 * Kilo `tool()` helper at runtime.
 */
import type { MemoryKind, MemoryTier } from '@llm-memory/core/domain/types'
import type { KiloService } from './service.js'

export type ToolArgType = 'string' | 'number' | 'boolean' | 'array'

export interface ToolArg {
  type: ToolArgType
  description: string
  optional?: boolean
  enum?: readonly string[]
}

export interface KiloTool {
  name: string
  description: string
  args: Record<string, ToolArg>
  execute(args: Record<string, unknown>): Promise<string>
}

/** Shape of the Kilo `tool()` helper and its `schema` factory (subset we use). */
export interface KiloMemoryToolsSdk {
  (definition: { description: string; args: Record<string, unknown>; execute: (args: Record<string, unknown>) => Promise<string> }): unknown
  schema: {
    string(): unknown
    number(): unknown
    boolean(): unknown
    array(inner: unknown): unknown
    enum(values: string[]): unknown
  }
}

export const KILO_TOOL_NAMES = [
  'llm_memory_recall',
  'llm_memory_save',
  'llm_memory_forget',
  'llm_memory_delete',
  'llm_memory_status',
  'llm_memory_lint',
  'llm_memory_graph',
] as const

const KIND_ENUM = ['rules', 'preferences', 'decisions', 'facts', 'architecture', 'concepts'] as const
const TIER_ENUM = ['normal', 'important', 'immutable'] as const

function asString(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  return typeof value === 'string' ? value : ''
}

export function kiloMemoryTools(service: KiloService): Record<string, KiloTool> {
  return {
    llm_memory_recall: {
      name: 'llm_memory_recall',
      description:
        'Search long-term memory. Call when the answer depends on earlier decisions, rules, preferences or project facts.',
      args: {
        query: { type: 'string', description: 'Search text; empty returns the most important active entries.', optional: true },
        scope: { type: 'string', description: 'global — user layer, project — this repo, all — both.', optional: true, enum: ['global', 'project', 'all'] },
        kind: { type: 'string', description: 'Restrict to one memory kind.', optional: true, enum: KIND_ENUM },
        format: { type: 'string', description: 'Rendering format.', optional: true, enum: ['markdown', 'table', 'timeline', 'json'] },
        limit: { type: 'number', description: 'Maximum entries.', optional: true },
      },
      async execute(args) {
        const result = service.recall(asString(args, 'query'), {
          ...(typeof args['limit'] === 'number' ? { limit: args['limit'] } : {}),
          ...(typeof args['scope'] === 'string' ? { scope: args['scope'] as 'global' | 'project' | 'all' } : {}),
          ...(typeof args['kind'] === 'string' ? { kind: args['kind'] as MemoryKind } : {}),
          ...(typeof args['format'] === 'string' ? { format: args['format'] as 'markdown' } : {}),
        })
        return result.text
      },
    },
    llm_memory_save: {
      name: 'llm_memory_save',
      description: 'Save durable knowledge: a rule, decision with rationale, project fact or preference.',
      args: {
        text: { type: 'string', description: 'Self-contained entry body.' },
        title: { type: 'string', description: 'Short title.', optional: true },
        kind: { type: 'string', description: 'Memory kind.', optional: true, enum: KIND_ENUM },
        tier: { type: 'string', description: 'Importance tier.', optional: true, enum: TIER_ENUM },
        scope: { type: 'string', description: 'project — this repo, global — user layer.', optional: true, enum: ['project', 'global'] },
        importance: { type: 'number', description: '1..5.', optional: true },
        tags: { type: 'array', description: 'Search tags.', optional: true },
        keywords: { type: 'string', description: 'Extra search terms.', optional: true },
      },
      async execute(args) {
        const entry = service.save({
          text: asString(args, 'text'),
          ...(typeof args['title'] === 'string' ? { title: args['title'] } : {}),
          ...(typeof args['kind'] === 'string' ? { kind: args['kind'] as MemoryKind } : {}),
          ...(typeof args['tier'] === 'string' ? { tier: args['tier'] as MemoryTier } : {}),
          ...(typeof args['scope'] === 'string' ? { scope: args['scope'] as 'project' | 'global' } : {}),
          ...(typeof args['importance'] === 'number' ? { importance: args['importance'] } : {}),
          ...(Array.isArray(args['tags']) ? { tags: args['tags'].map(String) } : {}),
          ...(typeof args['keywords'] === 'string' ? { keywords: args['keywords'] } : {}),
        })
        return `Сохранено: ${entry.id} — ${entry.title}`
      },
    },
    llm_memory_forget: {
      name: 'llm_memory_forget',
      description: 'Soft-delete: mark an entry superseded. The page and history stay on disk.',
      args: { id: { type: 'string', description: 'Entry id.' } },
      async execute(args) {
        const id = asString(args, 'id')
        return service.forget(id) ? `Помечено как superseded: ${id}` : `Не найдено: ${id}`
      },
    },
    llm_memory_delete: {
      name: 'llm_memory_delete',
      description: 'Hard-delete an entry: removes the row and its markdown page. Use only on request.',
      args: { id: { type: 'string', description: 'Entry id.' } },
      async execute(args) {
        const id = asString(args, 'id')
        return service.delete(id) ? `Удалено: ${id}` : `Не найдено: ${id}`
      },
    },
    llm_memory_status: {
      name: 'llm_memory_status',
      description: 'Memory state: totals, scopes, kinds and consolidation levels.',
      args: {},
      async execute() {
        const status = service.status()
        return [
          `Всего: ${status.total}, активных: ${status.active}`,
          `Скоупы: ${Object.entries(status.byScope).map(([k, v]) => `${k}=${v}`).join(', ') || '—'}`,
          `Виды: ${Object.entries(status.byKind).map(([k, v]) => `${k}=${v}`).join(', ') || '—'}`,
          `Консолидация: ${Object.entries(status.byConsolidation).map(([k, v]) => `${k}=${v}`).join(', ') || '—'}`,
        ].join('\n')
      },
    },
    llm_memory_lint: {
      name: 'llm_memory_lint',
      description: 'Report broken references, stale entries and duplicate titles.',
      args: {},
      async execute() {
        const { issues } = service.lint()
        if (issues.length === 0) return 'Проблем нет.'
        return issues.map(issue => `- ${issue.kind} ${issue.entryId}: ${issue.detail}`).join('\n')
      },
    },
    llm_memory_graph: {
      name: 'llm_memory_graph',
      description: 'Memory graph: entities, edges and the most connected hubs.',
      args: {},
      async execute() {
        const graph = service.graph()
        const degree = new Map<string, number>()
        for (const edge of graph.edges) {
          degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1)
          degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1)
        }
        const hubs = [...degree.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([id, value]) => `${id} (${value})`)
        return [`Сущностей: ${graph.entities.length}, связей: ${graph.edges.length}`, `Хабы: ${hubs.join(', ') || '—'}`].join('\n')
      },
    },
  }
}
