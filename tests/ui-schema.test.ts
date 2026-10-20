import { describe, expect, it } from 'vitest'
import {
  UI_KNOWN_ACTIONS,
  UI_OPERATIONS,
  UI_SCHEMA_VERSION,
  UI_VIEWS,
  UI_VIEW_IDS,
  uiReferencedActions,
  uiReferencedOperations,
} from '@llm-memory/core/domain/ui-schema.js'

describe('universal UI schema', () => {
  it('has unique view ids and a version', () => {
    expect(UI_SCHEMA_VERSION).toBeGreaterThan(0)
    expect(new Set(UI_VIEW_IDS).size).toBe(UI_VIEW_IDS.length)
    for (const view of UI_VIEWS) {
      expect(view.title.length).toBeGreaterThan(0)
      expect(view.widgets.length).toBeGreaterThan(0)
    }
  })

  it('covers every screen a panel renders', () => {
    for (const required of [
      'overview',
      'items',
      'editor',
      'graph',
      'map',
      'recall',
      'health',
      'settings',
      'backup',
      'model',
    ]) {
      expect(UI_VIEW_IDS).toContain(required)
    }
  })

  it('includes the RAG vector map reading vectors.map and health', () => {
    const map = UI_VIEWS.find(view => view.id === 'map')
    expect(map).toBeDefined()
    const kinds = map?.widgets.map(widget => widget.kind) ?? []
    expect(kinds).toContain('vector-map')
    const vectorMap = map?.widgets.find(widget => widget.kind === 'vector-map')
    if (vectorMap?.kind !== 'vector-map') throw new Error('vector-map widget is missing')
    expect(vectorMap.source.operation).toBe('vectors.map')
    expect(vectorMap.extra?.map(extra => extra.operation)).toContain('vectors.health')
    expect(map?.widgets.some(widget => widget.kind === 'actions' && widget.actions.includes('vectors.rebuild'))).toBe(true)
  })

  it('offers RAG healing actions on the health view', () => {
    const health = UI_VIEWS.find(view => view.id === 'health')
    const actions = health?.widgets.find(widget => widget.kind === 'actions')
    if (actions?.kind !== 'actions') throw new Error('health actions are missing')
    for (const id of ['heal.report', 'heal.apply', 'vectors.health', 'vectors.repair', 'vectors.embed', 'vectors.rebuild']) {
      expect(actions.actions).toContain(id)
    }
  })

  it('declares pagination for entry lists', () => {
    const items = UI_VIEWS.find(view => view.id === 'items')
    const table = items?.widgets.find(widget => widget.kind === 'table')
    if (table?.kind !== 'table') throw new Error('items table is missing')
    expect(table.pagination?.pageSizes).toEqual([12, 24, 48, 96])
    expect(table.pagination?.defaultPageSize).toBe(24)
    const recall = UI_VIEWS.find(view => view.id === 'recall')
    const search = recall?.widgets.find(widget => widget.kind === 'search')
    if (search?.kind !== 'search') throw new Error('recall search is missing')
    expect(search.pagination?.pageSizes.length).toBeGreaterThan(1)
  })

  it('references only known data operations', () => {
    const known = new Set(UI_OPERATIONS)
    const unknown = uiReferencedOperations().filter(operation => !known.has(operation))
    expect(unknown).toEqual([])
  })

  it('references only registered actions', () => {
    const known = new Set(UI_KNOWN_ACTIONS)
    const unknown = uiReferencedActions().filter(action => !known.has(action))
    expect(unknown).toEqual([])
  })
})
