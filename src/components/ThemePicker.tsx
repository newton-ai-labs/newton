import React, { useEffect, useRef, useState } from 'react'
import { Palette, Check } from 'lucide-react'
import { THEMES, getTheme, setTheme, subscribeTheme, type Theme } from '../theme'

interface ThemePickerProps {
  /** Extra class for the trigger button (e.g. 'activity-btn'). */
  className?: string
}

/**
 * Theme picker popover. The trigger button shows a palette icon; clicking
 * opens a small grid of swatch + name tiles. The current theme has a check
 * mark. Click any tile to apply instantly.
 */
export default function ThemePicker({ className }: ThemePickerProps) {
  const [theme, setLocalTheme] = useState<Theme>(() => getTheme())
  const [open, setOpen] = useState(false)
  const popRef = useRef<HTMLDivElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  // Keep the local copy in sync if theme changes elsewhere.
  useEffect(() => subscribeTheme((t) => setLocalTheme(t)), [])

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node
      if (popRef.current?.contains(t)) return
      if (btnRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={['theme-picker-trigger', className].filter(Boolean).join(' ')}
        onClick={() => setOpen((o) => !o)}
        title="Theme"
        aria-label="Theme"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Palette size={16} aria-hidden="true" />
      </button>

      {open && (
        <div ref={popRef} className="theme-picker-pop" role="dialog" aria-label="Choose theme">
          <div className="theme-picker-title">Theme</div>
          <div className="theme-picker-list">
            {THEMES.map((t) => {
              const active = t.id === theme
              return (
                <button
                  key={t.id}
                  type="button"
                  className={`theme-picker-item ${active ? 'is-active' : ''}`}
                  onClick={() => {
                    setTheme(t.id)
                    setOpen(false)
                  }}
                  aria-pressed={active}
                  title={t.description}
                >
                  <div
                    className="theme-picker-swatch"
                    style={{
                      background: t.swatch[0],
                      boxShadow: `inset 0 0 0 1px rgba(255,255,255,0.06), 0 0 0 0 transparent`,
                    }}
                  >
                    <div
                      className="theme-picker-swatch-accent"
                      style={{ background: t.swatch[1] }}
                    />
                  </div>
                  <div className="theme-picker-meta">
                    <div className="theme-picker-name">
                      {t.name}
                      {active && <Check size={12} aria-hidden="true" />}
                    </div>
                    <div className="theme-picker-mode">{t.mode}</div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </>
  )
}
