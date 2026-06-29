/**
 * Newton theme manager.
 *
 * Provides a self-contained light/dark theme toggle that does NOT depend on the
 * Zustand store. The chosen theme is persisted to localStorage and applied to
 * the document root via a `data-theme` attribute. Light-mode CSS variable
 * overrides live in `src/theme-light.css` (imported once at startup).
 */

export type Theme = 'dark' | 'light'

const STORAGE_KEY = 'newton.theme'

type Listener = (theme: Theme) => void
const listeners = new Set<Listener>()

function isTheme(v: unknown): v is Theme {
  return v === 'dark' || v === 'light'
}

/** Read the persisted theme, falling back to the OS preference, then dark. */
export function getTheme(): Theme {
  if (typeof localStorage !== 'undefined') {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (isTheme(raw)) return raw
    } catch {
      /* localStorage may be unavailable */
    }
  }
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    try {
      if (window.matchMedia('(prefers-color-scheme: light)').matches) return 'light'
    } catch {
      /* matchMedia may throw in some environments */
    }
  }
  return 'dark'
}

/** Apply a theme to <html> and persist it. Notifies subscribers. */
export function setTheme(theme: Theme): void {
  const next: Theme = isTheme(theme) ? theme : 'dark'
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

/** Flip between light and dark, returning the new theme. */
export function toggleTheme(): Theme {
  const next: Theme = getTheme() === 'dark' ? 'light' : 'dark'
  setTheme(next)
  return next
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
