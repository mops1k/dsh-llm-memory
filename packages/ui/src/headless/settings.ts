/**
 * Settings schema and validation shared by native (DSH) and web (Kilo,
 * OpenCode, MCP) surfaces. Descriptors only: no React, no host SDK.
 */
import { isUiLocale, type UiLocale } from './i18n.js'

export type SettingKind = 'string' | 'number' | 'boolean' | 'enum'

export interface SettingsSection {
  id: 'memory' | 'recall' | 'agent' | 'ui' | 'vectors'
  titleKey: string
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  { id: 'memory', titleKey: 'settings.storageRoot' },
  { id: 'recall', titleKey: 'settings.recallLimit' },
  { id: 'agent', titleKey: 'settings.autonomous' },
  { id: 'ui', titleKey: 'settings.locale' },
  { id: 'vectors', titleKey: 'settings.vectors' },
]

export interface SettingDescriptor {
  key: string
  section: SettingsSection['id']
  kind: SettingKind
  labelKey: string
  default: string | number | boolean
  min?: number
  max?: number
  step?: number
  options?: readonly string[]
}

export const SETTINGS: readonly SettingDescriptor[] = [
  { key: 'storageRoot', section: 'memory', kind: 'string', labelKey: 'settings.storageRoot', default: '' },
  { key: 'recallLimit', section: 'recall', kind: 'number', labelKey: 'settings.recallLimit', default: 10, min: 1, max: 50, step: 1 },
  { key: 'recallTextChars', section: 'recall', kind: 'number', labelKey: 'settings.recallLimit', default: 600, min: 0, max: 4000, step: 50 },
  { key: 'recallFormat', section: 'recall', kind: 'enum', labelKey: 'settings.recallFormat', default: 'markdown', options: ['markdown', 'table', 'timeline', 'json'] },
  { key: 'recallAllowFormatOverride', section: 'recall', kind: 'boolean', labelKey: 'settings.recallFormat', default: true },
  { key: 'autonomous', section: 'agent', kind: 'boolean', labelKey: 'settings.autonomous', default: true },
  { key: 'requireConfirmation', section: 'agent', kind: 'boolean', labelKey: 'settings.autonomous', default: false },
  { key: 'uiLocale', section: 'ui', kind: 'enum', labelKey: 'settings.locale', default: 'en', options: ['ru', 'en'] },
  { key: 'embeddingsProvider', section: 'vectors', kind: 'enum', labelKey: 'settings.vectors', default: 'off', options: ['off', 'local'] },
  { key: 'embeddingsModel', section: 'vectors', kind: 'string', labelKey: 'settings.vectors', default: 'Xenova/multilingual-e5-small' },
] as const

export type SettingValues = Record<string, string | number | boolean>

export const DEFAULT_SETTINGS: SettingValues = Object.fromEntries(SETTINGS.map(item => [item.key, item.default]))

export interface ValidationIssue {
  key: string
  message: string
}

function checkNumber(value: number, item: SettingDescriptor): string | null {
  if (!Number.isFinite(value)) return 'must be a number'
  if (item.min !== undefined && value < item.min) return `must be >= ${item.min}`
  if (item.max !== undefined && value > item.max) return `must be <= ${item.max}`
  if (item.step !== undefined && item.step > 0 && Math.abs(value / item.step - Math.round(value / item.step)) > 1e-9) {
    return `must be a multiple of ${item.step}`
  }
  return null
}

/** Validate a partial update against the descriptors; returns human-readable issues. */
export function validateSettings(values: SettingValues): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  for (const item of SETTINGS) {
    const value = values[item.key]
    if (value === undefined) continue
    if (item.kind === 'number') {
      const message = typeof value === 'number' ? checkNumber(value, item) : 'must be a number'
      if (message) issues.push({ key: item.key, message })
      continue
    }
    if (item.kind === 'boolean') {
      if (typeof value !== 'boolean') issues.push({ key: item.key, message: 'must be true/false' })
      continue
    }
    if (item.kind === 'enum') {
      const allowed = item.options ?? []
      if (item.key === 'uiLocale') {
        if (!isUiLocale(value)) issues.push({ key: item.key, message: `must be one of ${allowed.join(', ')}` })
      } else if (!allowed.includes(String(value))) {
        issues.push({ key: item.key, message: `must be one of ${allowed.join(', ')}` })
      }
      continue
    }
    if (typeof value !== 'string') issues.push({ key: item.key, message: 'must be a string' })
  }
  return issues
}

/** Merge defaults with stored values, keeping unknown stored keys untouched. */
export function resolveSettings(stored: SettingValues | null | undefined): SettingValues {
  return { ...DEFAULT_SETTINGS, ...stored }
}

/** Locale of the whole UI; a missing/invalid value resolves to `en`. */
export function localeFromSettings(values: SettingValues): UiLocale {
  const value = values['uiLocale']
  return isUiLocale(value) ? value : 'en'
}
