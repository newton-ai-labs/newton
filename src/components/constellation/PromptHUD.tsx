import { useEffect, useRef, useState } from 'react'
import { Sparkles, Target, CircleDot, Rocket } from 'lucide-react'
import { useStore } from '../../store'
import { useGraph, neighborsOf } from './useGraph'

/**
 * Floating prompt HUD — the only persistent control besides the top bar.
 * Sits at the bottom-center of the constellation. Live "targeting" line
 * shows what context the AI will actually receive (focus node + N nearby
 * files via the import graph) — finally giving the auto-attach work visual
 * footing.
 *
 * Submit currently calls store.startMission, which is the existing mission
 * pipeline (with the patch action, validators, and size-ratio guards we
 * built earlier). Phase 4 will replace the toast with a session card
 * floating near the focus node.
 */

interface Props {
  /** Currently selected node id (its path). When set, becomes the focus target. */
  focusNodeId: string | null
}

const NEIGHBOR_LIMIT = 6

export default function PromptHUD({ focusNodeId }: Props) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const { graph } = useGraph()

  const startMission = useStore((s) => s.startMission)
  const executeMission = useStore((s) => s.executeMission)
  const settings = useStore((s) => s.settings)
  const toast = useStore((s) => s.toast)
  // Show a "Newton is working…" line in the HUD itself while a mission is
  // running, so the user has a visible indicator even if they miss the
  // session panel.
  const activeMission = useStore((s) => s.activeMission)
  const missions = useStore((s) => s.missions)
  const liveMission = activeMission ? missions.find((m) => m.id === activeMission.id) ?? activeMission : null
  const missionInFlight = liveMission && (liveMission.status === 'running' || liveMission.status === 'planning')

  // Auto-grow the textarea up to a cap so the user can compose a paragraph
  // without losing the constellation behind it.
  useEffect(() => {
    const el = taRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [value])

  const neighbors = focusNodeId && graph ? neighborsOf(graph, focusNodeId, NEIGHBOR_LIMIT) : []
  const targeting = focusNodeId
    ? { mode: 'node' as const, primary: focusNodeId, neighbors }
    : { mode: 'workspace' as const, primary: null, neighbors: [] as string[] }

  const submit = async () => {
    const trimmed = value.trim()
    if (!trimmed || busy) return
    setBusy(true)
    try {
      const contextFiles = focusNodeId ? [focusNodeId, ...neighbors] : []
      const m = await startMission(trimmed, contextFiles)
      if (m) {
        setValue('')
        // A returned mission with status='failed' means startMission
        // recovered a planner-failure — don't auto-execute (there's nothing
        // to run) and don't toast a success message; the SessionPanel will
        // show the failure with its full reason.
        if (m.status === 'failed') return
        toast(`Mission started — ${m.steps.length} step${m.steps.length === 1 ? '' : 's'}`)
        // Auto-execute the mission so the session panel can stream its
        // progress immediately. In the classic layout the user clicks
        // Execute; in the constellation that extra step would feel wrong
        // (you asked for the change → you get the change).
        executeMission(m.id).catch(() => { /* errors surface via store toasts */ })
      }
    } finally {
      setBusy(false)
    }
  }

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Shift+Enter sends; bare Enter inserts a newline. Convention chosen so
    // users can compose multi-line prompts without accidentally submitting.
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault()
      void submit()
    }
  }

  const providerLabel = settings.provider === 'demo'
    ? 'Demo'
    : `${settings.provider}${settings.providerConfigs[settings.provider]?.model ? ' · ' + settings.providerConfigs[settings.provider]!.model : ''}`

  return (
    <div style={hudWrapStyle}>
      <div style={hudStyle}>
        {missionInFlight && liveMission && (
          <div style={inFlightRowStyle}>
            <span className="cn-hud-pulse" />
            <span>
              Working on <strong style={{ color: 'var(--text)' }}>{liveMission.goal}</strong>
              {liveMission.steps.length > 0 && (
                <span style={{ color: 'var(--text-faint)' }}>
                  {' '}— {liveMission.steps.filter((s) => s.status === 'done' || s.status === 'skipped').length}/{liveMission.steps.length} steps
                </span>
              )}
            </span>
          </div>
        )}
        <div style={inputRowStyle}>
          <Sparkles size={15} style={{ color: 'var(--accent)', flexShrink: 0, marginTop: 4 }} />
          <textarea
            ref={taRef}
            className="cn-hud-input"
            placeholder={focusNodeId
              ? `Ask about ${shortName(focusNodeId)}, or describe a change…`
              : 'Ask Newton, or describe what to build…'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKey}
            rows={1}
            disabled={busy}
          />
          <button
            type="button"
            className={`cn-send-btn ${value.trim() && !busy ? 'is-ready' : ''}`}
            onClick={submit}
            disabled={!value.trim() || busy}
            title="Send (Shift+Enter)"
          >
            <Rocket size={13} />
            <span>{busy ? 'sending…' : 'send'}</span>
          </button>
        </div>

        <div style={metaRowStyle}>
          {targeting.mode === 'node' ? (
            <>
              <Target size={11} style={{ color: 'var(--accent)', flexShrink: 0 }} />
              <span>targeting</span>
              <code style={codePillStyle}>{shortName(targeting.primary!)}</code>
              {neighbors.length > 0 && (
                <>
                  <CircleDot size={11} style={{ color: 'var(--text-faint)', flexShrink: 0, marginLeft: 4 }} />
                  <span>
                    + {neighbors.length} nearby file{neighbors.length === 1 ? '' : 's'}
                  </span>
                  <span style={{ color: 'var(--text-faint)' }} title={neighbors.join('\n')}>
                    ({neighbors.slice(0, 2).map(shortName).join(', ')}
                    {neighbors.length > 2 ? `, +${neighbors.length - 2}` : ''})
                  </span>
                </>
              )}
            </>
          ) : (
            <>
              <Target size={11} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
              <span>no focus — click a node to target, or leave blank to ask about the whole workspace</span>
            </>
          )}
          <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: 'var(--text-faint)' }}>⇧⏎ send</span>
            <span style={providerBadgeStyle}>{providerLabel}</span>
          </span>
        </div>
      </div>
    </div>
  )
}

function shortName(path: string): string {
  return path.split('/').pop() || path
}

const hudWrapStyle: React.CSSProperties = {
  position: 'absolute',
  left: 0,
  right: 0,
  bottom: 18,
  display: 'flex',
  justifyContent: 'center',
  pointerEvents: 'none',  // so clicks pass through the wrapper to the canvas
  zIndex: 4,
}
const hudStyle: React.CSSProperties = {
  width: 'min(560px, calc(100vw - 64px))',
  background: 'color-mix(in srgb, var(--panel) 88%, transparent)',
  border: '0.5px solid var(--border-strong, var(--border))',
  borderRadius: 12,
  padding: '10px 12px',
  backdropFilter: 'blur(12px)',
  boxShadow: 'var(--shadow, 0 20px 60px rgba(0,0,0,0.4))',
  pointerEvents: 'auto',
}
const inputRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
}
const inFlightRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '2px 4px 8px',
  marginBottom: 4,
  borderBottom: '0.5px solid var(--border-soft)',
  fontSize: 12,
  color: 'var(--text-dim)',
}
const metaRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  marginTop: 8,
  paddingTop: 8,
  borderTop: '0.5px solid var(--border-soft)',
  fontSize: 11,
  color: 'var(--text-dim)',
  flexWrap: 'wrap',
}
const codePillStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono, ui-monospace, monospace)',
  fontSize: 10.5,
  padding: '1px 6px',
  borderRadius: 4,
  background: 'color-mix(in srgb, var(--accent) 14%, transparent)',
  color: 'var(--accent-2, var(--accent))',
}
const providerBadgeStyle: React.CSSProperties = {
  padding: '2px 7px',
  borderRadius: 4,
  background: 'var(--panel-2)',
  color: 'var(--text-dim)',
  fontSize: 10.5,
  border: '0.5px solid var(--border)',
}
