import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Search,
  FileCode,
  Settings as SettingsIcon,
  Palette,
  Layers,
  Terminal,
  Rocket,
  CheckCircle2,
  AlertCircle,
  Loader2,
  CircleDot,
} from 'lucide-react'
import { useStore } from '../../store'
import { useGraph } from './useGraph'
import { THEMES, getTheme, setTheme } from '../../theme'
import type { Mission } from '../../../shared/types'

/**
 * Constellation-native ⌘K palette. Replaces the activity-bar discovery
 * layer with one keystroke.
 *
 * Query modes:
 *   - no prefix → mixed: top commands + best file matches
 *   - "> ..."   → commands only (settings, theme, layout, terminal)
 *   - "@ ..."   → files only
 *
 * Selecting a file dispatches a `newton:focus-node` CustomEvent that the
 * ConstellationLayout listens for — keeps palette/layout decoupled.
 */

type RowKind = 'command' | 'file' | 'session'

interface Row {
  id: string
  kind: RowKind
  label: string
  hint?: string
  icon: typeof Search
  run: () => void
  /** match score against the query (higher = better) — used for sort */
  score: number
}

export default function ConstellationPalette() {
  const open = useStore((s) => s.paletteOpen)
  const setOpen = useStore((s) => s.setPaletteOpen)
  const setSettingsOpen = useStore((s) => s.setSettingsOpen)
  const setTerminalOpen = useStore((s) => s.setTerminalOpen)
  const setSettings = useStore((s) => s.setSettings)
  const settings = useStore((s) => s.settings)
  const missions = useStore((s) => s.missions)
  const setActiveMission = useStore((s) => s.setActiveMission)
  const { graph } = useGraph()

  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Reset state every time the palette opens — avoids "ghost typing" from
  // the previous session.
  useEffect(() => {
    if (open) {
      setQ('')
      setSel(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  const focusNode = (nodeId: string) => {
    window.dispatchEvent(new CustomEvent('newton:focus-node', { detail: { nodeId } }))
    setOpen(false)
  }

  const cycleTheme = () => {
    const order = THEMES.map((t) => t.id)
    const idx = order.indexOf(getTheme())
    setTheme(order[(idx + 1) % order.length])
  }

  // Static command set. These get fuzzy-matched against the query like
  // files do; no special handling beyond the icon and a possibly different
  // run-time effect.
  const commands: Omit<Row, 'score'>[] = useMemo(() => [
    {
      id: 'cmd:settings',
      kind: 'command',
      label: 'Open Settings',
      hint: '⌘,',
      icon: SettingsIcon,
      run: () => { setSettingsOpen(true); setOpen(false) },
    },
    {
      id: 'cmd:theme',
      kind: 'command',
      label: 'Switch theme',
      hint: `current: ${getTheme()}`,
      icon: Palette,
      run: () => { cycleTheme(); setOpen(false) },
    },
    {
      id: 'cmd:layout',
      kind: 'command',
      label: settings.layout === 'constellation' ? 'Switch to classic layout' : 'Switch to constellation',
      hint: settings.layout,
      icon: Layers,
      run: () => {
        setSettings({ layout: settings.layout === 'constellation' ? 'classic' : 'constellation' })
        setOpen(false)
      },
    },
    {
      id: 'cmd:terminal',
      kind: 'command',
      label: 'Open terminal',
      hint: '⌃`',
      icon: Terminal,
      run: () => { setTerminalOpen(true); setOpen(false) },
    },
  ], [settings.layout, setSettingsOpen, setOpen, setTerminalOpen, setSettings])

  // Files derived from the graph.
  const fileRows: Omit<Row, 'score'>[] = useMemo(() => {
    if (!graph) return []
    return Object.values(graph.nodes).map((n) => ({
      id: `file:${n.id}`,
      kind: 'file' as const,
      label: n.path.split('/').pop() ?? n.path,
      hint: n.path.includes('/') ? n.path.split('/').slice(0, -1).join('/') : undefined,
      icon: FileCode,
      run: () => focusNode(n.id),
    }))
  }, [graph])

  // Past missions become navigable: pick one → it's set as active (so the
  // SessionPanel re-shows it) and we fly to its first edited file, if any.
  const sessionRows: Omit<Row, 'score'>[] = useMemo(() => {
    return [...missions]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, 50)
      .map((m) => ({
        id: `session:${m.id}`,
        kind: 'session' as const,
        label: m.goal,
        hint: `${missionStatusLabel(m)} · ${missionAge(m.updatedAt)}`,
        icon: missionIcon(m),
        run: () => {
          setActiveMission(m)
          setOpen(false)
          const primary = primaryFile(m)
          if (primary) window.dispatchEvent(new CustomEvent('newton:focus-node', { detail: { nodeId: primary } }))
        },
      }))
  }, [missions, setActiveMission, setOpen])

  const rows = useMemo<Row[]>(() => {
    const trimmed = q.trim()
    const cmdMode = trimmed.startsWith('>')
    const fileMode = trimmed.startsWith('@')
    const sessionMode = trimmed.startsWith('~')
    const queryText = (cmdMode || fileMode || sessionMode) ? trimmed.slice(1).trim() : trimmed

    const candidates: Omit<Row, 'score'>[] = []
    if (sessionMode) candidates.push(...sessionRows)
    else if (fileMode) candidates.push(...fileRows)
    else if (cmdMode) candidates.push(...commands)
    else {
      // Default mixed view: sessions on top (most-recent first by insertion
      // order from sessionRows), then commands, then files. The sort
      // tiebreak below keeps that ordering when scores are equal.
      candidates.push(...sessionRows, ...commands, ...fileRows)
    }

    const lower = queryText.toLowerCase()
    const scored: Row[] = []
    for (const c of candidates) {
      const score = matchScore(c, lower)
      if (score > -1) scored.push({ ...c, score })
    }
    const kindRank: Record<RowKind, number> = { session: 0, command: 1, file: 2 }
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      if (a.kind !== b.kind) return kindRank[a.kind] - kindRank[b.kind]
      return a.label.localeCompare(b.label)
    })
    return scored.slice(0, 60)
  }, [q, commands, fileRows, sessionRows])

  // Clamp selection when the result set shrinks.
  useEffect(() => { setSel((s) => Math.min(s, Math.max(0, rows.length - 1))) }, [rows.length])

  // Scroll the selected row into view as the user arrows down past the
  // visible area.
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const el = list.children[sel] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  // Keybindings while open: arrow nav, ↵ activate, Esc close.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); setOpen(false) }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(rows.length - 1, s + 1)) }
      else if (e.key === 'ArrowUp')   { e.preventDefault(); setSel((s) => Math.max(0, s - 1)) }
      else if (e.key === 'Enter')     { e.preventDefault(); rows[sel]?.run() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, rows, sel, setOpen])

  if (!open) return null

  return (
    <div style={overlayStyle} onClick={() => setOpen(false)}>
      <div style={popStyle} onClick={(e) => e.stopPropagation()}>
        <div style={inputRowStyle}>
          <Search size={15} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
          <input
            ref={inputRef}
            className="cn-pal-input"
            placeholder="Type to search files & commands.  > commands, @ files"
            value={q}
            onChange={(e) => { setQ(e.target.value); setSel(0) }}
          />
          <span style={escPillStyle}>esc</span>
        </div>
        <div ref={listRef} style={listStyle}>
          {rows.length === 0 && (
            <div style={emptyStyle}>No matches{q.trim() ? ` for "${q.trim()}"` : ''}.</div>
          )}
          {rows.map((r, i) => {
            const Icon = r.icon
            const active = i === sel
            return (
              <button
                key={r.id}
                type="button"
                className={`cn-pal-row ${active ? 'is-active' : ''}`}
                onMouseEnter={() => setSel(i)}
                onClick={() => r.run()}
              >
                <Icon size={14} style={{ color: iconTint(r.kind), flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 6, overflow: 'hidden' }}>
                  <span style={{ fontSize: 13, color: 'var(--text)', whiteSpace: 'nowrap' }}>{r.label}</span>
                  {r.hint && (
                    <span style={{ fontSize: 11, color: 'var(--text-faint)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.hint}
                    </span>
                  )}
                </span>
                <span style={{
                  fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5,
                  color: 'var(--text-faint)', flexShrink: 0,
                }}>
                  {r.kind}
                </span>
              </button>
            )
          })}
        </div>
        <div style={footerStyle}>
          <span><kbd className="cn-kbd">↑↓</kbd> navigate</span>
          <span><kbd className="cn-kbd">↵</kbd> open</span>
          <span>
            <kbd className="cn-kbd">&gt;</kbd> commands · <kbd className="cn-kbd">@</kbd> files · <kbd className="cn-kbd">~</kbd> sessions
          </span>
          <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, color: 'var(--accent)' }}>
            <Rocket size={11} />
            {rows.length} {rows.length === 1 ? 'result' : 'results'}
          </span>
        </div>
      </div>
    </div>
  )
}

function iconTint(kind: RowKind): string {
  switch (kind) {
    case 'session': return 'var(--accent)'
    case 'file':    return 'var(--accent-2)'
    case 'command':
    default:        return 'var(--text-dim)'
  }
}

function missionIcon(m: Mission) {
  if (m.status === 'running' || m.status === 'planning') return Loader2
  if (m.status === 'done') return CheckCircle2
  if (m.status === 'failed' || m.status === 'cancelled') return AlertCircle
  return CircleDot
}

function missionStatusLabel(m: Mission): string {
  switch (m.status) {
    case 'planning': return 'planning'
    case 'running':  return 'running'
    case 'paused':   return 'paused'
    case 'done':     return 'done'
    case 'failed':   return 'failed'
    case 'cancelled':return 'cancelled'
    default:         return m.status
  }
}

function missionAge(ts: number): string {
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (sec < 60)       return `${sec}s ago`
  if (sec < 3600)     return `${Math.floor(sec / 60)}m ago`
  if (sec < 86_400)   return `${Math.floor(sec / 3600)}h ago`
  return `${Math.floor(sec / 86_400)}d ago`
}

/** Best-guess "primary" file for a mission: the first edited step's path,
    failing that the first attached context file. Used so picking a session
    in the palette flies the canvas to a useful place. */
function primaryFile(m: Mission): string | null {
  for (const s of m.steps) {
    if (s.path && (s.action === 'edit' || s.action === 'patch' || s.action === 'create')) return s.path
  }
  return m.contextFiles?.[0] ?? null
}

/**
 * Tiny fuzzy match: returns a non-negative score for matches (higher is
 * better) or -1 for no match. Empty query matches everything with a low
 * default score so the order falls back to alphabetical.
 *
 * Scoring rules (additive):
 *   - exact word in label/path: +10
 *   - prefix of label: +6
 *   - contained substring in label: +4
 *   - contained substring in hint: +2
 *   - subsequence match (chars in order): +1
 */
function matchScore(row: Omit<Row, 'score'>, q: string): number {
  if (!q) return 1
  const label = row.label.toLowerCase()
  const hint = (row.hint ?? '').toLowerCase()
  let score = 0
  if (label === q) score += 12
  if (label.startsWith(q)) score += 6
  if (label.includes(q)) score += 4
  if (hint.includes(q)) score += 2
  // Cheap subsequence check — last resort.
  if (score === 0) {
    let i = 0
    for (const ch of label) {
      if (ch === q[i]) i++
      if (i === q.length) break
    }
    if (i === q.length) score += 1
  }
  return score > 0 ? score : -1
}

// ----- styles -----
const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'color-mix(in srgb, var(--bg) 60%, transparent)',
  backdropFilter: 'blur(2px)',
  display: 'flex',
  justifyContent: 'center',
  alignItems: 'flex-start',
  paddingTop: 96,
  zIndex: 100,
}
const popStyle: React.CSSProperties = {
  width: 'min(540px, calc(100vw - 32px))',
  background: 'var(--panel)',
  border: '0.5px solid var(--border-strong, var(--border))',
  borderRadius: 12,
  boxShadow: 'var(--shadow-strong, var(--shadow))',
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  maxHeight: '70vh',
}
const inputRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '12px 14px',
  borderBottom: '0.5px solid var(--border-soft)',
}
const escPillStyle: React.CSSProperties = {
  padding: '2px 7px',
  borderRadius: 4,
  background: 'var(--panel-2)',
  border: '0.5px solid var(--border)',
  color: 'var(--text-dim)',
  fontSize: 10.5,
  fontFamily: 'var(--font-mono, ui-monospace, monospace)',
}
const listStyle: React.CSSProperties = {
  padding: 6,
  overflowY: 'auto',
  flex: 1,
  minHeight: 0,
}
const emptyStyle: React.CSSProperties = {
  padding: '20px 10px',
  textAlign: 'center',
  color: 'var(--text-dim)',
  fontSize: 12.5,
}
const footerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  padding: '6px 12px',
  borderTop: '0.5px solid var(--border-soft)',
  fontSize: 10.5,
  color: 'var(--text-faint)',
}
