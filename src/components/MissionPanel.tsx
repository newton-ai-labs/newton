import { useEffect, useState } from 'react'
import {
  Rocket,
  RefreshCw,
  Play,
  Pause,
  Square,
  Trash2,
  CheckCircle2,
  Circle,
  AlertCircle,
  Loader2,
  Target,
  FileCode2,
  ChevronRight,
  Flag,
  Beaker,
  Hammer,
  Sparkles,
} from 'lucide-react'
import { useStore } from '../store'
import type { Mission, MissionStep, MissionOutcome } from '../../shared/types'

const PHASE_LABEL: Record<string, string> = {
  understand: 'Understand',
  plan: 'Planning',
  execute: 'Planned', // Ready for execution
  verify: 'Verifying',
  report: 'Reporting',
}

const STATUS_COLOR: Record<string, string> = {
  done: 'var(--green)',
  running: 'var(--blue)',
  error: 'var(--red, #f07178)',
  failed: 'var(--red, #f07178)',
  pending: 'var(--text-dim)',
  skipped: 'var(--text-dim)',
  paused: 'var(--yellow)',
  cancelled: 'var(--text-dim)',
  planning: 'var(--blue)',
}

function StepIcon({ status }: { status: string }) {
  if (status === 'done') return <CheckCircle2 size={15} style={{ color: STATUS_COLOR.done }} />
  if (status === 'running')
    return <Loader2 size={15} className="spin" style={{ color: STATUS_COLOR.running }} />
  if (status === 'error') return <AlertCircle size={15} style={{ color: STATUS_COLOR.error }} />
  if (status === 'skipped') return <Circle size={15} style={{ color: STATUS_COLOR.skipped }} />
  return <Circle size={15} style={{ color: STATUS_COLOR.pending }} />
}

function OutcomeIcon({ o }: { o: MissionOutcome }) {
  if (o.passed === true) return <CheckCircle2 size={14} style={{ color: 'var(--green)' }} />
  if (o.passed === false) return <AlertCircle size={14} style={{ color: 'var(--red, #f07178)' }} />
  return <Circle size={14} style={{ color: 'var(--text-dim)' }} />
}

function outcomeKindIcon(kind: string) {
  if (kind === 'test') return Beaker
  if (kind === 'build') return Hammer
  if (kind === 'lint') return Sparkles
  return Flag
}

export default function MissionPanel() {
  const missions = useStore((s) => s.missions)
  const activeMission = useStore((s) => s.activeMission)
  const busy = useStore((s) => s.missionBusy)
  const settings = useStore((s) => s.settings)
  const loadMissions = useStore((s) => s.loadMissions)
  const startMission = useStore((s) => s.startMission)
  const executeMission = useStore((s) => s.executeMission)
  const patchMission = useStore((s) => s.patchMission)
  const removeMission = useStore((s) => s.removeMission)
  const verifyMission = useStore((s) => s.verifyMission)
  const setActiveMission = useStore((s) => s.setActiveMission)
  const openFile = useStore((s) => s.openFile)
  const activeTab = useStore((s) => s.tabs.find((t) => t.id === s.activeTabId))

  const [goal, setGoal] = useState('')
  const [attachActive, setAttachActive] = useState(true)

  useEffect(() => {
    loadMissions()
  }, [loadMissions])

  const handleStart = async () => {
    if (!goal.trim()) return
    const ctx = attachActive && activeTab ? [activeTab.path] : []
    const m = await startMission(goal, ctx)
    if (m) setGoal('')
  }

  const advanceStep = async (mission: Mission, step: MissionStep, newStatus: MissionStep['status']) => {
    const steps = mission.steps.map((s) =>
      s.id === step.id
        ? {
            ...s,
            status: newStatus,
            completedAt: newStatus === 'done' ? Date.now() : s.completedAt,
            startedAt: newStatus === 'running' ? Date.now() : s.startedAt,
          }
        : s,
    )
    await patchMission(mission.id, { steps })
  }

  const demo = settings.provider === 'demo'

  return (
    <div className="sidebar-view" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* header */}
      <div className="view-header" style={headerStyle}>
        <Rocket size={15} style={{ color: 'var(--purple, var(--blue))' }} />
        <span style={{ fontWeight: 600 }}>Mission Control</span>
        <div style={{ flex: 1 }} />
        <button
          className="mini-btn"
          title="Refresh"
          onClick={() => loadMissions()}
          style={{ opacity: busy ? 0.5 : 1 }}
        >
          <RefreshCw size={13} className={busy ? 'spin' : ''} />
        </button>
      </div>

      {/* new mission composer */}
      <div style={{ padding: '0 10px 8px' }}>
        <textarea
          placeholder="Describe your mission… e.g. ‘Add dark mode toggle to settings’"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              handleStart()
            }
          }}
          style={textareaStyle}
          rows={3}
        />
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 }}>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 11,
              color: 'var(--text-dim)',
              cursor: 'pointer',
              flex: 1,
            }}
            title="Include the active file as context"
          >
            <input
              type="checkbox"
              checked={attachActive}
              onChange={(e) => setAttachActive(e.target.checked)}
              style={{ accentColor: 'var(--blue)' }}
            />
            {activeTab ? (
              <span
                style={{
                  maxWidth: 140,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                <FileCode2 size={11} style={{ verticalAlign: '-1px' }} /> {activeTab.name}
              </span>
            ) : (
              'No active file'
            )}
          </label>
          <button
            className="primary-btn"
            style={startBtnStyle}
            onClick={handleStart}
            disabled={busy || !goal.trim()}
          >
            {busy ? <Loader2 size={13} className="spin" /> : <Rocket size={13} />}
            <span style={{ marginLeft: 4 }}>Launch</span>
          </button>
        </div>
        {demo && (
          <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 6 }}>
            Demo mode: uses heuristic planning. Configure an AI provider in Settings for LLM planning.
          </div>
        )}
      </div>

      {/* mission list / detail */}
      <div style={{ flex: 1, overflow: 'auto', padding: '0 6px 10px' }}>
        {missions.length === 0 ? (
          <div style={emptyStyle}>
            <Target size={28} style={{ opacity: 0.3, marginBottom: 8 }} />
            <div style={{ color: 'var(--text-dim)' }}>No missions yet.</div>
            <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
              Launch a mission above to plan and verify multi-step changes.
            </div>
          </div>
        ) : (
          missions.map((m) => {
            const expanded = activeMission?.id === m.id
            return (
              <div key={m.id} style={missionCardStyle(expanded)}>
                <div
                  style={{ display: 'flex', alignItems: 'flex-start', gap: 6, cursor: 'pointer' }}
                  onClick={() => setActiveMission(expanded ? null : m)}
                >
                  <ChevronRight
                    size={14}
                    style={{
                      marginTop: 2,
                      transition: 'transform 0.15s',
                      transform: expanded ? 'rotate(90deg)' : 'none',
                      color: 'var(--text-dim)',
                      flexShrink: 0,
                    }}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 500, lineHeight: 1.3 }}>{m.goal}</div>
                    <div
                      style={{
                        display: 'flex',
                        gap: 8,
                        fontSize: 10,
                        color: 'var(--text-dim)',
                        marginTop: 3,
                        alignItems: 'center',
                      }}
                    >
                      <span
                        style={{
                          ...badgeStyle,
                          color: STATUS_COLOR[m.status] ?? 'var(--text-dim)',
                          borderColor: STATUS_COLOR[m.status] ?? 'var(--border)',
                        }}
                      >
                        {PHASE_LABEL[m.phase] ?? m.phase}
                      </span>
                      <span>{m.steps.filter((s) => s.status === 'done').length}/{m.steps.length} steps</span>
                    </div>
                  </div>
                </div>

                {expanded && (
                  <div style={{ marginTop: 8, paddingLeft: 4 }}>
                    {/* summary */}
                    {m.summary && (
                      <div
                        style={{
                          fontSize: 11,
                          color: 'var(--text-dim)',
                          background: 'color-mix(in srgb, var(--blue) 8%, transparent)',
                          border: '1px solid var(--border)',
                          borderRadius: 6,
                          padding: '6px 8px',
                          marginBottom: 8,
                          lineHeight: 1.4,
                        }}
                      >
                        {m.summary}
                      </div>
                    )}

                    {/* context files */}
                    {m.contextFiles.length > 0 && (
                      <div style={{ marginBottom: 8 }}>
                        <div style={labelStyle}>Context</div>
                        {m.contextFiles.map((f) => (
                          <button
                            key={f}
                            className="mini-btn"
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 4,
                              fontSize: 11,
                              padding: '2px 6px',
                              marginBottom: 2,
                              maxWidth: '100%',
                            }}
                            onClick={() => openFile(f)}
                            title={`Open ${f}`}
                          >
                            <FileCode2 size={11} />
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {f}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}

                    {/* steps */}
                    <div style={labelStyle}>Plan</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: 10 }}>
                      {m.steps.map((step) => (
                        <div
                          key={step.id}
                          style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: 6,
                            padding: '3px 4px',
                            borderRadius: 4,
                            fontSize: 11,
                            lineHeight: 1.35,
                          }}
                        >
                          <span style={{ marginTop: 1, flexShrink: 0 }}>
                            <StepIcon status={step.status} />
                          </span>
                          <span style={{ flex: 1, color: step.status === 'skipped' ? 'var(--text-dim)' : 'var(--text)' }}>
                            {step.description}
                            {step.note && (step.status === 'error' || step.status === 'skipped') && (
                              <div
                                style={{
                                  marginTop: 3,
                                  fontFamily: 'var(--font-mono, monospace)',
                                  fontSize: 10,
                                  color: step.status === 'error' ? 'var(--red, #f07178)' : 'var(--text-dim)',
                                  whiteSpace: 'pre-wrap',
                                  background: 'var(--bg-elev, rgba(255,255,255,0.03))',
                                  padding: '4px 6px',
                                  borderRadius: 3,
                                  border: '1px solid var(--border)',
                                }}
                              >
                                {step.note}
                              </div>
                            )}
                          </span>
                          {/* quick controls */}
                          {step.status !== 'done' && (
                            <div style={{ display: 'flex', gap: 2 }}>
                              {step.status !== 'running' && (
                                <button
                                  className="mini-btn"
                                  title="Mark running"
                                  style={{ width: 18, height: 18 }}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    advanceStep(m, step, 'running')
                                  }}
                                >
                                  <Play size={9} />
                                </button>
                              )}
                              <button
                                className="mini-btn"
                                title="Mark done"
                                style={{ width: 18, height: 18 }}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  advanceStep(m, step, 'done')
                                }}
                              >
                                <CheckCircle2 size={11} />
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* outcomes */}
                    {m.outcomes.length > 0 && (
                      <>
                        <div style={labelStyle}>Outcomes</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 10 }}>
                          {m.outcomes.map((o, i) => {
                            const Icon = outcomeKindIcon(o.kind)
                            return (
                              <div
                                key={i}
                                style={{
                                  display: 'flex',
                                  alignItems: 'flex-start',
                                  gap: 6,
                                  fontSize: 11,
                                  padding: '4px 6px',
                                  background: 'var(--bg-elev, rgba(255,255,255,0.03))',
                                  borderRadius: 4,
                                  border: '1px solid var(--border)',
                                }}
                              >
                                <Icon size={12} style={{ marginTop: 1, opacity: 0.7, flexShrink: 0 }} />
                                <div style={{ flex: 1 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                    <OutcomeIcon o={o} />
                                    <span>{o.label}</span>
                                  </div>
                                  {o.actual && (
                                    <div
                                      style={{
                                        marginTop: 3,
                                        fontFamily: 'var(--font-mono, monospace)',
                                        fontSize: 10,
                                        color: o.passed ? 'var(--green)' : 'var(--text-dim)',
                                        whiteSpace: 'pre-wrap',
                                      }}
                                    >
                                      {o.actual}
                                    </div>
                                  )}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </>
                    )}

                    {/* controls */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                      {m.steps.some((s) => s.status === 'pending') && m.status !== 'cancelled' && (
                        <button
                          className="mini-btn"
                          style={{ ...ctrlBtnStyle, background: 'var(--blue)', color: '#fff' }}
                          onClick={() => executeMission(m.id)}
                          disabled={busy}
                          title="Auto-execute all pending steps"
                        >
                          <Rocket size={12} /> Execute
                        </button>
                      )}
                      {m.outcomes.length > 0 && (
                        <button
                          className="mini-btn"
                          style={ctrlBtnStyle}
                          onClick={() => verifyMission(m.id)}
                          disabled={busy}
                          title="Run build/tests/lint to verify outcomes"
                        >
                          <Beaker size={12} /> Verify
                        </button>
                      )}
                      {m.status === 'running' && (
                        <button
                          className="mini-btn"
                          style={ctrlBtnStyle}
                          onClick={() => patchMission(m.id, { status: 'paused' })}
                        >
                          <Pause size={12} /> Pause
                        </button>
                      )}
                      {m.status === 'paused' && (
                        <button
                          className="mini-btn"
                          style={ctrlBtnStyle}
                          onClick={() => patchMission(m.id, { status: 'running' })}
                        >
                          <Play size={12} /> Resume
                        </button>
                      )}
                      {m.status !== 'cancelled' && m.status !== 'done' && (
                        <button
                          className="mini-btn"
                          style={ctrlBtnStyle}
                          onClick={() => patchMission(m.id, { status: 'cancelled' })}
                        >
                          <Square size={12} /> Cancel
                        </button>
                      )}
                      <div style={{ flex: 1 }} />
                      <button
                        className="mini-btn"
                        style={{ ...ctrlBtnStyle, color: 'var(--red, #f07178)' }}
                        onClick={() => removeMission(m.id)}
                        title="Delete mission"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

// ---------- styles ----------
const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '10px 12px',
  borderBottom: '1px solid var(--border)',
  fontSize: 12,
  flexShrink: 0,
}

const textareaStyle: React.CSSProperties = {
  width: '100%',
  resize: 'vertical',
  background: 'var(--bg-input, rgba(0,0,0,0.2))',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '7px 9px',
  fontSize: 12,
  color: 'var(--text)',
  fontFamily: 'inherit',
  outline: 'none',
}

const startBtnStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  padding: '4px 10px',
  fontSize: 11,
  fontWeight: 500,
  borderRadius: 5,
  border: 'none',
  cursor: 'pointer',
}

const emptyStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  textAlign: 'center',
  padding: '40px 20px',
  fontSize: 12,
}

const labelStyle: React.CSSProperties = {
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  color: 'var(--text-dim)',
  marginBottom: 4,
  fontWeight: 600,
}

const badgeStyle: React.CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 10,
  padding: '1px 7px',
  fontSize: 9,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  fontWeight: 600,
}

const ctrlBtnStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 11,
  padding: '5px 12px',
  borderRadius: 5,
  width: 'auto',
  height: 'auto',
  whiteSpace: 'nowrap',
}

const missionCardStyle = (expanded: boolean): React.CSSProperties => ({
  padding: '8px 10px',
  marginBottom: 4,
  borderRadius: 7,
  border: `1px solid ${expanded ? 'color-mix(in srgb, var(--blue) 35%, var(--border))' : 'var(--border)'}`,
  background: expanded ? 'color-mix(in srgb, var(--blue) 6%, var(--bg))' : 'var(--bg)',
})