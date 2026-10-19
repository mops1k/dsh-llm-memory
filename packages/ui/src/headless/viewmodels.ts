/**
 * Pure view models for the shared screens. Structural input types keep the UI
 * independent from core internals; hosts pass plain JSON.
 */
import type { Translator } from './i18n.js'
import { SETTINGS, SETTINGS_SECTIONS, type SettingValues } from './settings.js'

export interface StatusReportLike {
  total: number
  active: number
  byScope?: Record<string, number>
  byKind?: Record<string, number>
  projects?: number
  updatedAt?: string
}

export interface MemoryEntryLike {
  id: string
  title: string
  kind: string
  tier: string
  status: string
  scope: string
  project?: string
  importance?: number
  updatedAt: string
}

export interface GraphLike {
  entities: { id: string; name: string; kind?: string }[]
  edges: { source: string; target: string; type?: string }[]
}

export interface LintLike {
  issues: { entryId?: string; message: string; severity?: string }[]
}

export interface HealthLike {
  vectors?: { enabled: boolean; provider: string; entries?: number }
  model?: { name: string; present: boolean }
  ports?: Record<string, 'free' | 'busy'>
}

export interface StatusVm {
  title: string
  rows: { label: string; value: string }[]
}

export function statusVm(report: StatusReportLike, t: Translator): StatusVm {
  const scopes = Object.entries(report.byScope ?? {})
    .map(([scope, count]) => `${scope}: ${count}`)
    .join(', ')
  return {
    title: t.t('nav.status'),
    rows: [
      { label: t.t('status.entries'), value: String(report.total) },
      { label: t.t('status.active'), value: String(report.active) },
      { label: t.t('status.scopes'), value: scopes || '—' },
      { label: t.t('status.projects'), value: String(report.projects ?? 0) },
      { label: t.t('status.lastUpdated'), value: report.updatedAt ?? '—' },
    ],
  }
}

export interface ItemRowVm {
  id: string
  title: string
  kind: string
  tier: string
  status: string
  scope: string
  project: string
  importance: number
  updatedAt: string
}

export function itemsVm(entries: readonly MemoryEntryLike[]): ItemRowVm[] {
  return entries.map(entry => ({
    id: entry.id,
    title: entry.title,
    kind: entry.kind,
    tier: entry.tier,
    status: entry.status,
    scope: entry.scope,
    project: entry.project ?? '',
    importance: entry.importance ?? 3,
    updatedAt: entry.updatedAt,
  }))
}

export interface GraphVm {
  entities: number
  edges: number
  hubs: { id: string; name: string; degree: number }[]
}

export function graphVm(graph: GraphLike): GraphVm {
  const degree = new Map<string, number>()
  const names = new Map(graph.entities.map(entity => [entity.id, entity.name]))
  for (const edge of graph.edges) {
    degree.set(edge.source, (degree.get(edge.source) ?? 0) + 1)
    degree.set(edge.target, (degree.get(edge.target) ?? 0) + 1)
  }
  const hubs = [...degree.entries()]
    .map(([id, value]) => ({ id, name: names.get(id) ?? id, degree: value }))
    .sort((a, b) => b.degree - a.degree)
    .slice(0, 5)
  return { entities: graph.entities.length, edges: graph.edges.length, hubs }
}

export interface LintVm {
  ok: boolean
  issues: { entryId: string; message: string; severity: string }[]
}

export function lintVm(report: LintLike): LintVm {
  return {
    ok: report.issues.length === 0,
    issues: report.issues.map(issue => ({
      entryId: issue.entryId ?? '',
      message: issue.message,
      severity: issue.severity ?? 'warning',
    })),
  }
}

export interface HealthVm {
  labels: { vectors: string; model: string; ports: string }
  vectors: string
  model: string
  ports: { port: string; state: string }[]
}

export function healthVm(health: HealthLike, t: Translator): HealthVm {
  return {
    labels: { vectors: t.t('health.vectors'), model: t.t('health.model'), ports: t.t('health.ports') },
    vectors: health.vectors ? `${health.vectors.provider} (${health.vectors.enabled ? 'on' : 'off'})` : '—',
    model: health.model ? `${health.model.name} (${health.model.present ? 'present' : 'missing'})` : '—',
    ports: Object.entries(health.ports ?? {}).map(([port, state]) => ({ port, state })),
  }
}

export interface SettingFieldVm {
  key: string
  label: string
  kind: string
  value: string | number | boolean
  min?: number
  max?: number
  step?: number
  options?: readonly string[]
}

export interface SettingsVm {
  sections: { id: string; title: string; fields: SettingFieldVm[] }[]
}

export function settingsVm(values: SettingValues, t: Translator): SettingsVm {
  return {
    sections: SETTINGS_SECTIONS.map(section => ({
      id: section.id,
      title: t.t(section.titleKey as Parameters<Translator['t']>[0]),
      fields: SETTINGS.filter(item => item.section === section.id).map(item => ({
        key: item.key,
        label: t.t(item.labelKey as Parameters<Translator['t']>[0]),
        kind: item.kind,
        value: values[item.key] ?? item.default,
        ...(item.min !== undefined ? { min: item.min } : {}),
        ...(item.max !== undefined ? { max: item.max } : {}),
        ...(item.step !== undefined ? { step: item.step } : {}),
        ...(item.options ? { options: item.options } : {}),
      })),
    })),
  }
}
