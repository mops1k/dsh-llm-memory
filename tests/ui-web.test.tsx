import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { createTranslator } from '@llm-memory/ui/headless'
import { DshUiHost, type UiOperation } from '@llm-memory/ui/headless'
import { graphVm, healthVm, itemsVm, lintVm, settingsVm, statusVm } from '@llm-memory/ui/headless/viewmodels'
import { MemoryApp } from '@llm-memory/ui/web/app'
import { BackupScreen, GraphScreen, ItemsScreen, SettingsScreen, StatusScreen } from '@llm-memory/ui/web/screens'
import { collectScreenData } from '@llm-memory/ui/web/mount'
import { THEMES } from '@llm-memory/ui/theme/tokens'

const t = createTranslator('en')
const tru = createTranslator('ru')

const items = [
  { id: 'm_1', title: 'First', kind: 'facts', tier: 'normal', status: 'active', scope: 'user', importance: 4, updatedAt: '2026-01-01T00:00:00.000Z' },
  { id: 'm_2', title: 'Second', kind: 'rules', tier: 'important', status: 'active', scope: 'project', project: 'p', updatedAt: '2026-01-02T00:00:00.000Z' },
]

const data = {
  status: statusVm({ total: 2, active: 2, byScope: { user: 1, project: 1 }, projects: 1 }, t),
  items: itemsVm(items),
  graph: graphVm({ entities: [{ id: 'm_1', name: 'First' }, { id: 'm_2', name: 'Second' }], edges: [{ source: 'm_1', target: 'm_2' }] }),
  lint: lintVm({ issues: [] }),
  health: healthVm({ vectors: { enabled: false, provider: 'off' } }, t),
  settings: settingsVm({ uiLocale: 'en' }, t),
  backups: [{ name: 'kilo-1.llmmem', createdAt: '2026-01-01T00:00:00.000Z', sizeBytes: 1024, entries: 2, includesVectors: false }],
}

function host(locale: 'en' | 'ru' = 'en'): DshUiHost {
  return new DshUiHost({ locale, bridge: async (operation: UiOperation) => {
    switch (operation) {
      case 'status': return { total: 2, active: 2, byScope: { user: 1, project: 1 }, projects: 1 }
      case 'list': return items
      case 'graph': return { entities: [{ id: 'm_1', name: 'First' }], edges: [] }
      case 'lint': return { issues: [] }
      case 'health': return { vectors: { enabled: false, provider: 'off' } }
      case 'settings.get': return { uiLocale: 'ru' }
      case 'backup.list': return data.backups
      default: return {}
    }
  } })
}

describe('shared web screens', () => {
  it('renders status, items, graph, settings and backup in both locales', () => {
    const status = renderToStaticMarkup(<StatusScreen vm={data.status} t={t} />)
    expect(status).toContain('Entries')
    expect(status).toContain('user: 1, project: 1')
    const itemsHtml = renderToStaticMarkup(<ItemsScreen rows={data.items} t={t} />)
    expect(itemsHtml).toContain('First')
    expect(itemsHtml).toContain('project/rules/important')
    const empty = renderToStaticMarkup(<ItemsScreen rows={[]} t={tru} />)
    expect(empty).toContain('Записей нет')
    const graph = renderToStaticMarkup(<GraphScreen vm={data.graph} t={t} />)
    expect(graph).toContain('First')
    const settings = renderToStaticMarkup(<SettingsScreen vm={data.settings} t={t} />)
    expect(settings).toContain('<select')
    expect(settings).toContain('value="ru"')
    const backup = renderToStaticMarkup(<BackupScreen backups={data.backups} t={t} />)
    expect(backup).toContain('Create backup')
    expect(backup).toContain('RESTORE')
    expect(backup).toContain('kilo-1.llmmem')
  })

  it('renders the shared app with the host theme and locale', () => {
    const en = renderToStaticMarkup(<MemoryApp host={host('en')} data={data} />)
    expect(en).toContain('data-host="dsh"')
    expect(en).toContain('Status')
    const ru = renderToStaticMarkup(<MemoryApp host={host('ru')} data={data} />)
    expect(ru).toContain('Статус')
    // Same components for every web host: only tokens differ.
    expect(THEMES.kilo.colorAccent).not.toBe(THEMES.opencode.colorAccent)
  })

  it('collects screen data through the host bridge', async () => {
    const collected = await collectScreenData(host('ru'))
    expect(collected.status.rows[0]).toEqual({ label: 'Записей', value: '2' })
    expect(collected.items).toHaveLength(2)
    expect(collected.backups[0]?.name).toBe('kilo-1.llmmem')
    const html = renderToStaticMarkup(<MemoryApp host={host('ru')} data={collected} />)
    expect(html).toContain('Записей')
  })
})
