import { useMemo, useState, type ReactNode } from 'react';
import {
  useSettings,
  type CardLayout,
  type SidebarSkin,
  type SidebarNavBits,
  type ThemeMode,
  type UsageMode,
} from '../store/settings';
import { THEMES, buildXtermTheme, type ThemeMeta } from '../lib/theme';
import { TERM_SCHEMES, schemeToXterm, termScheme } from '../lib/termThemes';
import { cls } from '../lib/utils';
import {
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconLayout,
  IconMinus,
  IconPanelLeft,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconTerminal,
  IconX,
} from './Icons';

/* ══════════════════════════════════════════════════════════════════════════
   shared controls
   Local copies so this panel can grow without touching SettingsPage; they
   reuse the same `st-*` classes, so they render identically.
   ══════════════════════════════════════════════════════════════════════════ */

function Card({
  title,
  icon,
  children,
  defaultOpen = true,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={cls('ap-card', !open && 'ap-card-closed')}>
      <button className="ap-card-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="ap-card-icon">{icon}</span>
        <span className="ap-card-title">{title}</span>
        <IconChevronDown size={15} className="ap-card-chev" />
      </button>
      {open && <div className="ap-card-body">{children}</div>}
    </section>
  );
}

/** Progressive disclosure: the long tail of a card, folded away by default. */
function Advanced({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="ap-adv">
      <button className="ap-adv-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {open ? <IconChevronDown size={12} /> : <IconChevronRight size={12} />} Advanced
      </button>
      {open && <div className="ap-adv-body">{children}</div>}
    </div>
  );
}

function Row({
  label,
  hint,
  children,
  indent = false,
}: {
  label: string;
  hint?: ReactNode;
  children?: ReactNode;
  indent?: boolean;
}) {
  return (
    <div className={cls('ap-row', indent && 'ap-row-indent')}>
      <div className="ap-row-text">
        <div className="ap-row-label">{label}</div>
        {hint && <div className="ap-row-hint">{hint}</div>}
      </div>
      {children && <div className="ap-row-control">{children}</div>}
    </div>
  );
}

function Seg<T extends string>({
  value,
  options,
  onChange,
  wide = false,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
  wide?: boolean;
}) {
  return (
    <div className={cls('ap-seg', wide && 'ap-seg-wide')} role="group">
      {options.map((o) => (
        <button
          key={o.id}
          className={cls('ap-seg-item', value === o.id && 'ap-seg-item-active')}
          onClick={() => onChange(o.id)}
          aria-pressed={value === o.id}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={cls('st-switch', on && 'st-switch-on')}
      onClick={() => onChange(!on)}
    />
  );
}

function Stepper({
  value,
  unit,
  min,
  max,
  step = 1,
  format,
  onChange,
  label,
  onReset,
}: {
  value: number;
  unit?: string;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
  label: string;
  onReset?: () => void;
}) {
  return (
    <div className="ap-stepper-wrap">
      <div className="st-stepper" aria-label={label}>
        <button
          className="st-step-btn"
          disabled={value <= min}
          onClick={() => onChange(value - step)}
          aria-label="Decrease"
        >
          <IconMinus size={12} />
        </button>
        <span className="st-step-val">{format ? format(value) : value}</span>
        {unit && <span className="st-step-unit">{unit}</span>}
        <button
          className="st-step-btn"
          disabled={value >= max}
          onClick={() => onChange(value + step)}
          aria-label="Increase"
        >
          <IconPlus size={12} />
        </button>
      </div>
      {onReset && (
        <button className="ap-reset" onClick={onReset}>
          <IconRefresh size={11} /> Reset
        </button>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   font detection
   ══════════════════════════════════════════════════════════════════════════ */

const MONO_FONTS = [
  'SF Mono', 'Menlo', 'Monaco', 'JetBrains Mono', 'Fira Code', 'Cascadia Code',
  'Cascadia Mono', 'IBM Plex Mono', 'Source Code Pro', 'Roboto Mono', 'Ubuntu Mono',
  'Hack', 'Inconsolata', 'Iosevka', 'Berkeley Mono', 'Geist Mono', 'Courier New',
];

const UI_FONTS = [
  'SF Pro Text', 'Helvetica Neue', 'Inter', 'Geist', 'Roboto', 'Open Sans',
  'IBM Plex Sans', 'Segoe UI', 'Avenir Next', 'Optima', 'Georgia',
];

/**
 * Only list fonts the machine actually has. Measures a string in the candidate
 * font against a known fallback — if the widths match exactly the font did not
 * load and the browser silently substituted.
 */
function isFontAvailable(family: string): boolean {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  const probe = 'mmmmmmmmmmlliWWWQQ@#%1234567890';
  const measure = (stack: string) => {
    ctx.font = `72px ${stack}`;
    return ctx.measureText(probe).width;
  };
  const monoBase = measure('monospace');
  const serifBase = measure('serif');
  // A real font differs from at least one generic; matching both means it fell
  // through to the default for that generic.
  return measure(`"${family}", monospace`) !== monoBase || measure(`"${family}", serif`) !== serifBase;
}

function useAvailableFonts(candidates: string[]): string[] {
  return useMemo(() => candidates.filter(isFontAvailable), [candidates]);
}

function FontSelect({
  value,
  fonts,
  placeholder,
  onChange,
  label,
}: {
  value: string;
  fonts: string[];
  placeholder: string;
  onChange: (v: string) => void;
  label: string;
}) {
  return (
    <div className="ap-font">
      <span className="st-select-wrap">
        <select
          className="st-select"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={label}
          style={value ? { fontFamily: `"${value}"` } : undefined}
        >
          <option value="">{placeholder}</option>
          {fonts.map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
        <IconChevronDown size={13} />
      </span>
      {value && (
        <button className="ap-font-clear" onClick={() => onChange('')} title="Use the default">
          <IconX size={12} />
        </button>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   interface
   ══════════════════════════════════════════════════════════════════════════ */

function ThemeSwatch({ theme }: { theme: ThemeMeta }) {
  return (
    <div className="ap-swatch" data-theme={theme.id === 'eaon' ? undefined : theme.id} aria-hidden>
      <i className="ap-sw-bg" />
      <i className="ap-sw-chrome" />
      <i className="ap-sw-accent" />
      <i className="ap-sw-ok" />
      <i className="ap-sw-info" />
    </div>
  );
}

function ThemeRow({ theme }: { theme: ThemeMeta }) {
  const active = useSettings((s) => s.theme);
  const setTheme = useSettings((s) => s.setTheme);
  const isActive = active === theme.id;
  return (
    <button
      className={cls('ap-theme-row', isActive && 'ap-theme-row-active')}
      onClick={() => setTheme(theme.id)}
      aria-pressed={isActive}
    >
      <ThemeSwatch theme={theme} />
      <span className="ap-theme-name">{theme.name}</span>
      <span className="ap-theme-desc">{theme.desc}</span>
      {isActive && <IconCheck size={13} className="ap-theme-check" />}
    </button>
  );
}

function InterfaceCard() {
  const themeMode = useSettings((s) => s.themeMode);
  const setThemeMode = useSettings((s) => s.setThemeMode);
  const uiScale = useSettings((s) => s.uiScale);
  const setUiScale = useSettings((s) => s.setUiScale);
  const uiFont = useSettings((s) => s.uiFont);
  const setUiFont = useSettings((s) => s.setUiFont);
  const theme = useSettings((s) => s.theme);
  const uiFonts = useAvailableFonts(UI_FONTS);

  // In System mode, show the palettes for whichever side the OS is currently
  // on — offering light themes while the OS is dark would do nothing visible.
  const showLight =
    themeMode === 'light' ||
    (themeMode === 'system' &&
      typeof matchMedia === 'function' &&
      !matchMedia('(prefers-color-scheme: dark)').matches);
  const palettes = THEMES.filter((t) => t.kind === (showLight ? 'light' : 'dark'));

  return (
    <Card title="Interface" icon={<IconLayout size={14} />}>
      <Row label="Theme">
        <Seg<ThemeMode>
          value={themeMode}
          options={[
            { id: 'system', label: 'System' },
            { id: 'dark', label: 'Dark' },
            { id: 'light', label: 'Light' },
          ]}
          onChange={setThemeMode}
        />
      </Row>

      <Row
        label="UI Zoom"
        hint={
          <>
            <kbd>⌘</kbd> <kbd>=</kbd> / <kbd>⌘</kbd> <kbd>−</kbd> resize the terminal; this scales
            the chrome only.
          </>
        }
      >
        <Stepper
          value={uiScale}
          min={0.8}
          max={1.4}
          step={0.05}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={setUiScale}
          onReset={uiScale === 1 ? undefined : () => setUiScale(1)}
          label="UI zoom"
        />
      </Row>

      <Row label="UI font" hint="Only fonts installed on this machine are listed.">
        <FontSelect
          value={uiFont}
          fonts={uiFonts}
          placeholder="System default"
          onChange={setUiFont}
          label="UI font"
        />
      </Row>

      <div className="ap-rule" />
      {/* The actual colour — System/Dark/Light only pick which half of this
          list is in play, so the palette itself has to live in plain sight,
          not behind a second disclosure. That was the bug: switching Dark ↔
          Light while already wearing each side's only-ever-picked palette
          looked like theming did nothing at all. */}
      <div className="ap-sub-label">{showLight ? 'Light' : 'Dark'} palette</div>
      <p className="ap-sub-hint">
        Chrome, terminals and the code editor all read the same tokens, so a palette applies
        everywhere at once.
      </p>
      <div className="ap-theme-list">
        {palettes.map((t) => (
          <ThemeRow key={t.id} theme={t} />
        ))}
      </div>
      <p className="ap-note">
        Currently wearing <strong>{theme}</strong>.
      </p>
    </Card>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   terminal
   ══════════════════════════════════════════════════════════════════════════ */

/** A live render of the effective palette, not a screenshot. */
function TerminalPreview() {
  const terminalTheme = useSettings((s) => s.terminalTheme);
  const theme = useSettings((s) => s.theme);
  const fontSize = useSettings((s) => s.terminalFontSize);
  const family = useSettings((s) => s.terminalFontFamily);
  const showDivider = useSettings((s) => s.showPaneDivider);
  const divider = useSettings((s) => s.dividerColor);

  // Recomputed whenever any input changes; buildXtermTheme reads live tokens.
  const t = useMemo(() => {
    const scheme = terminalTheme !== 'follow' ? termScheme(terminalTheme) : null;
    return scheme ? schemeToXterm(scheme) : buildXtermTheme();
  }, [terminalTheme, theme]);

  const style = {
    background: t.background,
    color: t.foreground,
    fontSize: `${Math.max(9, fontSize - 1)}px`,
    fontFamily: family ? `"${family}", ui-monospace, monospace` : 'var(--font-mono)',
  };

  return (
    <div className="ap-preview">
      <div className="ap-preview-panes" style={{ background: t.background }}>
        <pre className="ap-preview-term" style={style}>
          <span>
            <b style={{ color: t.cyan }}>~/eaon</b> <b style={{ color: t.magenta }}>main</b>{' '}
            <span style={{ color: t.brightBlack }}>$</span> npm test
          </span>
          <span>
            <b style={{ background: t.green, color: t.background }}> PASS </b> src/grid.test.ts
          </span>
          <span style={{ color: t.brightBlack }}>  ✓ balances 4 panes (3ms)</span>
          <span style={{ color: t.red }}>  ✗ ligatures: =&gt; != &gt;= ===</span>
          <span> </span>
          <span>
            <span style={{ color: t.blue }}>def</span>{' '}
            <span style={{ color: t.yellow }}>total</span>(xs: <span style={{ color: t.cyan }}>list</span>) -&gt;{' '}
            <span style={{ color: t.cyan }}>int</span>:
          </span>
          <span style={{ color: t.green }}>    """Sum the values."""</span>
          <span> </span>
          <span style={{ color: t.brightBlue }}>@@ -1,2 +1,3 @@</span>
          <span style={{ color: t.red }}>-const size = 13</span>
          <span style={{ color: t.green }}>+const size = 14</span>
          <span>
            <b style={{ color: t.cyan }}>~/eaon</b> <span style={{ color: t.brightBlack }}>$</span>
            <i className="ap-preview-caret" style={{ background: t.cursor }} />
          </span>
        </pre>
        {showDivider && (
          <i
            className="ap-preview-divider"
            style={{ background: divider || 'var(--n-700)' }}
          />
        )}
        <pre className="ap-preview-term ap-preview-term-2" style={style}>
          <span>
            <b style={{ color: t.magenta }}>claude</b>{' '}
            <span style={{ color: t.brightBlack }}>· reviewing grid.ts</span>
          </span>
          <span style={{ color: t.yellow }}>⏵ waiting on your input</span>
        </pre>
      </div>
    </div>
  );
}

function TerminalThemePicker() {
  const terminalTheme = useSettings((s) => s.terminalTheme);
  const setTerminalTheme = useSettings((s) => s.setTerminalTheme);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<'dark' | 'light'>('dark');

  const pool = useMemo(() => TERM_SCHEMES.filter((s) => s.kind === kind), [kind]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? pool.filter((s) => s.name.toLowerCase().includes(q)) : pool;
  }, [pool, query]);

  const selectedName =
    terminalTheme === 'follow' ? 'Follow app theme' : termScheme(terminalTheme)?.name ?? terminalTheme;

  return (
    <>
      <Row label="Theme mode" hint="Which set of terminal palettes to choose from.">
        <span />
      </Row>
      <Seg<'dark' | 'light'>
        value={kind}
        wide
        options={[
          { id: 'dark', label: 'Dark' },
          { id: 'light', label: 'Light' },
        ]}
        onChange={setKind}
      />

      <div className="ap-sub-label">{kind === 'dark' ? 'Dark' : 'Light'} theme</div>
      <p className="ap-sub-hint">
        Overrides the palette derived from the app theme. Terminals repaint immediately.
      </p>

      <div className="ap-search">
        <IconSearch size={13} />
        <input
          className="ap-search-input"
          placeholder="Search terminal themes"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          spellCheck={false}
        />
        {query && (
          <button className="icon-btn" onClick={() => setQuery('')} title="Clear">
            <IconX size={12} />
          </button>
        )}
      </div>

      <div className="ap-list-head">
        <span>Selected: {selectedName}</span>
        <span>
          Showing {shown.length} of {pool.length}
        </span>
      </div>

      <div className="ap-scheme-list">
        <button
          className={cls('ap-scheme', terminalTheme === 'follow' && 'ap-scheme-active')}
          onClick={() => setTerminalTheme('follow')}
        >
          <span className="ap-scheme-chips ap-scheme-chips-follow">
            <i style={{ background: 'var(--canvas)' }} />
            <i style={{ background: 'var(--danger)' }} />
            <i style={{ background: 'var(--ok)' }} />
            <i style={{ background: 'var(--accent)' }} />
            <i style={{ background: 'var(--info)' }} />
            <i style={{ background: 'var(--folder)' }} />
          </span>
          <span className="ap-scheme-name">Follow app theme</span>
          {terminalTheme === 'follow' && <IconCheck size={12} />}
        </button>

        {shown.length === 0 && <div className="ap-empty">No theme matching “{query}”.</div>}

        {shown.map((s) => (
          <button
            key={s.id}
            className={cls('ap-scheme', terminalTheme === s.id && 'ap-scheme-active')}
            onClick={() => setTerminalTheme(s.id)}
          >
            <span className="ap-scheme-chips">
              <i style={{ background: s.bg }} />
              <i style={{ background: s.normal[1] }} />
              <i style={{ background: s.normal[2] }} />
              <i style={{ background: s.normal[3] }} />
              <i style={{ background: s.normal[4] }} />
              <i style={{ background: s.normal[6] }} />
            </span>
            <span className="ap-scheme-name">{s.name}</span>
            {terminalTheme === s.id && <IconCheck size={12} />}
          </button>
        ))}
      </div>
    </>
  );
}

function TerminalCard() {
  const fontSize = useSettings((s) => s.terminalFontSize);
  const setFontSize = useSettings((s) => s.setTerminalFontSize);
  const family = useSettings((s) => s.terminalFontFamily);
  const setFamily = useSettings((s) => s.setTerminalFontFamily);
  const divider = useSettings((s) => s.dividerColor);
  const setDivider = useSettings((s) => s.setDividerColor);
  const showDivider = useSettings((s) => s.showPaneDivider);
  const setShowDivider = useSettings((s) => s.setShowPaneDivider);
  const monoFonts = useAvailableFonts(MONO_FONTS);

  return (
    <Card title="Terminal" icon={<IconTerminal size={14} />}>
      <div className="ap-sub-label">Typography</div>
      <Row label="Font size" indent>
        <Stepper
          value={fontSize}
          unit="px"
          min={9}
          max={24}
          onChange={setFontSize}
          onReset={fontSize === 13 ? undefined : () => setFontSize(13)}
          label="Terminal font size"
        />
      </Row>
      <Row label="Font family" hint="Monospaced fonts found on this machine." indent>
        <FontSelect
          value={family}
          fonts={monoFonts}
          placeholder="SF Mono (default)"
          onChange={setFamily}
          label="Terminal font family"
        />
      </Row>

      <div className="ap-rule" />
      <div className="ap-sub-label">Terminal themes</div>
      <TerminalThemePicker />

      <div className="ap-rule" />
      <Row
        label="Pane divider"
        hint="The line between split panes. Its grab area stays either way."
      >
        <Switch on={showDivider} onChange={setShowDivider} label="Show pane divider" />
      </Row>
      <Row label="Divider colour" hint="Leave empty to follow the theme." indent>
        <div className="ap-color">
          <label className="ap-color-swatch" style={{ background: divider || 'var(--n-700)' }}>
            <input
              type="color"
              value={/^#[0-9a-f]{6}$/i.test(divider) ? divider : '#262626'}
              onChange={(e) => setDivider(e.target.value)}
              aria-label="Divider colour"
            />
          </label>
          <input
            className="ap-color-hex"
            value={divider}
            placeholder="#262626"
            spellCheck={false}
            onChange={(e) => setDivider(e.target.value.trim())}
            aria-label="Divider colour hex"
          />
          {divider && (
            <button className="icon-btn" onClick={() => setDivider('')} title="Follow the theme">
              <IconX size={12} />
            </button>
          )}
        </div>
      </Row>

      <Advanced>
        <div className="ap-sub-label">Preview</div>
        <p className="ap-sub-hint">The effective terminal appearance, rendered live.</p>
        <TerminalPreview />
      </Advanced>
    </Card>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   window & sidebar
   ══════════════════════════════════════════════════════════════════════════ */

const NAV_ROWS: { key: keyof SidebarNavBits; label: string; hint: string }[] = [
  { key: 'tasks', label: 'Show Tasks button', hint: 'Opens the board panel.' },
  { key: 'pulls', label: 'Show Pull requests button', hint: 'Opens the pull request panel.' },
  { key: 'files', label: 'Show Files button', hint: 'Opens the file tree panel.' },
  { key: 'memory', label: 'Show Memory button', hint: 'Opens the knowledge graph panel.' },
];

function WindowCard() {
  const sidebarSkin = useSettings((s) => s.sidebarSkin);
  const setSidebarSkin = useSettings((s) => s.setSidebarSkin);
  const usageMode = useSettings((s) => s.usageMode);
  const setUsageMode = useSettings((s) => s.setUsageMode);
  const sidebarNav = useSettings((s) => s.sidebarNav);
  const setSidebarNavBit = useSettings((s) => s.setSidebarNavBit);
  const cardLayout = useSettings((s) => s.cardLayout);
  const setCardLayout = useSettings((s) => s.setCardLayout);
  const filesShowHidden = useSettings((s) => s.filesShowHidden);
  const setFilesShowHidden = useSettings((s) => s.setFilesShowHidden);

  return (
    <Card title="Window & Sidebar" icon={<IconPanelLeft size={14} />}>
      <Row
        label="Left sidebar appearance"
        hint="Match the terminal canvas, stay on the chrome surface, or take a tint from the accent."
      >
        <Seg<SidebarSkin>
          value={sidebarSkin}
          options={[
            { id: 'default', label: 'Default' },
            { id: 'match-terminal', label: 'Match terminal' },
            { id: 'tinted', label: 'Tinted' },
          ]}
          onChange={setSidebarSkin}
        />
      </Row>

      <div className="ap-rule" />
      <div className="ap-sub-label">Usage</div>
      <p className="ap-sub-hint">How the provider usage pill reads.</p>

      <Row
        label="Usage percentages"
        hint="Show how much of a provider limit is used, or how much is left."
        indent
      >
        <Seg<UsageMode>
          value={usageMode}
          options={[
            { id: 'used', label: 'Used' },
            { id: 'remaining', label: 'Remaining' },
          ]}
          onChange={setUsageMode}
        />
      </Row>

      <Advanced>
        <div className="ap-sub-label">Sidebar</div>
        <Row label="Worktree card layout" hint="Detailed shows the path and agent list; compact hides them." indent>
          <Seg<CardLayout>
            value={cardLayout}
            options={[
              { id: 'detailed', label: 'Detailed' },
              { id: 'compact', label: 'Compact' },
            ]}
            onChange={setCardLayout}
          />
        </Row>
        {NAV_ROWS.map((r) => (
          <Row key={r.key} label={r.label} hint={r.hint} indent>
            <Switch
              on={sidebarNav[r.key]}
              onChange={(v) => setSidebarNavBit(r.key, v)}
              label={r.label}
            />
          </Row>
        ))}

        <div className="ap-sub-label">File explorer</div>
        <Row label="Show hidden files" hint="Dotfiles like .env and .gitignore." indent>
          <Switch on={filesShowHidden} onChange={setFilesShowHidden} label="Show hidden files" />
        </Row>
      </Advanced>
    </Card>
  );
}

/* ══════════════════════════════════════════════════════════════════════════ */

export function AppearancePanel({ children }: { children?: ReactNode }) {
  return (
    <>
      <h2 className="st-section-head">Appearance</h2>
      <p className="st-section-sub">
        Theme, zoom, terminal appearance, sidebar and status bar. Every change applies live.
      </p>
      {/* Cards are dealt into the columns by height rather than left in source
          order: Terminal alone is nearly as tall as Interface and Window put
          together, so it anchors the second column and the two shorter cards
          stack beside it. Anything passed in joins that second column. */}
      <div className="ap-cards">
        <div className="ap-col">
          <InterfaceCard />
          <WindowCard />
        </div>
        <div className="ap-col">
          <TerminalCard />
          {children}
        </div>
      </div>
    </>
  );
}
