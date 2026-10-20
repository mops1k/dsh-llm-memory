import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { createTranslator, DshUiHost, HttpUiHost } from '@llm-memory/ui/headless'
import {
  ActionBar,
  EditorForm,
  MemoryPanel,
  SettingsForm,
  StatsView,
  TableView,
} from '@llm-memory/ui/web/index'
import type { PanelSnapshot } from '@llm-memory/ui/web/types'
import { THEMES } from '@llm-memory/ui/theme/tokens'

const en = createTranslator('en')
const ru = createTranslator('ru')

const snapshot: PanelSnapshot = {
  version: 1,
  views: [
    { id: 'overview', title: 'Overview', widgets: [{ kind: 'stats', source: { operation: 'status' }, metrics: [{ path: 'total', label: 'Entries' }, { path: 'active', label: 'Active' }] }] },
    { id: 'items', title: 'Entries', widgets: [{ kind: 'table', source: { operation: 'items.list' }, columns: [{ path: 'title', label: 'Title' }], pagination: { pageSizes: [12, 24], defaultPageSize: 24 } }] },
    { id: 'editor', title: 'Edit entry', widgets: [{ kind: 'editor', fields: [{ path: 'text', label: 'Text', type: 'textarea' }] }] },
    { id: 'settings', title: 'Settings', widgets: [{ kind: 'form', source: { operation: 'settings.snapshot' } }] },
    { id: 'backup', title: 'Backups', widgets: [{ kind: 'actions', actions: ['backup.create', 'backup.restore'] }] },
  ],
  actions: [
    { id: 'backup.create', label: 'Create backup', group: 'backup', mode: 'write' },
    { id: 'backup.restore', label: 'Restore backup', group: 'backup', confirm: 'RESTORE', danger: true, mode: 'write' },
  ],
  operations: ['status', 'items.list', 'settings.snapshot'],
}

function host(locale: 'en' | 'ru' = 'en'): DshUiHost {
  return new DshUiHost({
    locale,
    bridge: async () => {
      throw new Error('not used by static rendering')
    },
  })
}

describe('schema-driven widgets', () => {
  it('renders stats and tables from schema payloads', () => {
    const stats = renderToStaticMarkup(
      <StatsView t={en} metrics={snapshot.views[0]?.widgets[0] && 'metrics' in snapshot.views[0].widgets[0] ? snapshot.views[0].widgets[0].metrics : []} payload={{ ok: true, status: { total: 5, active: 3 } }} />,
    )
    expect(stats).toContain('Entries')
    expect(stats).toContain('5')
    const table = renderToStaticMarkup(
      <TableView
        t={en}
        columns={[{ path: 'title', label: 'Title' }]}
        rows={[{ title: 'First' }, { title: 'Second' }]}
        pagination={{ pageSizes: [12, 24], defaultPageSize: 24 }}
        page={1}
        total={30}
      />,
    )
    expect(table).toContain('First')
    expect(table).toContain('1 / 2')
    expect(table).toContain('Total: 30')
    expect(renderToStaticMarkup(<TableView t={ru} columns={[]} rows={[]} />)).toContain('Записей нет')
  })

  it('renders settings groups, values and the locale switch', () => {
    const html = renderToStaticMarkup(
      <SettingsForm
        t={en}
        locale="en"
        groups={[
          {
            id: 'recall',
            title: 'Recall & context',
            fields: [
              { path: 'recallLimit', label: 'Recall entries', type: 'number', min: 1, max: 100 },
              { path: 'recallFormat', label: 'Recall format', type: 'select', options: [{ value: 'markdown', label: 'markdown' }] },
            ],
          },
        ]}
        values={{ recallLimit: 10, recallFormat: 'markdown' }}
        unsupported={['recallFormat']}
        dirty={{}}
        onChange={() => {}}
        onSave={() => {}}
      />,
    )
    expect(html).toContain('Recall &amp; context')
    expect(html).toContain('value="10"')
    expect(html).toContain('<select')
    expect(html).toContain('value="ru"')
    expect(html).toContain('lm-unsupported')
  })

  it('renders actions with confirmation-aware labels and the editor', () => {
    const actions = renderToStaticMarkup(
      <ActionBar t={en} ids={['backup.create', 'backup.restore']} actions={snapshot.actions} onRun={() => {}} />,
    )
    expect(actions).toContain('Create backup')
    expect(actions).toContain('Restore backup')
    expect(actions).toContain('lm-danger')

    const editor = renderToStaticMarkup(
      <EditorForm t={en} fields={[{ path: 'text', label: 'Text', type: 'textarea' }]} onSave={() => {}} />,
    )
    expect(editor).toContain('New entry')
    expect(editor).toContain('<textarea')
  })

  it('renders the panel shell from the snapshot with the host theme and locale', () => {
    const html = renderToStaticMarkup(<MemoryPanel host={host('ru')} snapshot={{ ...snapshot, views: [{ id: 'overview', title: 'Обзор', widgets: [] }] }} />)
    expect(html).toContain('data-host="dsh"')
    expect(html).toContain('Обзор')
    expect(html).toContain('LLM Memory')
    expect(THEMES.kilo.colorAccent).not.toBe(THEMES.opencode.colorAccent)
  })
})

describe('host routing', () => {
  it('maps operations onto configured routes', async () => {
    const calls: { url: string; method: string }[] = []
    const fakeFetch = (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), method: String(init?.method) })
      return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response
    }) as unknown as typeof fetch
    const panel = new HttpUiHost({
      kind: 'kilo',
      baseUrl: 'http://127.0.0.1:8787/',
      routes: {
        'items.list': { method: 'GET', path: '/api/legacy/items' },
        'items.update': { method: 'PUT', path: '/api/legacy/items/{{id}}' },
        'action.backup.create': { method: 'POST', path: '/api/legacy/backups/create' },
      },
      fetchImpl: fakeFetch,
    })
    await panel.request('items.list', { limit: 2, query: 'hook' })
    expect(calls[0]).toEqual({ url: 'http://127.0.0.1:8787/api/legacy/items?limit=2&query=hook', method: 'GET' })
    await panel.request('items.update', { id: 'm_1', text: 'changed' })
    expect(calls[1]).toEqual({ url: 'http://127.0.0.1:8787/api/legacy/items/m_1', method: 'PUT' })
    await panel.request('action.backup.create')
    expect(calls[2]).toEqual({ url: 'http://127.0.0.1:8787/api/legacy/backups/create', method: 'POST' })
    await expect(panel.request('action.vectors.rebuild')).rejects.toThrow(/not available/)
  })

  it('keeps the DSH-shaped defaults', async () => {
    const calls: string[] = []
    const fakeFetch = (async (url: string) => {
      calls.push(String(url))
      return { ok: true, status: 200, json: async () => ({ total: 1 }) } as Response
    }) as unknown as typeof fetch
    const panel = new HttpUiHost({ kind: 'dsh', baseUrl: 'http://x', fetchImpl: fakeFetch })
    await panel.request('status')
    expect(calls[0]).toBe('http://x/api/status')
  })
})
