/**
 * The UI SDK half that belongs to the core: what a panel receives and what it
 * may call. Every harness serves this contract over its own transport (DSH's
 * embedded HTTP handler, Kilo/OpenCode/MCP's standalone page) and renders it in
 * its own design; a panel never invents settings or actions of its own.
 */
import type { MemoryConfig } from './config.js'
import {
  SETTINGS_ACTIONS,
  SETTINGS_GROUPS,
  readSettingValue,
  type SettingsAction,
  type SettingsGroup,
} from './settings-schema.js'

/** Bumped whenever the payload shapes below change incompatibly. */
export const UI_CONTRACT_VERSION = 1

/** Everything a panel needs to draw its settings screen. */
export interface UISettingsSnapshot {
  version: number
  groups: readonly SettingsGroup[]
  actions: readonly SettingsAction[]
  /** Current values keyed by the same dotted paths as the groups. */
  values: Record<string, unknown>
}

/** One call a panel makes; `action` is an id from {@link SETTINGS_ACTIONS}. */
export interface UIActionRequest {
  action: string
  payload?: unknown
}

/** Result of a call; `error` is set exactly when `ok` is false. */
export interface UIActionResponse {
  ok: boolean
  data?: unknown
  error?: string
}

/** Ids of all actions a panel may call. */
export const UI_ACTION_NAMES: readonly string[] = SETTINGS_ACTIONS.map(action => action.id)

/** Whether a panel may call this action at all. */
export function isUIAction(name: string): boolean {
  return UI_ACTION_NAMES.includes(name)
}

/** Settings screen payload for a core config. */
export function settingsSnapshot(config: MemoryConfig): UISettingsSnapshot {
  const values: Record<string, unknown> = {}
  for (const group of SETTINGS_GROUPS) {
    for (const field of group.fields) values[field.path] = readSettingValue(config, field.path)
  }
  return {
    version: UI_CONTRACT_VERSION,
    groups: SETTINGS_GROUPS,
    actions: SETTINGS_ACTIONS,
    values,
  }
}

/** Successful action response. */
export function actionOk(data?: unknown): UIActionResponse {
  return data === undefined ? { ok: true } : { ok: true, data }
}

/** Failed action response. */
export function actionError(error: unknown): UIActionResponse {
  return { ok: false, error: error instanceof Error ? error.message : String(error) }
}
