import { useEffect, useState } from 'react'
import {
  X, FileCode, GitBranch, AlertCircle, FlaskConical, Plug, Network,
  ArrowDownToLine, ArrowUpFromLine, ExternalLink,
} from 'lucide-react'
import { useGraph } from './useGraph'
import { useCodebaseHealth } from './useCodebaseHealth'
import { subsystemFor } from './subsystems'

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
}

interface Commit {
  hash: string
  short: string
  message: string
  author: string
  date: string
}

export default function NodeDetailsPanel({ nodeId, onClose, onOpenInEditor }: Props) {
  const { graph } = useGraph()
  const { byPath } = useCodebaseHealth()
  const [commits, setCommits] = useState<Commit[]>([])
  const [commitsLoading, setCommitsLoading] = useState(false)

  // Fetch commits whenever the focused node changes.
  useEffect(() => {
    if (!nodeId) { setCommits([]); return }
    let cancelled = false
    setCommitsLoading(true)
    fetch(`/api/git/file-log?path=${encodeURIComponent(nodeId)}&limit=5`)
      .then((r) => (r.ok ? r.json() : { commits: [] }))
      .then((d: { commits: Commit[] }) => { if (!cancelled) setCommits(d.commits ?? []) })
      .catch(() => { if (!cancelled) setCommits([]) })
      .finally(() => { if (!cancelled) setCommitsLoading(false) })
    return () => { cancelled = true }
  }, [nodeId])

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
          className="cn-open-editor-btn"
          onClick={() => onOpenInEditor(nodeId)}
        >
          <ExternalLink size={13} />
          <span>View full file in editor</span>
          <span style={kbdHintStyle}>dbl-click</span>
        </button>
      </footer>
    </aside>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={sectionStyle}>
      <h4 style={sectionTitleStyle}>{title}</h4>
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
