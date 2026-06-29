import React, { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { getTheme, toggleTheme, subscribeTheme, type Theme } from '../theme'

interface ThemeToggleProps {
  /** Optional extra class names for layout integration. */
  className?: string
  /** Show a text label next to the icon. */
  withLabel?: boolean
}

/**
 * Light/dark theme toggle. Self-contained: reads & writes the persisted theme
 * through `src/theme.ts` and re-renders when the theme changes anywhere.
 */
export default function ThemeToggle({ className, withLabel = false }: ThemeToggleProps) {
  const [theme, setLocalTheme] = useState<Theme>(() => getTheme())

  useEffect(() => {
    setLocalTheme(getTheme())
    return subscribeTheme((t) => setLocalTheme(t))
  }, [])

  const isDark = theme === 'dark'
  const label = isDark ? 'Switch to light mode' : 'Switch to dark mode'

  return (
    <button
      type="button"
      className={['theme-toggle', className].filter(Boolean).join(' ')}
      onClick={() => toggleTheme()}
      title={label}
      aria-label={label}
      aria-pressed={!isDark}
    >
      {isDark ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
      {withLabel && <span className="theme-toggle-label">{isDark ? 'Light' : 'Dark'}</span>}
    </button>
  )
}
