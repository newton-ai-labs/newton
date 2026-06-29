import { useEffect, useRef, useState } from 'react'
import {
  Rocket, X, ChevronRight, Edit, FilePlus, FileMinus, Loader2,
  Check, AlertCircle, CircleDot, Maximize2, Minimize2,
} from 'lucide-react'
import { useStore } from '../../store'
import type { Mission, MissionStep } from '../../../shared/types'

/**
 * Active-session panel. When a mission is running (or recently finished),
 * a floating card appears anchored near the focus node showing:
 *   - mission goal (title)
 *   - step counter + current phase
 *   - the last few file actions / status events
 *   - dismiss / expand controls
 *
 * Expanded mode pulls the card into a right-edge full-height column with
 * the entire step + outcome timeline.
 *
 * Wires to the store's `missions` array which is kept in sync by the
 * existing SSE-driven executeMission flow — no new streaming logic here.
 */

interface Props {
  /** Pixel position of the focus node in the canvas (drives placement). */
  anchorX: number | null
  anchorY: number | null
}

export default function SessionPanel({ anchorX, anchorY }: Props) {
  // Surface the most recently-active mission. activeMission is set on
  // startMission; missions array is the full session list.
  const activeMission = useStore((s) => s.activeMission)
  const missions = useStore((s) => s.missions)
  const removeMission = useStore((s) => s.removeMission)

  // Re-pick the latest mission by updatedAt — `activeMission` can lag
  // behind a fast SSE stream by one render.
  const mission: Mission | null = activeMission
    ? missions.find((m) => m.id === activeMission.id) ?? activeMission
    : null

  const [expanded, setExpanded] = useState(false)
  const [dismissedId, setDismissedId] = useState<string | null>(null)

  // When a NEW mission starts, undismiss so it re-shows.
  useEffect(() => {
    if (mission && mission.id !== dismissedId) {
      // keep expanded state as-is; dismissed flag clears below
    }
  }, [mission?.id])

  if (!mission || mission.id === dismissedId) return null

  const stepsDone = mission.steps.filter((s) => s.status === 'done' || s.status === 'skipped').length
  const stepsErr = mission.steps.filter((s) => s.status === 'error').length
  const stepsTotal = mission.steps.length
  const isRunning = mission.status === 'running' || mission.status === 'planning'

  // Anchor-relative placement (collapsed only). Offset to the right + below
  // the focus node. Clamp inside the viewport so it can't fall off-screen.
  const collapsedPos = computeCollapsedPosition(anchorX, anchorY)

  return (
    <div
      style={expanded ? expandedStyle : { ...collapsedStyle, left: collapsedPos.x, top: collapsedPos.y }}
      className="cn-session-panel"
    >
      <header style={headerStyle}>
        <Rocket size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={titleStyle} title={mission.goal}>{mission.goal}</div>
          <div style={metaStyle}>
            <span>{statusLabel(mission)}</span>
            <span style={dotSepStyle}>·</span>
            <span>{stepsDone}/{stepsTotal} step{stepsTotal === 1 ? '' : 's'}</span>
            {stepsErr > 0 && (
              <>
                <span style={dotSepStyle}>·</span>
                <span style={{ color: 'var(--red)' }}>{stepsErr} error{stepsErr === 1 ? '' : 's'}</span>
              </>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
          <button
            type="button"
            className="ct-icon-btn"
            onClick={() => setExpanded((v) => !v)}
            title={expanded ? 'Collapse' : 'Expand'}
            aria-label={expanded ? 'Collapse session' : 'Expand session'}
          >
            {expanded ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
          <button
            type="button"
            className="ct-icon-btn"
            onClick={() => {
              setDismissedId(mission.id)
              // If user dismisses while mission is done/failed, also remove
              // it from the store so it doesn't reappear. Running missions
              // are kept (just hidden) so the user can re-find them later.
              if (!isRunning) removeMission(mission.id)
            }}
            title={isRunning ? 'Hide (mission keeps running)' : 'Dismiss'}
            aria-label="Dismiss session"
          >
            <X size={13} />
          </button>
        </div>
      </header>

      <div style={expanded ? bodyExpandedStyle : bodyCollapsedStyle}>
        {/* Failed missions: show the planner/validator reason prominently.
            This card persists until the user dismisses it, so they have
            time to read the actual error instead of chasing a fading toast. */}
        {mission.status === 'failed' && mission.summary && (
          <div style={failureStyle}>
            <AlertCircle size={13} style={{ color: 'var(--red)', flexShrink: 0, marginTop: 1 }} />
            <div style={{ flex: 1, whiteSpace: 'pre-wrap' }}>{mission.summary}</div>
          </div>
        )}
        {/* Step list — when collapsed, show the last N items reversed so most
            recent action is at the top of the card. Expanded shows all in
            forward order with the summary text. */}
        {mission.steps.length === 0 && mission.status !== 'failed' && (
          <div style={{ padding: '6px 8px', fontSize: 11.5, color: 'var(--text-faint)' }}>
            No steps yet.
          </div>
        )}
        {(expanded ? mission.steps : mission.steps.slice(-4).reverse()).map((step, i) => (
          <StepRow key={step.id ?? `${i}`} step={step} expanded={expanded} />
        ))}
        {expanded && mission.outcomes.length > 0 && (
          <>
            <div style={sectionLabel}>Outcomes</div>
            {mission.outcomes.map((o, i) => (
              <div key={i} style={outcomeRowStyle}>
                {o.passed === true && <Check size={12} style={{ color: 'var(--green)', flexShrink: 0 }} />}
                {o.passed === false && <AlertCircle size={12} style={{ color: 'var(--red)', flexShrink: 0 }} />}
                {o.passed === undefined && <CircleDot size={12} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />}
                <span style={{ fontSize: 12, color: 'var(--text)' }}>{o.label}</span>
                {o.actual && (
                  <span style={{ fontSize: 11, color: 'var(--text-dim)', marginLeft: 'auto', whiteSpace: 'pre-wrap' }}>
                    {o.actual.length > 60 ? o.actual.slice(0, 60) + '…' : o.actual}
                  </span>
                )}
              </div>
            ))}
          </>
        )}
      </div>

      {!expanded && (
        <button
          type="button"
          className="cn-session-expand-hint"
          onClick={() => setExpanded(true)}
        >
          <ChevronRight size={11} /> open full session
        </button>
      )}
    </div>
  )
}

function StepRow({ step, expanded }: { step: MissionStep; expanded: boolean }) {
  const Icon = iconForStep(step)
  const color = colorForStep(step)
  return (
    <div style={stepRowStyle}>
      <Icon size={12} style={{ color, flexShrink: 0, marginTop: 1 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={stepPathStyle}>
          {step.path ? shortName(step.path) : (step.description || step.action || 'step')}
          {step.path && expanded && (
            <span style={{ color: 'var(--text-faint)', fontSize: 10.5, marginLeft: 6 }}>
              {step.path.split('/').slice(0, -1).join('/')}
            </span>
          )}
        </div>
        {expanded && step.note && (
          <div style={stepNoteStyle}>{step.note}</div>
        )}
      </div>
      <span style={{
        fontSize: 10,
        textTransform: 'uppercase',
        letterSpacing: 0.4,
        color,
        flexShrink: 0,
      }}>
        {step.status === 'pending' ? 'queued' : step.status}
      </span>
    </div>
  )
}

function iconForStep(s: MissionStep) {
  if (s.status === 'running') return Loader2
  if (s.status === 'error') return AlertCircle
  if (s.action === 'create') return FilePlus
  if (s.action === 'delete') return FileMinus
  if (s.action === 'edit' || s.action === 'patch') return Edit
  return CircleDot
}

function colorForStep(s: MissionStep): string {
  if (s.status === 'error') return 'var(--red)'
  if (s.status === 'running') return 'var(--accent)'
  if (s.status === 'done') return 'var(--green)'
  if (s.status === 'skipped') return 'var(--text-faint)'
  return 'var(--text-dim)'
}

function statusLabel(m: Mission): string {
  switch (m.status) {
    case 'planning': return 'planning'
    case 'running': return m.phase === 'verify' ? 'verifying' : 'running'
    case 'paused': return 'paused'
    case 'done': return 'done'
    case 'failed': return 'failed'
    case 'cancelled': return 'cancelled'
    default: return m.status
  }
}

function shortName(p: string): string {
  return p.split('/').pop() || p
}

function computeCollapsedPosition(x: number | null, y: number | null): { x: number; y: number } {
  const PANEL_W = 280
  const PANEL_EST_H = 200
  const PAD = 16
  // No anchor (user submitted from the prompt without focusing a node):
  // park the panel just above the prompt HUD where their attention already
  // is. Previously this defaulted to top-right corner which users missed.
  const PROMPT_RESERVED = 110  // matches PromptHUD's bottom: 18 + ~92 tall
  if (x === null || y === null) {
    return {
      x: Math.max(PAD, window.innerWidth / 2 - PANEL_W / 2),
      y: Math.max(60, window.innerHeight - PANEL_EST_H - PROMPT_RESERVED),
    }
  }
  // Anchored to a focus node: offset right + slightly below.
  let px = x + 32
  let py = y - 20
  if (px + PANEL_W + PAD > window.innerWidth) px = x - PANEL_W - 32
  if (px < PAD) px = PAD
  if (py + PANEL_EST_H + PROMPT_RESERVED > window.innerHeight) py = y - PANEL_EST_H - 12
  if (py < 50) py = 50
  return { x: px, y: py }
}

// ----- styles -----
const collapsedStyle: React.CSSProperties = {
  position: 'absolute',
  width: 280,
  zIndex: 6,
  background: 'color-mix(in srgb, var(--panel) 92%, transparent)',
  border: '0.5px solid var(--border-strong, var(--border))',
  borderRadius: 10,
  backdropFilter: 'blur(10px)',
  boxShadow: 'var(--shadow, 0 20px 60px rgba(0,0,0,0.4))',
  overflow: 'hidden',
}
const expandedStyle: React.CSSProperties = {
  position: 'absolute',
  top: 60,
  right: 18,
  bottom: 120,
  width: 380,
  zIndex: 6,
  background: 'color-mix(in srgb, var(--panel) 94%, transparent)',
  border: '0.5px solid var(--border-strong, var(--border))',
  borderRadius: 12,
  backdropFilter: 'blur(12px)',
  boxShadow: 'var(--shadow-strong, var(--shadow))',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
}
const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
  padding: '10px 10px 8px',
  borderBottom: '0.5px solid var(--border-soft)',
}
const titleStyle: React.CSSProperties = {
  fontSize: 12.5,
  fontWeight: 500,
  color: 'var(--text)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  marginBottom: 3,
}
const metaStyle: React.CSSProperties = {
  fontSize: 10.5,
  color: 'var(--text-dim)',
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  flexWrap: 'wrap',
}
const dotSepStyle: React.CSSProperties = {
  color: 'var(--text-faint)',
}
const bodyCollapsedStyle: React.CSSProperties = {
  padding: '6px 8px',
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  maxHeight: 180,
  overflowY: 'auto',
}
const bodyExpandedStyle: React.CSSProperties = {
  padding: '8px 10px',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  overflowY: 'auto',
  flex: 1,
  minHeight: 0,
}
const stepRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 8,
  padding: '5px 6px',
  borderRadius: 5,
  fontSize: 12,
  color: 'var(--text)',
}
const stepPathStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono, ui-monospace, monospace)',
  fontSize: 11.5,
  color: 'var(--text)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}
const stepNoteStyle: React.CSSProperties = {
  fontSize: 10.5,
  color: 'var(--text-dim)',
  marginTop: 2,
  lineHeight: 1.4,
}
const sectionLabel: React.CSSProperties = {
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  color: 'var(--text-faint)',
  padding: '12px 6px 4px',
}
const outcomeRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '4px 6px',
}
const failureStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'flex-start',
  padding: '8px 10px',
  margin: '4px 4px 8px',
  borderRadius: 6,
  background: 'color-mix(in srgb, var(--red) 14%, transparent)',
  border: '0.5px solid color-mix(in srgb, var(--red) 40%, transparent)',
  color: 'var(--text)',
  fontSize: 11.5,
  lineHeight: 1.45,
  fontFamily: 'var(--font-mono, ui-monospace, monospace)',
  maxHeight: 220,
  overflowY: 'auto',
}
