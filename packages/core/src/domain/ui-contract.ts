/**
 * The UI SDK half that belongs to the core: what a panel receives and what it
 * may call. Every harness serves this contract over its own transport (DSH's
 * embedded HTTP handler, Kilo/OpenCode/MCP's standalone page) and renders it in
 * its own design; a panel never invents settings or actions of its own.
 */
import type { MemoryConfig } from './config.js'
import {
  UI_OPERATIONS,
  UI_SCHEMA_VERSION,
  UI_VIEWS,
  type UIView,
} from './ui-schema.js'
import {
  SETTINGS_ACTIONS,
  SETTINGS_GROUPS,
  localizedSettingsGroups,
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

/** Settings screen payload for a core config, in the panel's locale. */
export function settingsSnapshot(config: MemoryConfig, locale: 'en' | 'ru' = 'en'): UISettingsSnapshot {
  const values: Record<string, unknown> = {}
  for (const group of SETTINGS_GROUPS) {
    for (const field of group.fields) values[field.path] = readSettingValue(config, field.path)
  }
  return {
    version: UI_CONTRACT_VERSION,
    groups: locale === 'en' ? SETTINGS_GROUPS : localizedSettingsGroups('ru'),
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


/** The whole panel contract: screens, settings fields and callable actions. */
export interface UISnapshot {
  /** Version of both the view schema and the settings payload. */
  version: number
  views: readonly UIView[]
  settings: UISettingsSnapshot
  actions: typeof SETTINGS_ACTIONS
  operations: readonly string[]
}

/** One payload every panel renders; design and embedding stay host-specific. */
export function uiSnapshot(config: MemoryConfig, locale: 'en' | 'ru' = 'en'): UISnapshot {
  return {
    version: UI_SCHEMA_VERSION,
    views: UI_VIEWS,
    settings: settingsSnapshot(config, locale),
    actions: SETTINGS_ACTIONS,
    operations: UI_OPERATIONS,
  }
}
