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
