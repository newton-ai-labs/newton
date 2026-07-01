import { useEffect, useState } from 'react'
import {
  X, FileCode, GitBranch, AlertCircle, FlaskConical, Plug, Network,
  ArrowDownToLine, ArrowUpFromLine, ExternalLink, Sparkles, Rocket,
  Wand2, BookOpen, Gauge, ShieldCheck, Wrench, Eye, Loader2,
} from 'lucide-react'
import { useGraph } from './useGraph'
import { useCodebaseHealth } from './useCodebaseHealth'
import { subsystemFor } from './subsystems'
import { useStore } from '../../store'
import { providerConfig } from '../../store'

/**
 * Right-side detail drawer for a focused node.
 *
 * Opens on single-click of a constellation node. Shows:
 *   - File metadata (path, language, lines of code)
 *   - Impact metrics derived from the import graph (direct deps,
 *     called by, tests that import this file, server endpoints among
 *     callers)
 *   - Health flags (errors/warnings/dirty) from useCodebaseHealth
 *   - Recent commits touching the file (git log -- <path>)
 *   - "View full file in editor" button → triggers the existing
 *     zoom-into-Monaco flow
 *
 * Inspired by the Impact Report pattern but adapted to the node graph —
 * no rectangular containers, just rich detail for the focused circle.
 */

interface Props {
  nodeId: string | null
  onClose: () => void
  /** Open the editor on this file (the existing zoom-into-Monaco flow). */
  onOpenInEditor: (nodeId: string) => void
  /** Open the full Impact Report for this file. */
  onOpenReport: (nodeId: string) => void
}

interface Commit {
  hash: string
  short: string
  message: string
  author: string
  date: string
}

interface Suggestion {
  title: string
  reason: string
  kind: 'test' | 'refactor' | 'docs' | 'perf' | 'security' | 'cleanup' | 'review'
}

interface FileStats {
  totalCommits: number
  last7Days: number
  last30Days: number
  last90Days: number
  daysSinceLastTouch: number | null
  distinctAuthors: number
}

// Server now owns the real cache (sha1 of path + content + model, persisted
// to .newton-cache/suggestions.json). The client just always fetches and
// trusts the server's `cached: true|false` response — no stale-cache bugs
// when files change between opens.

export default function NodeDetailsPanel({ nodeId, onClose, onOpenInEditor, onOpenReport }: Props) {
  const { graph } = useGraph()
  const { byPath } = useCodebaseHealth()
  const settings = useStore((s) => s.settings)
  const startMission = useStore((s) => s.startMission)
  const executeMission = useStore((s) => s.executeMission)
  const [commits, setCommits] = useState<Commit[]>([])
  const [commitsLoading, setCommitsLoading] = useState(false)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [suggestionsLoading, setSuggestionsLoading] = useState(false)
  const [suggestionsError, setSuggestionsError] = useState<string | null>(null)
  const [suggestionsCached, setSuggestionsCached] = useState(false)
  const [stats, setStats] = useState<FileStats | null>(null)

  // Fetch commits + per-file stats whenever the focused node changes.
  useEffect(() => {
    if (!nodeId) { setCommits([]); setStats(null); return }
    let cancelled = false
    setCommitsLoading(true)
    fetch(`/api/git/file-log?path=${encodeURIComponent(nodeId)}&limit=5`)
      .then((r) => (r.ok ? r.json() : { commits: [] }))
      .then((d: { commits: Commit[] }) => { if (!cancelled) setCommits(d.commits ?? []) })
      .catch(() => { if (!cancelled) setCommits([]) })
      .finally(() => { if (!cancelled) setCommitsLoading(false) })
    // Stats fetch is silent — null state hides the section if unavailable.
    fetch(`/api/git/file-stats?path=${encodeURIComponent(nodeId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: FileStats | null) => { if (!cancelled) setStats(d) })
      .catch(() => { if (!cancelled) setStats(null) })
    return () => { cancelled = true }
  }, [nodeId])

  // Fetch suggestions whenever the focused node changes. Server has its
  // own content-hash cache, so this is effectively free after the first
  // request for a given (file content + model). We always fetch so we
  // never serve stale results after a file changes.
  useEffect(() => {
    if (!nodeId) { setSuggestions([]); setSuggestionsError(null); return }
    let cancelled = false
    setSuggestionsLoading(true)
    setSuggestionsError(null)
    fetch('/api/node/suggestions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: nodeId, provider: providerConfig(settings) }),
    })
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({ error: `HTTP ${r.status}` }))
          throw new Error(body?.error ?? `HTTP ${r.status}`)
        }
        return r.json() as Promise<{ suggestions: Suggestion[]; cached?: boolean }>
      })
      .then((d) => {
        if (cancelled) return
        setSuggestions(d.suggestions ?? [])
        setSuggestionsCached(!!d.cached)
      })
      .catch((e) => { if (!cancelled) setSuggestionsError((e as Error).message) })
      .finally(() => { if (!cancelled) setSuggestionsLoading(false) })
    return () => { cancelled = true }
  }, [nodeId, settings])

  const runSuggestion = async (s: Suggestion) => {
    if (!nodeId) return
    const m = await startMission(s.title, [nodeId])
    if (m && m.status !== 'failed') {
      executeMission(m.id).catch(() => { /* surfaced via session panel */ })
      onClose()  // dismiss the drawer so the user can watch the mission card
    }
  }

  // Esc closes (in addition to whatever the parent wires up). Scoped so
  // it doesn't fight the editor or palette keybindings.
  useEffect(() => {
    if (!nodeId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [nodeId, onClose])

  if (!nodeId || !graph) return null
  const node = graph.nodes[nodeId]
  if (!node) return null

  const sub = subsystemFor(node.path)
  const health = byPath.get(nodeId)
  const inbound = graph.reverseEdges?.[nodeId] ?? []
  // Count subsets of inbound for richer impact metrics.
  const testCallers = inbound.filter((p) => /^tests\/|\.test\.|\.spec\./.test(p)).length
  const endpointCallers = inbound.filter((p) => /^server\//.test(p)).length
  const directDeps = node.imports.length

  return (
    <aside className="cn-detail-panel">
      <header style={headerStyle}>
        <FileCode size={16} style={{ color: sub.color, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={titleStyle} title={node.path.split('/').pop()}>{node.path.split('/').pop()}</div>
          <div style={pathStyle} title={node.path}>{node.path}</div>
        </div>
        <button
          type="button"
          className="ct-icon-btn"
          onClick={onClose}
          title="Close (Esc)"
          aria-label="Close details"
        >
          <X size={14} />
        </button>
      </header>

      <div style={bodyStyle}>
        {/* Subsystem badge + health summary chips */}
        <div style={chipRowStyle}>
          <span style={{ ...chipStyle, background: 'color-mix(in srgb, ' + sub.color + ' 14%, transparent)', color: sub.color }}>
            {sub.label}
          </span>
          {health?.errors ? (
            <span style={{ ...chipStyle, background: 'color-mix(in srgb, var(--red) 18%, transparent)', color: 'var(--red)' }}>
              <AlertCircle size={11} style={{ verticalAlign: '-1px' }} /> {health.errors} error{health.errors === 1 ? '' : 's'}
            </span>
          ) : null}
          {health?.warnings ? (
            <span style={{ ...chipStyle, background: 'color-mix(in srgb, var(--yellow) 18%, transparent)', color: 'var(--yellow)' }}>
              {health.warnings} warning{health.warnings === 1 ? '' : 's'}
            </span>
          ) : null}
          {health?.gitStatus ? (
            <span style={{ ...chipStyle, background: 'color-mix(in srgb, var(--yellow) 12%, transparent)', color: 'var(--text-dim)' }}>
              <GitBranch size={11} style={{ verticalAlign: '-1px' }} /> {gitStatusLabel(health.gitStatus)}
            </span>
          ) : null}
        </div>

        {/* Metadata */}
        <Section title="Metadata">
          <DLRow label="Path" value={node.path} mono />
          <DLRow label="Language" value={languageFromExt(node.path)} />
          <DLRow label="Lines" value={node.lineCount?.toString() ?? '—'} />
        </Section>

        {/* Impact — derived from import graph */}
        <Section title="Impact">
          <ImpactRow icon={ArrowDownToLine} label="Direct dependencies" value={directDeps} color="var(--accent-2)" />
          <ImpactRow icon={ArrowUpFromLine} label="Called by" value={inbound.length} color="var(--accent)" />
          <ImpactRow icon={FlaskConical} label="Tests impacted" value={testCallers} color="var(--green)" hide={testCallers === 0} />
          <ImpactRow icon={Plug} label="Endpoints touched" value={endpointCallers} color="var(--blue)" hide={endpointCallers === 0} />
          <ImpactRow icon={Network} label="Total blast radius" value={inbound.length + directDeps} color="var(--text-dim)" />
        </Section>

        {/* Quality & Risk — composite signals from graph + health + git
            stats. Heuristic, not authoritative, but actionable. */}
        {(() => {
          const r = computeRisk({
            loc: node.lineCount ?? 0,
            callers: inbound.length,
            deps: directDeps,
            errors: health?.errors ?? 0,
            warnings: health?.warnings ?? 0,
            dirty: !!health?.gitStatus,
            stats,
          })
          return (
            <Section title="Quality & risk">
              <div style={riskRowStyle}>
                <span style={dlLabelStyle}>Risk score</span>
                <div style={{ flex: 1, marginLeft: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{
                    flex: 1, height: 6, borderRadius: 4, background: 'var(--panel-2)',
                    overflow: 'hidden', position: 'relative',
                  }}>
                    <div style={{
                      width: `${r.score}%`, height: '100%', borderRadius: 4,
                      background: r.color, transition: 'width 0.3s ease, background 0.3s ease',
                    }} />
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 500, color: r.color, minWidth: 38, textAlign: 'right' }}>
                    {r.score}/100
                  </span>
                </div>
              </div>
              <DLRow label="Stance" value={r.label} />
              {stats && (
                <>
                  <DLRow label="Change frequency" value={freqLabel(stats.last30Days)} />
                  <DLRow label="Commits (30d)" value={String(stats.last30Days)} />
                  <DLRow label="Total commits" value={String(stats.totalCommits)} />
                  {stats.daysSinceLastTouch !== null && (
                    <DLRow label="Last touched" value={daysAgo(stats.daysSinceLastTouch)} />
                  )}
                  <DLRow label="Authors" value={String(stats.distinctAuthors)} />
                </>
              )}
            </Section>
          )
        })()}

        {/* AI-suggested actions for this file. Click a row to run it as a
            mission (focuses this file as context, auto-executes).
            The state pill always shows whether this response came from
            the server-side cache, so users can always see what's happening
            (rather than only seeing the badge when cached). */}
        <Section
          title="Suggested actions"
          badge={
            !suggestionsLoading && suggestions.length > 0 ? (
              suggestionsCached ? (
                <span
                  style={cachedBadgeStyle}
                  title="Served from the server-side cache — no LLM call this time"
                >
                  ✓ cached
                </span>
              ) : (
                <span
                  style={freshBadgeStyle}
                  title="Fresh LLM call (file content or model changed since last cache hit)"
                >
                  ↗ fresh
                </span>
              )
            ) : null
          }
        >
          {suggestionsLoading && (
            <div style={loadingStyle}>
              <Loader2 size={12} className="cn-spin" style={{ verticalAlign: '-2px', marginRight: 6 }} />
              Analyzing {nodeId.split('/').pop()}…
            </div>
          )}
          {!suggestionsLoading && suggestionsError && (
            <div style={emptyStyle}>{suggestionsError}</div>
          )}
          {!suggestionsLoading && !suggestionsError && suggestions.length === 0 && (
            <div style={emptyStyle}>No suggestions.</div>
          )}
          {!suggestionsLoading && suggestions.map((s, i) => {
            const Icon = iconForKind(s.kind)
            const color = colorForKind(s.kind)
            return (
              <button
                key={i}
                type="button"
                className="cn-suggestion"
                onClick={() => void runSuggestion(s)}
                title={`Run "${s.title}" as a mission`}
              >
                <Icon size={13} style={{ color, flexShrink: 0, marginTop: 2 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={suggestionTitleStyle}>{s.title}</div>
                  {s.reason && <div style={suggestionReasonStyle}>{s.reason}</div>}
                </div>
                <Rocket size={12} className="cn-suggestion-go" />
              </button>
            )
          })}
        </Section>

        {/* Recent commits */}
        <Section title="Recent commits">
          {commitsLoading && (
            <div style={loadingStyle}>Loading…</div>
          )}
          {!commitsLoading && commits.length === 0 && (
            <div style={emptyStyle}>No commits found for this file.</div>
          )}
          {!commitsLoading && commits.map((c) => (
            <div key={c.hash} style={commitRowStyle}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
                <code style={shortHashStyle}>{c.short}</code>
                <span style={commitMsgStyle} title={c.message}>{c.message}</span>
              </div>
              <div style={commitMetaStyle}>
                <span>{c.author}</span>
                <span style={{ color: 'var(--text-faint)' }}>·</span>
                <span>{c.date}</span>
              </div>
            </div>
          ))}
        </Section>
      </div>

      <footer style={footerStyle}>
        <button
          type="button"
          className="cn-open-report-btn"
          onClick={() => onOpenReport(nodeId)}
        >
          <Sparkles size={13} />
          <span>Open full Impact Report</span>
        </button>
        <button
          type="button"
          className="cn-open-editor-btn"
          onClick={() => onOpenInEditor(nodeId)}
          style={{ marginTop: 8 }}
        >
          <ExternalLink size={13} />
          <span>View full file in editor</span>
          <span style={kbdHintStyle}>dbl-click</span>
        </button>
      </footer>
    </aside>
  )
}

function Section({ title, badge, children }: { title: string; badge?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section style={sectionStyle}>
      <h4 style={sectionTitleStyle}>
        <span>{title}</span>
        {badge && <span style={{ marginLeft: 'auto' }}>{badge}</span>}
      </h4>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{children}</div>
    </section>
  )
}

function DLRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={dlRowStyle}>
      <span style={dlLabelStyle}>{label}</span>
      <span style={{
        ...dlValueStyle,
        fontFamily: mono ? 'var(--font-mono, ui-monospace, monospace)' : 'inherit',
        fontSize: mono ? 11 : 12,
      }} title={value}>{value}</span>
    </div>
  )
}

function ImpactRow({
  icon: Icon, label, value, color, hide,
}: {
  icon: typeof Plug; label: string; value: number; color: string; hide?: boolean
}) {
  if (hide) return null
  return (
    <div style={impactRowStyle}>
      <Icon size={13} style={{ color, flexShrink: 0 }} />
      <span style={{ flex: 1, fontSize: 12.5, color: 'var(--text)' }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>{value}</span>
    </div>
  )
}

/**
 * Composite "risk score" out of 100. Heuristic blend of four signals:
 *   - File size           (max 25 pts)   — larger files are harder to change safely
 *   - Blast radius        (max 30 pts)   — number of callers; widely-imported files
 *                                          carry more risk per edit
 *   - Health flags        (max 25 pts)   — open errors / warnings / unstaged changes
 *   - Change frequency    (max 20 pts)   — hotspots are riskier (Pareto-like)
 *
 * Not authoritative — it's a directional tip, not a verdict. The label gives
 * the user a feel for what the score means without staring at the math.
 */
function computeRisk(input: {
  loc: number; callers: number; deps: number
  errors: number; warnings: number; dirty: boolean
  stats: FileStats | null
}): { score: number; label: string; color: string } {
  const sizePts    = Math.min(25, (input.loc / 500) * 25)
  const blastPts   = Math.min(30, (input.callers / 10) * 30)
  const healthPts  = Math.min(25, input.errors * 8 + input.warnings * 2 + (input.dirty ? 5 : 0))
  const freqPts    = Math.min(20, ((input.stats?.last30Days ?? 0) / 10) * 20)
  const score = Math.round(sizePts + blastPts + healthPts + freqPts)
  let label: string
  let color: string
  if (score < 25)       { label = 'Quiet';     color = 'var(--green)' }
  else if (score < 50)  { label = 'Active';    color = 'var(--blue)' }
  else if (score < 75)  { label = 'Hot spot';  color = 'var(--yellow)' }
  else                  { label = 'High risk'; color = 'var(--red)' }
  return { score, label, color }
}

function freqLabel(commits30d: number): string {
  if (commits30d === 0) return 'Untouched (30d)'
  if (commits30d <= 2)  return 'Low'
  if (commits30d <= 6)  return 'Moderate'
  if (commits30d <= 15) return 'High'
  return 'Very high'
}

function daysAgo(days: number): string {
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30)  return `${days}d ago`
  if (days < 365) return `${Math.round(days / 30)}mo ago`
  return `${Math.round(days / 365)}y ago`
}

function iconForKind(k: Suggestion['kind']) {
  switch (k) {
    case 'test':     return FlaskConical
    case 'refactor': return Wand2
    case 'docs':     return BookOpen
    case 'perf':     return Gauge
    case 'security': return ShieldCheck
    case 'cleanup':  return Wrench
    case 'review':
    default:         return Eye
  }
}
function colorForKind(k: Suggestion['kind']): string {
  switch (k) {
    case 'test':     return 'var(--green)'
    case 'refactor': return 'var(--accent)'
    case 'docs':     return 'var(--blue)'
    case 'perf':     return 'var(--yellow)'
    case 'security': return 'var(--red)'
    case 'cleanup':  return 'var(--text-dim)'
    case 'review':
    default:         return 'var(--accent-2)'
  }
}

function languageFromExt(p: string): string {
  const ext = p.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    ts: 'TypeScript', tsx: 'TypeScript', js: 'JavaScript', jsx: 'JavaScript',
    py: 'Python', go: 'Go', rs: 'Rust', rb: 'Ruby', php: 'PHP',
    java: 'Java', kt: 'Kotlin', c: 'C', cpp: 'C++', cs: 'C#',
    json: 'JSON', md: 'Markdown', html: 'HTML', css: 'CSS', scss: 'SCSS',
    yaml: 'YAML', yml: 'YAML', toml: 'TOML', sh: 'Shell',
  }
  return map[ext] ?? ext.toUpperCase() ?? '—'
}

function gitStatusLabel(s: string): string {
  switch (s) {
    case 'M': return 'modified'
    case 'A': return 'added'
    case 'D': return 'deleted'
    case 'R': return 'renamed'
    case '?': case 'U': return 'untracked'
    default: return s
  }
}

// ----- styles -----
const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 10,
  padding: '14px 14px 10px',
  borderBottom: '0.5px solid var(--border-soft)',
  flexShrink: 0,
}
const titleStyle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 500,
  color: 'var(--text)',
  fontFamily: 'var(--font-mono, ui-monospace, monospace)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}
const pathStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--text-dim)',
  marginTop: 2,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}
const bodyStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  padding: '8px 14px',
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
}
const chipRowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 5,
}
const chipStyle: React.CSSProperties = {
  fontSize: 10.5,
  fontWeight: 500,
  padding: '3px 8px',
  borderRadius: 999,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
}
const sectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
}
const sectionTitleStyle: React.CSSProperties = {
  fontSize: 10.5,
  textTransform: 'uppercase',
  letterSpacing: 0.6,
  color: 'var(--text-faint)',
  margin: 0,
  fontWeight: 600,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
}
const cachedBadgeStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 3,
  fontSize: 9.5,
  fontWeight: 500,
  letterSpacing: 0.3,
  padding: '1px 6px',
  borderRadius: 999,
  background: 'color-mix(in srgb, var(--green) 14%, transparent)',
  color: 'var(--green)',
  textTransform: 'none',
}
const freshBadgeStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 3,
  fontSize: 9.5,
  fontWeight: 500,
  letterSpacing: 0.3,
  padding: '1px 6px',
  borderRadius: 999,
  background: 'color-mix(in srgb, var(--accent-2) 14%, transparent)',
  color: 'var(--accent-2)',
  textTransform: 'none',
}
const dlRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 8,
  padding: '4px 0',
  borderBottom: '0.5px solid var(--border-soft)',
}
const dlLabelStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--text-dim)',
  flexShrink: 0,
  minWidth: 72,
}
const dlValueStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--text)',
  textAlign: 'right',
  flex: 1,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}
const impactRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '5px 0',
}
const commitRowStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
  padding: '6px 0',
  borderBottom: '0.5px solid var(--border-soft)',
}
const shortHashStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono, ui-monospace, monospace)',
  fontSize: 10.5,
  padding: '1px 5px',
  borderRadius: 3,
  background: 'var(--panel-2)',
  color: 'var(--text-dim)',
  flexShrink: 0,
}
const commitMsgStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--text)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  flex: 1,
}
const commitMetaStyle: React.CSSProperties = {
  fontSize: 10.5,
  color: 'var(--text-faint)',
  display: 'flex',
  gap: 5,
}
const loadingStyle: React.CSSProperties = {
  fontSize: 11.5, color: 'var(--text-dim)', padding: '8px 0',
}
const emptyStyle: React.CSSProperties = {
  fontSize: 11.5, color: 'var(--text-faint)', padding: '8px 0',
}
const suggestionTitleStyle: React.CSSProperties = {
  fontSize: 12.5,
  color: 'var(--text)',
  lineHeight: 1.35,
  fontWeight: 500,
}
const suggestionReasonStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--text-dim)',
  lineHeight: 1.4,
  marginTop: 2,
}
const riskRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  padding: '4px 0',
  borderBottom: '0.5px solid var(--border-soft)',
}
const footerStyle: React.CSSProperties = {
  padding: 12,
  borderTop: '0.5px solid var(--border-soft)',
  flexShrink: 0,
}
const kbdHintStyle: React.CSSProperties = {
  marginLeft: 'auto',
  fontSize: 10,
  color: 'var(--text-faint)',
  fontFamily: 'var(--font-mono, ui-monospace, monospace)',
}
