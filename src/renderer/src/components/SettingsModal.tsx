import { useEffect, useState } from 'react'
import {
  Bot,
  Compass,
  Gauge,
  Info,
  Keyboard,
  Mic,
  Minus,
  Palette,
  Plus,
  Terminal,
  Volume2,
  X
} from 'lucide-react'
import { ACCENT_OVERRIDES, THEMES } from '@shared/themes'
import { SEARCH_ENGINES, engineById } from '@shared/browser'
import { useStore } from '../store/useStore'
import { IS_MAC } from '../lib/util'
import { ThemeCard } from './ThemeCard'
import { VoicePanel } from './VoicePanel'
import { SpeechPanel } from './SpeechPanel'
import { UpdateSetting } from './UpdateSetting'
import { UsageSettings } from './UsageSettings'

type SectionId =
  | 'appearance'
  | 'terminal'
  | 'browser'
  | 'agents'
  | 'usage'
  | 'voice'
  | 'speech'
  | 'shortcuts'
  | 'about'

const SECTIONS: { id: SectionId; label: string; icon: typeof Palette }[] = [
  { id: 'appearance', label: 'Appearance', icon: Palette },
  { id: 'terminal', label: 'Terminal', icon: Terminal },
  { id: 'browser', label: 'Browser', icon: Compass },
  { id: 'agents', label: 'Agents', icon: Bot },
  { id: 'usage', label: 'Plan usage', icon: Gauge },
  { id: 'voice', label: 'Voice', icon: Mic },
  { id: 'speech', label: 'Spoken alerts', icon: Volume2 },
  { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard },
  { id: 'about', label: 'About', icon: Info }
]

/*
 * Two tables rather than one with substitutions, because the keymaps genuinely
 * differ. On Windows the shell keeps every bare Control chord, so the app sits
 * on Ctrl+Shift — and Ctrl+C has to be explained rather than silently changed.
 */
const MAC_SHORTCUTS: { keys: string; what: string }[] = [
  { keys: '⌘K', what: 'Commands' },
  { keys: '⌘T', what: 'New workspace' },
  { keys: '⌘D', what: 'Add a pane' },
  { keys: '⌘W', what: 'Close the focused pane' },
  { keys: '⌘E', what: 'Fill the grid with the focused pane' },
  { keys: '⌘1', what: 'Jump to a pane (through ⌘9)' },
  { keys: '⌘J', what: 'Conductor' },
  { keys: '⌘B', what: 'Workspaces sidebar' },
  { keys: '⌘⇧B', what: 'Side panel' },
  { keys: '⌘/', what: 'Resume a session' },
  { keys: 'Hold Right ⌘', what: 'Dictate while held' },
  { keys: '⌘⇧D', what: 'Dictate, start and stop by hand' },
  { keys: 'Esc', what: 'Discard what you are dictating' },
  { keys: '⌘,', what: 'Settings' },
  { keys: '⌘C / ⌘V', what: 'Copy and paste inside a terminal' },
  { keys: '⌘F', what: 'Find in the focused pane' },
  { keys: '⇧Return', what: 'New line in a pane, without sending' },
  { keys: '⌘← / ⌘→', what: 'Start and end of the line in a pane' },
  { keys: '⌘⌫ / ⌘⌦', what: 'Delete to the start / end of the line' },
  { keys: '⌥← / ⌥→', what: 'Move a word at a time in a pane' },
  { keys: '⌥⌫ / ⌥⌦', what: 'Delete a word behind / ahead' },
  { keys: '⌘= / ⌘- / ⌘0', what: 'Terminal font size' },
  { keys: 'Ctrl + anything', what: 'Always goes to the shell, never to Eaon ADE' }
]

const PC_SHORTCUTS: { keys: string; what: string }[] = [
  { keys: 'Ctrl+Shift+K', what: 'Commands' },
  { keys: 'Ctrl+Shift+T', what: 'New workspace' },
  { keys: 'Ctrl+Shift+D', what: 'Add a pane' },
  { keys: 'Ctrl+Shift+W', what: 'Close the focused pane' },
  { keys: 'Ctrl+Shift+E', what: 'Fill the grid with the focused pane' },
  { keys: 'Ctrl+Shift+1', what: 'Jump to a pane (through Ctrl+Shift+9)' },
  { keys: 'Ctrl+Shift+J', what: 'Conductor' },
  { keys: 'Ctrl+Shift+B', what: 'Workspaces sidebar' },
  { keys: 'Ctrl+Shift+O', what: 'Side panel' },
  { keys: 'Ctrl+Shift+/', what: 'Resume a session' },
  { keys: 'Hold Right Ctrl', what: 'Dictate while held' },
  { keys: 'Ctrl+Shift+M', what: 'Dictate, start and stop by hand' },
  { keys: 'Esc', what: 'Discard what you are dictating' },
  { keys: 'Ctrl+Shift+,', what: 'Settings' },
  { keys: 'Ctrl+Shift+C / Ctrl+Shift+V', what: 'Copy and paste inside a terminal' },
  { keys: 'Ctrl+C', what: 'Interrupt — or copy, when text is selected' },
  { keys: '⇧Return', what: 'New line in a pane, without sending' },
  { keys: 'Ctrl+= / Ctrl+- / Ctrl+0', what: 'Terminal font size' },
  { keys: 'Ctrl+A, Ctrl+E, Ctrl+W…', what: 'Left to the shell, as on any terminal' }
]

const SHORTCUTS = IS_MAC ? MAC_SHORTCUTS : PC_SHORTCUTS

function Toggle({
  on,
  onChange,
  label
}: {
  on: boolean
  onChange: (v: boolean) => void
  label: string
}): React.JSX.Element {
  return (
    <button
      className="toggle"
      data-on={on}
      onClick={() => onChange(!on)}
      role="switch"
      aria-checked={on}
      aria-label={label}
    >
      <i />
    </button>
  )
}

function Row({
  name,
  desc,
  children
}: {
  name: string
  desc: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="setting-row">
      <div className="setting-text">
        <div className="setting-name">{name}</div>
        <div className="setting-desc">{desc}</div>
      </div>
      <div className="setting-control">{children}</div>
    </div>
  )
}

export function SettingsModal(): React.JSX.Element | null {
  const open = useStore((s) => s.settingsOpen)
  const setOpen = useStore((s) => s.setSettingsOpen)
  const settings = useStore((s) => s.settings)
  const update = useStore((s) => s.updateSettings)
  const agents = useStore((s) => s.agents)
  const sys = useStore((s) => s.appVersion)

  const [section, setSection] = useState<SectionId>('appearance')
  const [statePath, setStatePath] = useState('')

  useEffect(() => {
    if (open) window.eaon.state.path().then(setStatePath)
  }, [open])

  // Escape leaves Settings, the same as the close button.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      // A dictation session or an open menu gets first refusal on Escape.
      if (e.defaultPrevented) return
      setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  if (!open) return null

  const dark = THEMES.filter((t) => t.mode === 'dark')
  const light = THEMES.filter((t) => t.mode === 'light')

  const current = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0]

  return (
    <div className="settings-surface" role="region" aria-label="Settings">
      <nav className="settings-nav" aria-label="Settings sections">
        <p className="eyebrow settings-nav-title">Settings</p>
        {SECTIONS.map((s) => {
          const Icon = s.icon
          return (
            <button
              className="settings-nav-item"
              key={s.id}
              data-on={section === s.id}
              onClick={() => setSection(s.id)}
            >
              <Icon size={14} />
              {s.label}
            </button>
          )
        })}
        <span className="settings-nav-foot mono">
          {THEMES.find((t) => t.id === settings.themeId)?.name ?? 'Custom'} · v{sys}
        </span>
      </nav>

      <div className="settings-main">
        <header className="settings-head">
          <h1 className="settings-title">{current.label}</h1>
          <span className="spacer" />
          <button
            className="icon-btn"
            onClick={() => setOpen(false)}
            aria-label="Close settings"
            title="Close settings (Esc)"
          >
            <X size={16} />
          </button>
        </header>

        <div className="settings-pane">
            {section === 'appearance' && (
              <>
                <p className="settings-lede">
                  Every surface, accent and terminal colour comes from the theme. Pick one and the
                  whole window follows.
                </p>

                <div className="section-head">
                  <span className="eyebrow">Theme</span>
                  <span className="section-note">{THEMES.length} available</span>
                </div>

                <p className="eyebrow" style={{ margin: '4px 0 8px' }}>
                  Dark
                </p>
                <div className="theme-grid">
                  {dark.map((t) => (
                    <ThemeCard
                      key={t.id}
                      theme={t}
                      active={settings.themeId === t.id}
                      onPick={() => update({ themeId: t.id })}
                    />
                  ))}
                </div>

                <p className="eyebrow" style={{ margin: '22px 0 8px' }}>
                  Light
                </p>
                <div className="theme-grid">
                  {light.map((t) => (
                    <ThemeCard
                      key={t.id}
                      theme={t}
                      active={settings.themeId === t.id}
                      onPick={() => update({ themeId: t.id })}
                    />
                  ))}
                </div>

                <div style={{ marginTop: 24 }}>
                  <Row
                    name="Accent"
                    desc="Override the theme's accent. Status colours never change — running stays one colour, waiting-on-you stays another."
                  >
                    <div className="swatches">
                      <button
                        className="swatch swatch-auto"
                        data-on={settings.accentOverride === null}
                        onClick={() => update({ accentOverride: null })}
                        aria-label="Follow the theme"
                        title="Follow the theme"
                      />
                      {ACCENT_OVERRIDES.map((a) => (
                        <button
                          className="swatch"
                          key={a.id}
                          data-on={settings.accentOverride === a.id}
                          style={{ background: a.hex }}
                          onClick={() => update({ accentOverride: a.id })}
                          aria-label={`Accent ${a.label}`}
                          title={a.label}
                        />
                      ))}
                    </div>
                  </Row>

                  <Row name="Reduce motion" desc="Turns off pulsing dots and panel animations.">
                    <Toggle
                      on={settings.reduceMotion}
                      onChange={(v) => update({ reduceMotion: v })}
                      label="Reduce motion"
                    />
                  </Row>
                </div>
              </>
            )}

            {section === 'terminal' && (
              <>
                <p className="settings-lede">
                  These apply to every open pane straight away — no restart, no reconnect.
                </p>

                <Row name="Font size" desc="Smaller text fits more agents on screen.">
                  <div className="stepper-num">
                    <button
                      className="icon-btn"
                      onClick={() => update({ fontSize: Math.max(8, settings.fontSize - 1) })}
                      aria-label="Smaller"
                    >
                      <Minus size={12} />
                    </button>
                    <span>{settings.fontSize}px</span>
                    <button
                      className="icon-btn"
                      onClick={() => update({ fontSize: Math.min(22, settings.fontSize + 1) })}
                      aria-label="Larger"
                    >
                      <Plus size={12} />
                    </button>
                  </div>
                </Row>

                <Row name="Line height" desc="Breathing room between rows.">
                  <select
                    className="select"
                    value={settings.lineHeight}
                    onChange={(e) => update({ lineHeight: Number(e.target.value) })}
                  >
                    {[1, 1.15, 1.35, 1.5, 1.7].map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </Row>

                <Row name="Font" desc="Any monospace family installed on this machine.">
                  <input
                    className="select mono"
                    style={{ width: 230 }}
                    value={settings.fontFamily}
                    spellCheck={false}
                    onChange={(e) => update({ fontFamily: e.target.value })}
                    aria-label="Terminal font"
                  />
                </Row>

                <Row name="Cursor" desc="Shape and blink.">
                  <select
                    className="select"
                    value={settings.cursorStyle}
                    onChange={(e) =>
                      update({ cursorStyle: e.target.value as 'block' | 'bar' | 'underline' })
                    }
                  >
                    <option value="bar">Bar</option>
                    <option value="block">Block</option>
                    <option value="underline">Underline</option>
                  </select>
                  <Toggle
                    on={settings.cursorBlink}
                    onChange={(v) => update({ cursorBlink: v })}
                    label="Cursor blink"
                  />
                </Row>

                <Row name="Scrollback" desc="Lines kept per pane. More lines use more memory.">
                  <select
                    className="select"
                    value={settings.scrollback}
                    onChange={(e) => update({ scrollback: Number(e.target.value) })}
                  >
                    {[2000, 5000, 8000, 20000, 50000].map((v) => (
                      <option key={v} value={v}>
                        {v.toLocaleString()}
                      </option>
                    ))}
                  </select>
                </Row>

                <Row name="Shell" desc="Leave blank to use your login shell.">
                  <input
                    className="select mono"
                    style={{ width: 180 }}
                    value={settings.shell}
                    placeholder="/bin/zsh"
                    spellCheck={false}
                    onChange={(e) => update({ shell: e.target.value })}
                    aria-label="Shell"
                  />
                </Row>
              </>
            )}

            {section === 'browser' && (
              <>
                <p className="settings-lede">
                  The preview panel is an ordinary browser pointed at what you are building. It
                  opens on a dev server, and the address bar takes a bare port — type 5173 and it
                  goes there.
                </p>

                <Row
                  name="Search engine"
                  desc="Used when the address bar is given words instead of an address. Nothing is sent anywhere until you press Return."
                >
                  <select
                    className="select"
                    value={settings.browserSearchEngine}
                    onChange={(e) => update({ browserSearchEngine: e.target.value })}
                  >
                    {SEARCH_ENGINES.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.label}
                      </option>
                    ))}
                  </select>
                </Row>
                <p className="setting-desc" style={{ margin: '-6px 0 4px' }}>
                  {engineById(settings.browserSearchEngine).note}
                </p>

                <Row
                  name="Home address"
                  desc="Where the panel opens. It follows you as you browse, so it is usually the last place you were."
                >
                  <input
                    className="select mono"
                    value={settings.browserHome}
                    spellCheck={false}
                    aria-label="Home address"
                    onChange={(e) => update({ browserHome: e.target.value })}
                  />
                </Row>

                <Row name="Page zoom" desc="Applies to every page in the panel. ⌘0 resets it.">
                  <div className="stepper-num">
                    <button
                      className="icon-btn"
                      onClick={() =>
                        update({
                          browserZoom: Math.max(0.5, Number((settings.browserZoom - 0.1).toFixed(2)))
                        })
                      }
                      aria-label="Smaller"
                    >
                      <Minus size={12} />
                    </button>
                    <span>{Math.round(settings.browserZoom * 100)}%</span>
                    <button
                      className="icon-btn"
                      onClick={() =>
                        update({
                          browserZoom: Math.min(2.5, Number((settings.browserZoom + 0.1).toFixed(2)))
                        })
                      }
                      aria-label="Larger"
                    >
                      <Plus size={12} />
                    </button>
                  </div>
                </Row>
              </>
            )}

            {section === 'agents' && (
              <>
                <p className="settings-lede">
                  Eaon ADE starts a shell and types the agent's command into it. Nothing is wrapped or
                  intercepted.
                </p>

                <Row name="Default agent" desc="Pre-selected for new workspaces and new panes.">
                  <select
                    className="select"
                    value={settings.defaultAgentId}
                    onChange={(e) => update({ defaultAgentId: e.target.value })}
                  >
                    {agents.map((a) => (
                      <option key={a.id} value={a.id} disabled={a.available === false}>
                        {a.label}
                        {a.available === false ? ' (not installed)' : ''}
                      </option>
                    ))}
                  </select>
                </Row>

                <Row
                  name="Terminal bell marks a pane"
                  desc="Agents ring the bell when they need a decision. Turn this off to stop the highlight."
                >
                  <Toggle
                    on={settings.bellAttention}
                    onChange={(v) => update({ bellAttention: v })}
                    label="Bell marks a pane"
                  />
                </Row>

                <Row
                  name="Ask before closing a workspace"
                  desc="Closing ends every session inside it."
                >
                  <Toggle
                    on={settings.confirmClose}
                    onChange={(v) => update({ confirmClose: v })}
                    label="Ask before closing"
                  />
                </Row>

                <div className="section-head" style={{ marginTop: 22 }}>
                  <span className="eyebrow">Found on this machine</span>
                </div>
                <div style={{ display: 'grid', gap: 7 }}>
                  {agents
                    .filter((a) => a.bin)
                    .map((a) => (
                      <div
                        key={a.id}
                        style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 12 }}
                      >
                        <span
                          style={{
                            width: 6,
                            height: 6,
                            borderRadius: 3,
                            background: a.available ? 'var(--live)' : 'var(--text-dim)'
                          }}
                        />
                        <span
                          style={{ color: a.available ? 'var(--text-mid)' : 'var(--text-dim)' }}
                        >
                          {a.label}
                        </span>
                        <span className="chip mono" style={{ marginLeft: 'auto' }}>
                          {a.available ? a.bin : 'not on PATH'}
                        </span>
                      </div>
                    ))}
                </div>
              </>
            )}

            {section === 'voice' && <VoicePanel />}

            {section === 'speech' && <SpeechPanel />}

            {section === 'usage' && <UsageSettings />}

            {section === 'shortcuts' && (
              <>
                <p className="settings-lede">
                  Inside a pane the clipboard keys belong to the terminal. Everything else below
                  belongs to Eaon ADE.
                </p>
                <div className="shortcut-list">
                  {SHORTCUTS.map((s) => (
                    <div className="shortcut-row" key={s.keys}>
                      <span className="kbd">{s.keys}</span>
                      <span>{s.what}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {section === 'about' && (
              <>
                <p className="settings-lede">
                  Eaon ADE {sys}. Everything runs on this machine — no account, no telemetry, no update
                  pings.
                </p>

                <Row
                  name="Updates"
                  desc="Checked on launch and every few hours. New versions download in the background and install when you restart."
                >
                  <UpdateSetting />
                </Row>

                <Row name="Where your settings live" desc="Workspaces, presets, board and vault.">
                  <span className="chip mono" title={statePath} style={{ maxWidth: 260 }}>
                    <span
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        direction: 'rtl'
                      }}
                    >
                      {statePath}
                    </span>
                  </span>
                </Row>

                <Row
                  name="Start over"
                  desc="Deletes every workspace, preset, board card and vault note."
                >
                  <button
                    className="btn"
                    onClick={async () => {
                      if (!window.confirm('Reset every workspace, preset and setting?')) return
                      await window.eaon.state.reset()
                      window.location.reload()
                    }}
                  >
                    Reset everything
                  </button>
                </Row>

                <p className="setting-desc" style={{ marginTop: 20, lineHeight: 1.7 }}>
                  Dracula, Gruvbox, Nord, Tokyo Night, Catppuccin, One Dark and Rosé Pine palettes
                  are reproduced from their MIT-licensed projects, with thanks to their
                  authors.
                </p>
              </>
            )}
        </div>
      </div>
    </div>
  )
}
