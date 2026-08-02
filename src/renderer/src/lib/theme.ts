import { getTheme, withAccent, ACCENT_OVERRIDES, type Theme } from '@shared/themes'
import type { Settings } from '@shared/types'

/** CSS custom property name for each token. */
const VAR: Record<string, string> = {
  ink000: '--ink-000',
  ink050: '--ink-050',
  ink100: '--ink-100',
  ink200: '--ink-200',
  ink300: '--ink-300',
  ink400: '--ink-400',
  ink500: '--ink-500',
  line100: '--line-100',
  line200: '--line-200',
  line300: '--line-300',
  textHi: '--text-hi',
  textMid: '--text-mid',
  textLo: '--text-lo',
  textDim: '--text-dim',
  accent: '--accent',
  accentDim: '--accent-dim',
  accentWash: '--accent-wash',
  accentEdge: '--accent-edge',
  onAccent: '--on-accent',
  live: '--live',
  attention: '--attention',
  onAttention: '--on-attention',
  danger: '--danger',
  scrim: '--scrim',
  glass: '--glass'
}

/** Resolves the active theme from settings, applying any accent override. */
export function resolveTheme(settings: Settings): Theme {
  const base = getTheme(settings.themeId)
  const override = settings.accentOverride
  if (!override) return base
  const hex = ACCENT_OVERRIDES.find((a) => a.id === override)?.hex
  return hex ? withAccent(base, hex) : base
}

/** Writes the theme onto the document. Every rule reads through these vars. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement
  for (const [key, value] of Object.entries(theme.tokens)) {
    const name = VAR[key]
    if (name) root.style.setProperty(name, value)
  }
  root.dataset.theme = theme.id
  root.dataset.mode = theme.mode
  // Lets the native scrollbars and form controls match.
  root.style.colorScheme = theme.mode
}
