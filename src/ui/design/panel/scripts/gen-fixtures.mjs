#!/usr/bin/env node
/**
 * Regenerates `fixtures/sdk-snapshot.json`, the only content source of the
 * prototype. Everything is produced by the plugin's own UI SDK (compiled to
 * ../lib), so the prototype cannot drift from `ui-schema.ts` /
 * `settings-schema.ts`: screens, columns, metrics, settings fields, actions and
 * pagination are copied, never retyped.
 *
 * Both locales are emitted because `localizedViews`/`localizedActions` bake the
 * locale into labels; the prototype switches language without a reload.
 *
 * Usage (after `pnpm build`): node src/ui/design/panel/scripts/gen-fixtures.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { UI_OPERATIONS, UI_SCHEMA_VERSION, localizedViews } from '../../../../../lib/core/domain/ui-schema.js'
import {
  localizedActions,
  localizedSettingsGroups,
  readSettingValue,
} from '../../../../../lib/core/domain/settings-schema.js'
import { DEFAULT_CONFIG } from '../../../../../lib/core/domain/config.js'

const here = dirname(fileURLToPath(import.meta.url))
const outPath = resolve(here, '../fixtures/sdk-snapshot.json')

/** Current defaults keyed by the SDK dotted paths (what a panel shows on save). */
function defaultValues() {
  const values = {}
  for (const group of localizedSettingsGroups('en')) {
    for (const field of group.fields) values[field.path] = readSettingValue(DEFAULT_CONFIG, field.path)
  }
  return values
}

const snapshot = {
  version: UI_SCHEMA_VERSION,
  operations: UI_OPERATIONS,
  locales: {},
  values: defaultValues(),
}

for (const locale of ['en', 'ru']) {
  snapshot.locales[locale] = {
    views: localizedViews(locale),
    actions: localizedActions(locale),
    settingsGroups: localizedSettingsGroups(locale),
  }
}

// Paths in defaults point at the machine of whoever runs the generator: show
// them the way the panel does, not as an absolute checkout path.
const text = `${JSON.stringify(snapshot, null, 2).replaceAll(homedir(), '~')}\n`
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, text)

const fields = Object.keys(snapshot.values).length
console.log(`wrote ${outPath}: ${snapshot.locales.ru.views.length} views, ${fields} settings fields, ${snapshot.locales.ru.actions.length} actions`)
