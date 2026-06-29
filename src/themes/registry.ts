/**
 * Theme registry — the user-facing metadata + the set of valid theme IDs.
 * Add a new theme by appending an entry here and a matching block to
 * src/themes.css.
 */

export type ThemeMode = 'dark' | 'light'

export interface ThemeDef {
  id: string
  name: string
  mode: ThemeMode
  description: string
  /**
   * Two-color swatch for the picker: [surface, accent]. Should match the
   * theme's `--panel` and `--accent` so the swatch previews the look.
   */
  swatch: [string, string]
}

export const THEMES: ThemeDef[] = [
  {
    id: 'newton',
    name: 'Newton',
    mode: 'dark',
    description: 'Deep blue-black with violet & cyan accents — the original.',
    swatch: ['#0e1019', '#7c5cff'],
  },
  {
    id: 'newton-light',
    name: 'Newton Light',
    mode: 'light',
    description: 'Soft paper whites with the Newton violet accent.',
    swatch: ['#f5f4f0', '#7c3aed'],
  },
]

export const DEFAULT_THEME_ID = 'newton'

export function isValidThemeId(v: unknown): v is string {
  return typeof v === 'string' && THEMES.some((t) => t.id === v)
}

export function getThemeDef(id: string): ThemeDef | undefined {
  return THEMES.find((t) => t.id === id)
}
