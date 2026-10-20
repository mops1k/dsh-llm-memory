/** Shared app state and tiny accessors used by every screen. */
import { t } from './i18n.js'
import { fmtDate, timeAgo } from './util.js'

export const app = {
  locale: 'ru',
  themePref: 'system',
  mode: 'demo',
  source: null,
  sdk: null,
  api: null,
  projects: [],
  project: 'all',
  route: 'overview',
  params: {},
  status: null,
  refresh: null,
  settingsDraft: null,
  pageSize: { items: null, recall: null },
}

export function tr(key, vars) {
  return t(app.locale, key, vars)
}

/** The locale slice of the SDK fixture: localized views, actions and settings groups. */
export function sdk() {
  return app.sdk.locales[app.locale]
}

export function viewDef(id) {
  return sdk().views.find(view => view.id === id) ?? null
}

export function actionDef(id) {
  return sdk().actions.find(action => action.id === id) ?? null
}

export function localeTag() {
  return app.locale === 'ru' ? 'ru-RU' : 'en-GB'
}

export function dateText(iso, withTime = false) {
  return fmtDate(iso, app.locale, withTime)
}

export function agoText(iso) {
  return timeAgo(iso, app.locale)
}

export function persist(key, value) {
  try {
    localStorage.setItem(`lm-proto:${key}`, typeof value === 'string' ? value : JSON.stringify(value))
  } catch {
    // storage can be unavailable (private mode); the prototype still works
  }
}

export function restore(key, fallback) {
  try {
    const raw = localStorage.getItem(`lm-proto:${key}`)
    if (raw === null) return fallback
    try {
      return JSON.parse(raw)
    } catch {
      return raw
    }
  } catch {
    return fallback
  }
}

export function resolveTheme(pref) {
  if (pref === 'light' || pref === 'dark') return pref
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function applyTheme(pref, save = true) {
  app.themePref = pref
  document.documentElement.dataset.theme = resolveTheme(pref)
  document.documentElement.dataset.themePref = pref
  if (save) persist('theme', pref)
}

export function themeLabel() {
  return tr(`topbar.theme${app.themePref === 'light' ? 'Light' : app.themePref === 'dark' ? 'Dark' : 'System'}`)
}
