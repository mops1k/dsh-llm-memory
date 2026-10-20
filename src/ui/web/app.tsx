/**
 * Shared application shell: navigation over the screens plus locale and theme
 * wiring. Both web hosts mount exactly this component.
 */
import * as React from 'react'

import type { UiHost } from '../headless/host.js'
import { themeVars } from './styles.js'
import { createTranslator } from '../headless/i18n.js'
import type { BackupSummary } from '../headless/backup.js'
import type { GraphVm, HealthVm, ItemRowVm, LintVm, SettingsVm, StatusVm } from '../headless/viewmodels.js'
import {
  BackupScreen,
  GraphScreen,
  HealthScreen,
  ItemScreen,
  ItemsScreen,
  LintScreen,
  SettingsScreen,
  StatusScreen,
} from './screens.js'

export type ScreenId = 'status' | 'items' | 'item' | 'graph' | 'lint' | 'health' | 'settings' | 'backup'

export interface ScreenData {
  status: StatusVm
  items: ItemRowVm[]
  selected?: ItemRowVm
  graph: GraphVm
  lint: LintVm
  health: HealthVm
  settings: SettingsVm
  backups: BackupSummary[]
}

export interface MemoryAppProps {
  host: UiHost
  data: ScreenData
  initialScreen?: ScreenId
  onSettingChange?: (key: string, value: string | number | boolean) => void
  onBackupAction?: (action: 'create' | 'verify' | 'restore' | 'delete', name?: string) => void
}

const NAV: ScreenId[] = ['status', 'items', 'graph', 'lint', 'health', 'settings', 'backup']

export function MemoryApp({ host, data, initialScreen = 'status', onSettingChange, onBackupAction }: MemoryAppProps): React.ReactElement {
  const [screen, setScreen] = React.useState<ScreenId>(initialScreen)
  const [selectedId, setSelectedId] = React.useState<string | undefined>(data.selected?.id)
  const t = createTranslator(host.locale())
  const theme = host.theme()
  const selected = data.items.find(item => item.id === selectedId) ?? data.selected

  return (
    <div className="lm-app" data-host={host.kind} style={themeVars(theme) as unknown as React.CSSProperties}>
      <nav className="lm-nav">
        {NAV.map(id => (
          <button key={id} type="button" aria-current={screen === id} onClick={() => setScreen(id)}>
            {t.t(`nav.${id}` as Parameters<typeof t.t>[0])}
          </button>
        ))}
      </nav>
      {screen === 'status' ? <StatusScreen vm={data.status} t={t} /> : null}
      {screen === 'items' ? (
        <ItemsScreen
          rows={data.items}
          selected={selectedId}
          onSelect={id => {
            setSelectedId(id)
            setScreen('item')
          }}
          t={t}
        />
      ) : null}
      {screen === 'item' ? <ItemScreen row={selected} t={t} /> : null}
      {screen === 'graph' ? <GraphScreen vm={data.graph} t={t} /> : null}
      {screen === 'lint' ? <LintScreen vm={data.lint} t={t} /> : null}
      {screen === 'health' ? <HealthScreen vm={data.health} t={t} /> : null}
      {screen === 'settings' ? <SettingsScreen vm={data.settings} onChange={onSettingChange} t={t} /> : null}
      {screen === 'backup' ? (
        <BackupScreen
          backups={data.backups}
          onCreate={() => onBackupAction?.('create')}
          onVerify={name => onBackupAction?.('verify', name)}
          onRestore={name => onBackupAction?.('restore', name)}
          onDelete={name => onBackupAction?.('delete', name)}
          t={t}
        />
      ) : null}
    </div>
  )
}
