import { useState } from 'react'
import {
  Bot,
  Play,
  Check,
  X,
  Loader2,
  FilePlus,
  FileEdit,
  Trash2,
  Eye,
  ChevronDown,
  ChevronRight,
  Sparkles,
  ShieldAlert,
  ShieldCheck,
  Zap,
} from 'lucide-react'
import { useStore } from '../store'
import type { AgentPlan, AgentStep, ConsequenceReport } from '../../shared/types'

const API = import.meta.env.VITE_API_BASE || ''

export default function AgentPanel() {
  const settings = useStore((s) => s.settings)
  const openFile = useStore((s) => s.openFile)
  const refreshFileTree = useStore((s) => s.refreshTree)
  const tabs = useStore((s) => s.tabs)

  const [task, setTask] = useState('')
  const [plan, setPlan] = useState<AgentPlan | null>(null)
  const [planning, setPlanning] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // RecourseOS: consequence assessment
  const [consequence, setConsequence] = useState<ConsequenceReport | null>(null)
  const [assessing, setAssessing] = useState(false)
  const [approved, setApproved] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const requiresConfirm = consequence?.overallRisk === 'critical' || !!consequence?.hasIrreversible
  const canRun = !consequence || !consequence.requiresApproval || approved || (requiresConfirm && confirmText.trim().toLowerCase() === 'approve')

  const providerConfig =
    settings.provider === 'demo'
      ? { provider: 'demo' as const, model: 'demo' }
      : {
          provider: settings.provider,
          model: settings.providerConfigs[settings.provider]?.model ?? 'demo',
          apiKey: settings.providerConfigs[settings.provider]?.apiKey,
          baseUrl: settings.providerConfigs[settings.provider]?.baseUrl,
        }

  async function handlePlan() {
    if (!task.trim()) return
    setPlanning(true)
    setError(null)
    setPlan(null)
    setDone(false)
    try {
      const files = tabs.map((t) => ({ path: t.path, content: t.content }))
      const r = await fetch(`${API}/api/agent/plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          task,
          provider: providerConfig,
          files,
        }),
      })
      if (!r.ok) throw new Error((await r.json()).error || 'Planning failed')
      const p: AgentPlan = await r.json()
      setPlan(p)
      setConsequence(null)
      setApproved(false)
      setConfirmText('')
      // expand all by default
      setExpanded(new Set(p.steps.map((s) => s.id)))

      // RecourseOS: assess the plan for risk before the user runs it
      if (p.steps.length > 0) {
        setAssessing(true)
        try {
          const ar = await fetch(`${API}/api/agent/assess`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ steps: p.steps }),
          })
          if (ar.ok) {
            const report: ConsequenceReport = await ar.json()
            setConsequence(report)
          }
        } catch {
          /* assessment is best-effort */
        } finally {
          setAssessing(false)
        }
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setPlanning(false)
    }
  }

  async function handleRunAll() {
    if (!plan) return
    if (consequence?.requiresApproval && !canRun) return
    setExecuting(true)
    setError(null)
    setDone(false)
    const updated: AgentStep[] = []
    for (const step of plan.steps) {
      const running: AgentStep = { ...step, status: 'running' }
      updated.push(running)
      setPlan({ ...plan, steps: [...updated] })
      try {
        const r = await fetch(`${API}/api/agent/step`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(running),
        })
        const result: AgentStep = await r.json()
        updated[updated.length - 1] = result
        setPlan({ ...plan, steps: [...updated] })
      } catch (e) {
        updated[updated.length - 1] = {
          ...running,
          status: 'error',
          note: (e as Error).message,
        }
        setPlan({ ...plan, steps: [...updated] })
        break
      }
    }
    setExecuting(false)
    setDone(true)
    refreshFileTree()
    // Open the first created/edited file
    const firstChanged = updated.find(
      (s) => s.status === 'done' && (s.action === 'create' || s.action === 'edit'),
    )
    if (firstChanged) openFile(firstChanged.path)
  }

  async function handleRunStep(stepId: string) {
    if (!plan) return
    const idx = plan.steps.findIndex((s) => s.id === stepId)
    if (idx < 0) return
    const steps = [...plan.steps]
    steps[idx] = { ...steps[idx], status: 'running' }
    setPlan({ ...plan, steps })
    try {
      const r = await fetch(`${API}/api/agent/step`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(steps[idx]),
      })
      const result: AgentStep = await r.json()
      steps[idx] = result
      setPlan({ ...plan, steps })
      if (result.status === 'done') {
        refreshFileTree()
        if (result.action === 'create' || result.action === 'edit') openFile(result.path)
      }
    } catch (e) {
      steps[idx] = { ...steps[idx], status: 'error', note: (e as Error).message }
      setPlan({ ...plan, steps })
    }
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  function reset() {
    setPlan(null)
    setTask('')
    setDone(false)
    setError(null)
  }

  return (
    <div className="agent-panel">
      <div className="agent-header">
        <Bot size={16} style={{ color: 'var(--accent)' }} />
        <span className="agent-title">Agent Mode</span>
        <span className="agent-badge">{settings.provider}</span>
      </div>

      <div className="agent-input-row">
        <textarea
          className="agent-task-input"
          placeholder="Describe a multi-file task… e.g. 'scaffold an express server' or 'create a package.json and .gitignore'"
          value={task}
          onChange={(e) => setTask(e.target.value)}
          rows={3}
          disabled={executing}
        />
        <div className="agent-actions">
          <button
            className="agent-btn primary"
            onClick={handlePlan}
            disabled={planning || executing || !task.trim()}
          >
            {planning ? <Loader2 size={13} className="spin" /> : <Sparkles size={13} />}
            Plan
          </button>
          {plan && plan.steps.length > 0 && (
            <button
              className="agent-btn success"
              onClick={handleRunAll}
              disabled={executing || done || !canRun}
            >
              {executing ? <Loader2 size={13} className="spin" /> : <Play size={13} />}
              {done ? 'Done' : 'Run All'}
            </button>
          )}
          {plan && (
            <button className="agent-btn ghost" onClick={reset} disabled={executing}>
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {error && <div className="agent-error">⚠️ {error}</div>}

      {/* RecourseOS: Consequence Engine report */}
      {(assessing || consequence) && (
        <ConsequenceBanner
          report={consequence}
          assessing={assessing}
          approved={approved}
          requiresConfirm={requiresConfirm}
          confirmText={confirmText}
          setConfirmText={setConfirmText}
          setApproved={setApproved}
        />
      )}

      {plan && (
        <div className="agent-plan">
          <div className="agent-summary">{plan.summary}</div>
          <div className="agent-steps">
            {plan.steps.map((step, i) => (
              <div key={step.id} className={`agent-step ${step.status}`}>
                <div className="agent-step-head" onClick={() => toggleExpand(step.id)}>
                  <span className="agent-step-toggle">
                    {expanded.has(step.id) ? (
                      <ChevronDown size={12} />
                    ) : (
                      <ChevronRight size={12} />
                    )}
                  </span>
                  <StepIcon action={step.action} />
                  <span className="agent-step-num">{i + 1}.</span>
                  <span className="agent-step-path">{step.path}</span>
                  <span className="agent-step-desc">{step.description}</span>
                  <span className={`agent-step-status ${step.status}`}>
                    <StatusBadge status={step.status} />
                  </span>
                  {(step.action === 'create' ||
                    step.action === 'edit' ||
                    step.action === 'delete') &&
                    step.status === 'pending' && (
                      <button
                        className="agent-step-run"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleRunStep(step.id)
                        }}
                        title="Run just this step"
                      >
                        <Play size={11} />
                      </button>
                    )}
                </div>
                {expanded.has(step.id) &&
                  (step.after !== undefined || step.before !== undefined) && (
                    <div className="agent-step-diff">
                      {step.before !== undefined && step.before !== step.after && (
                        <details>
                          <summary>before</summary>
                          <pre>{step.before.slice(0, 2000)}</pre>
                        </details>
                      )}
                      {step.after !== undefined && (
                        <details open>
                          <summary>
                            {step.action === 'edit' ? 'after' : 'content'}
                          </summary>
                          <pre>{step.after.slice(0, 2000)}</pre>
                        </details>
                      )}
                    </div>
                  )}
                {step.note && <div className="agent-step-note">{step.note}</div>}
              </div>
            ))}
          </div>
          {done && (
            <div className="agent-done">
              <Check size={14} /> Task complete. Changed files have been opened in the editor.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function StepIcon({ action }: { action: AgentStep['action'] }) {
  if (action === 'create') return <FilePlus size={13} style={{ color: '#4ade80' }} />
  if (action === 'edit') return <FileEdit size={13} style={{ color: '#60a5fa' }} />
  if (action === 'delete') return <Trash2 size={13} style={{ color: '#f87171' }} />
  return <Eye size={13} style={{ color: '#9ca3af' }} />
}

function StatusBadge({ status }: { status: AgentStep['status'] }) {
  if (status === 'done') return <Check size={12} style={{ color: '#4ade80' }} />
  if (status === 'running')
    return <Loader2 size={12} className="spin" style={{ color: 'var(--accent)' }} />
  if (status === 'error') return <X size={12} style={{ color: '#f87171' }} />
  return <span className="agent-pending-dot" />
}

function riskColor(risk?: string): string {
  switch (risk) {
    case 'critical': return '#ef4444'
    case 'high': return '#f97316'
    case 'medium': return '#eab308'
    case 'low': return '#22c55e'
    default: return '#4ade80'
  }
}

function ConsequenceBanner(props: {
  report: ConsequenceReport | null
  assessing: boolean
  approved: boolean
  requiresConfirm: boolean
  confirmText: string
  setConfirmText: (v: string) => void
  setApproved: (v: boolean) => void
}) {
  const { report, assessing, approved, requiresConfirm, confirmText, setConfirmText, setApproved } = props

  if (assessing) {
    return (
      <div className="consequence-banner assessing">
        <Loader2 size={14} className="spin" />
        <span>Analyzing risk…</span>
      </div>
    )
  }
  if (!report) return null

  const safe = report.overallRisk === 'safe' || report.overallRisk === 'low'

  return (
    <div
      className="consequence-banner"
      style={{ borderLeftColor: riskColor(report.overallRisk) }}
    >
      <div className="consequence-head">
        {safe ? (
          <ShieldCheck size={14} style={{ color: '#4ade80' }} />
        ) : (
          <ShieldAlert size={14} style={{ color: riskColor(report.overallRisk) }} />
        )}
        <span className="consequence-label" style={{ color: riskColor(report.overallRisk) }}>
          {report.overallRisk.toUpperCase()} RISK
        </span>
        <span className="consequence-summary">{report.summary}</span>
      </div>

      {report.recommendations.length > 0 && (
        <ul className="consequence-recs">
          {report.recommendations.slice(0, 4).map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}

      {report.requiresApproval && !approved && (
        <div className="consequence-gate">
          {requiresConfirm ? (
            <>
              <input
                className="consequence-confirm-input"
                placeholder='Type "approve" to confirm'
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
              />
            </>
          ) : (
            <button
              className="consequence-approve-btn"
              onClick={() => setApproved(true)}
            >
              <Zap size={12} /> Approve & enable Run All
            </button>
          )}
        </div>
      )}

      {approved && (
        <div className="consequence-approved">
          <Check size={12} /> Approved
        </div>
      )}
    </div>
  )
}
