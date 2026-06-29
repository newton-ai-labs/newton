/**
 * Newton theme manager.
 *
 * Manages an arbitrary set of themes from src/themes/registry.ts. The chosen
 * theme is persisted to localStorage and applied to <html> via a `data-theme`
 * attribute. Each theme's CSS variable definitions live in src/themes.css.
 *
 * Backward compatibility: older versions persisted just 'light' or 'dark';
 * we migrate those to the new IDs on first read.
 */

import { DEFAULT_THEME_ID, isValidThemeId, THEMES, type ThemeDef } from './themes/registry'

export type Theme = string  // any registered theme ID

const STORAGE_KEY = 'newton.theme'

type Listener = (theme: Theme) => void
const listeners = new Set<Listener>()

/**
 * Migrate legacy/removed theme IDs. Anything not in the registry falls
 * through to DEFAULT_THEME_ID via isValidThemeId below.
 */
function migrate(raw: string | null): string | null {
  if (raw === 'light' || raw === 'daylight') return 'newton-light'
  if (raw === 'dark') return 'newton'
  return raw
}

/** Read the persisted theme, falling back to the default. */
export function getTheme(): Theme {
  if (typeof localStorage !== 'undefined') {
    try {
      const raw = migrate(localStorage.getItem(STORAGE_KEY))
      if (raw && isValidThemeId(raw)) return raw
    } catch {
      /* localStorage may be unavailable */
    }
  }
  return DEFAULT_THEME_ID
}

/** Apply a theme to <html> and persist it. Notifies subscribers. */
export function setTheme(theme: Theme): void {
  const next: Theme = isValidThemeId(theme) ? theme : DEFAULT_THEME_ID
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.setAttribute('data-theme', next)
  }
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* ignore persistence failures */
    }
  }
  for (const fn of listeners) {
    try {
      fn(next)
    } catch {
      /* a bad listener should not break others */
    }
  }
}

/**
 * Cycle to the next theme in registry order — used by the keyboard shortcut.
 * Returns the new theme.
 */
export function cycleTheme(): Theme {
  const current = getTheme()
  const idx = THEMES.findIndex((t) => t.id === current)
  const next = THEMES[(idx + 1) % THEMES.length]
  setTheme(next.id)
  return next.id
}

/** Subscribe to theme changes. Returns an unsubscribe function. */
export function subscribeTheme(fn: Listener): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}

/** Apply the persisted/preferred theme. Call once at app startup. */
export function initTheme(): Theme {
  const theme = getTheme()
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.setAttribute('data-theme', theme)
  }
  return theme
}

/** Re-export registry helpers so consumers don't need two imports. */
export { THEMES, getThemeDef } from './themes/registry'
export type { ThemeDef } from './themes/registry'
