import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '@llm-memory/core/domain/config.js'
import { SETTINGS_ACTIONS, SETTINGS_GROUPS } from '@llm-memory/core/domain/settings-schema.js'
const settingActions = SETTINGS_ACTIONS
import { UI_VIEW_IDS } from '@llm-memory/core/domain/ui-schema.js'
import {
  UI_ACTION_NAMES,
  UI_CONTRACT_VERSION,
  actionError,
  actionOk,
  isUIAction,
  settingsSnapshot,
  uiSnapshot,
} from '@llm-memory/core/domain/ui-contract.js'

describe('UI SDK contract', () => {
  it('exposes the whole schema and every action to a panel', () => {
    const snapshot = settingsSnapshot(DEFAULT_CONFIG)
    expect(snapshot.version).toBe(UI_CONTRACT_VERSION)
    expect(snapshot.groups).toBe(SETTINGS_GROUPS)
    expect(snapshot.actions).toBe(SETTINGS_ACTIONS)
    const paths = SETTINGS_GROUPS.flatMap(group => group.fields.map(field => field.path))
    expect(Object.keys(snapshot.values).sort()).toEqual([...paths].sort())
  })

  it('derives callable action names from the registry and rejects unknown ones', () => {
    expect(UI_ACTION_NAMES).toEqual(SETTINGS_ACTIONS.map(action => action.id))
    for (const action of SETTINGS_ACTIONS) expect(isUIAction(action.id)).toBe(true)
    expect(isUIAction('backup.drop-everything')).toBe(false)
  })

  it('bundles screens, settings and actions into one panel snapshot', () => {
    const snapshot = uiSnapshot(DEFAULT_CONFIG)
    expect(snapshot.version).toBeGreaterThan(0)
    expect(snapshot.views.map(view => view.id)).toEqual([...UI_VIEW_IDS])
    expect(snapshot.settings.groups.length).toBeGreaterThan(0)
    expect(snapshot.actions.length).toBe(settingActions.length)
    expect(snapshot.operations.length).toBeGreaterThan(0)
  })

  it('serializes responses without losing the error/ok contract', () => {
    expect(actionOk({ entries: 2 })).toEqual({ ok: true, data: { entries: 2 } })
    expect(actionOk()).toEqual({ ok: true })
    expect(actionError(new Error('nope'))).toEqual({ ok: false, error: 'nope' })
    expect(actionError('plain')).toEqual({ ok: false, error: 'plain' })
    expect(JSON.parse(JSON.stringify(actionOk({ a: 1 })))).toEqual({ ok: true, data: { a: 1 } })
  })
})
