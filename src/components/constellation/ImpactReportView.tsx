import { useEffect, useState } from 'react'
import {
  X, ExternalLink, ChevronRight, Share2, Box, Globe, FlaskConical, Database,
  AlertTriangle, ShieldAlert, ShieldCheck, ShieldQuestion, Rocket, Loader2,
  GitCommit, Code2, Sparkles,
} from 'lucide-react'
import { useGraph } from './useGraph'
import { useCodebaseHealth } from './useCodebaseHealth'
import { subsystemFor, uniqueSubsystems } from './subsystems'
import { useStore, providerConfig } from '../../store'

/**
 * Full-screen Impact Report for a single file.
 *
 * Triggered from NodeDetailsPanel's "Open full report" button. Replaces the
 * constellation canvas while open. Mirrors the Impact Report mockup:
 *   - File header + Risk Level hero
 *   - "What's impacted" tile grid (services / endpoints / tests / db / coverage)
 *   - Recommended next steps (AI suggestions, click to run as a mission)
 *   - Spoke-hub dependency graph (Called by / Depends on / Impacts / Tests)
 *   - Right rail: file details + quality dashboard + recent commits
 *
 * V1 reuses the same endpoints the drawer already calls — no new server
 * work. Endpoint / DB-table parsing + owners panel land in later steps.
 */

interface Props {
  path: string
  onClose: () => void
  onOpenInEditor: (path: string) => void
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

interface ImpactExtras {
  endpoints: Array<{ method: string; route: string; file: string; framework: string }>
  tables: Array<{ name: string; kind: string; file: string }>
}

interface Owner {
  name: string
  email: string
  commits: number
}

export default function ImpactReportView({ path, onClose, onOpenInEditor }: Props) {
  const { graph } = useGraph()
  const { byPath } = useCodebaseHealth()
  const settings = useStore((s) => s.settings)
  const startMission = useStore((s) => s.startMission)
  const executeMission = useStore((s) => s.executeMission)

  const [commits, setCommits] = useState<Commit[]>([])
  const [commitsLoading, setCommitsLoading] = useState(false)
  const [stats, setStats] = useState<FileStats | null>(null)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [suggestionsLoading, setSuggestionsLoading] = useState(false)
  const [suggestionsCached, setSuggestionsCached] = useState(false)
  const [extras, setExtras] = useState<ImpactExtras | null>(null)
  const [extrasLoading, setExtrasLoading] = useState(false)
  const [owners, setOwners] = useState<Owner[]>([])
  const [ownersTotal, setOwnersTotal] = useState(0)

  useEffect(() => {
    let cancelled = false
    setCommitsLoading(true)
    fetch(`/api/git/file-log?path=${encodeURIComponent(path)}&limit=8`)
      .then((r) => (r.ok ? r.json() : { commits: [] }))
      .then((d: { commits: Commit[] }) => { if (!cancelled) setCommits(d.commits ?? []) })
      .catch(() => { if (!cancelled) setCommits([]) })
      .finally(() => { if (!cancelled) setCommitsLoading(false) })
    fetch(`/api/git/file-stats?path=${encodeURIComponent(path)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: FileStats | null) => { if (!cancelled) setStats(d) })
      .catch(() => { if (!cancelled) setStats(null) })
    return () => { cancelled = true }
  }, [path])

  useEffect(() => {
    let cancelled = false
    setSuggestionsLoading(true)
    fetch('/api/node/suggestions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, provider: providerConfig(settings) }),
    })
      .then(async (r) => (r.ok ? r.json() : { suggestions: [], cached: false }))
      .then((d: { suggestions: Suggestion[]; cached?: boolean }) => {
        if (cancelled) return
        setSuggestions(d.suggestions ?? [])
        setSuggestionsCached(!!d.cached)
      })
      .catch(() => { if (!cancelled) { setSuggestions([]); setSuggestionsCached(false) } })
      .finally(() => { if (!cancelled) setSuggestionsLoading(false) })
    return () => { cancelled = true }
  }, [path, settings])

  useEffect(() => {
    let cancelled = false
    setExtrasLoading(true)
    fetch(`/api/file/impact?path=${encodeURIComponent(path)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: ImpactExtras | null) => { if (!cancelled) setExtras(d ? { endpoints: d.endpoints ?? [], tables: d.tables ?? [] } : null) })
      .catch(() => { if (!cancelled) setExtras(null) })
      .finally(() => { if (!cancelled) setExtrasLoading(false) })
    fetch(`/api/git/file-owners?path=${encodeURIComponent(path)}&limit=4`)
      .then((r) => (r.ok ? r.json() : { owners: [], totalCommits: 0 }))
      .then((d: { owners: Owner[]; totalCommits: number }) => {
        if (cancelled) return
        setOwners(d.owners ?? [])
        setOwnersTotal(d.totalCommits ?? 0)
      })
      .catch(() => { if (!cancelled) { setOwners([]); setOwnersTotal(0) } })
    return () => { cancelled = true }
  }, [path])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const runSuggestion = async (s: Suggestion) => {
    const m = await startMission(s.title, [path])
    if (m && m.status !== 'failed') {
      executeMission(m.id).catch(() => { /* surfaced via session panel */ })
      onClose()
    }
  }

  if (!graph) {
    return (
      <div style={shellStyle}>
        <div style={loadingShellStyle}><Loader2 size={20} className="cn-spin" /> Loading impact report…</div>
      </div>
    )
  }

  const node = graph.nodes[path]
  if (!node) {
    return (
      <div style={shellStyle}>
        <div style={loadingShellStyle}>
          File not in graph: <code>{path}</code>
          <button type="button" className="ct-pill" onClick={onClose} style={{ marginLeft: 12 }}>Close</button>
        </div>
      </div>
    )
  }

  const sub = subsystemFor(node.path)
  const health = byPath.get(path)
  const inbound = graph.reverseEdges?.[path] ?? []
  const deps = node.imports ?? []

  // Tile metrics — graph-derived counts are cheap; endpoint + DB counts
  // come from /api/file/impact (regex scan, cached server-side). Tiles
  // render "—" until that fetch resolves.
  const callers = inbound
  const tests = inbound.filter(isTestPath)
  const downstreamSubsystems = uniqueSubsystems(inbound).filter((s) => s.id !== 'tests')
  const endpointCount = extras?.endpoints.length ?? null
  const tableCount = extras?.tables.length ?? null

  const risk = computeRisk({
    loc: node.lineCount ?? 0,
    callers: callers.length,
    deps: deps.length,
    errors: health?.errors ?? 0,
    warnings: health?.warnings ?? 0,
    dirty: !!health?.gitStatus,
    stats,
  })

  const fileName = path.split('/').pop() ?? path

  return (
    <div style={shellStyle}>
      {/* Breadcrumb / top bar */}
      <header style={breadcrumbStyle}>
        <button type="button" className="ct-pill" onClick={onClose} title="Back to constellation (Esc)">
          <X size={12} />
          <span>Back</span>
        </button>
        <span style={crumbStyle}>Impact Reports</span>
        <ChevronRight size={12} style={{ color: 'var(--text-faint)' }} />
        <span style={{ ...crumbStyle, color: 'var(--text)', fontFamily: 'var(--font-mono)' }}>{path}</span>
        <span style={{ flex: 1 }} />
        <button type="button" className="ct-pill" title="Share report (coming soon)" disabled>
          <Share2 size={12} />
          <span>Share</span>
        </button>
        <button type="button" className="ct-pill" onClick={() => onOpenInEditor(path)} title="Open in editor">
          <ExternalLink size={12} />
          <span>Open in editor</span>
        </button>
      </header>

      <div style={bodyStyle}>
        {/* Main column */}
        <main style={mainColStyle}>
          {/* File header + risk hero side by side */}
          <div style={heroGridStyle}>
            <div style={fileHeaderCardStyle}>
              <div style={{ ...fileIconStyle, background: 'color-mix(in srgb, ' + sub.color + ' 18%, transparent)', color: sub.color }}>
                <Code2 size={20} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <h1 style={fileTitleStyle} title={path}>{path}</h1>
                  {health?.gitStatus ? (
                    <span style={changedPillStyle}>CHANGED</span>
                  ) : null}
                </div>
                <div style={fileSubtitleStyle}>
                  <span>{relativeTimeFromStats(stats)}</span>
                  <span style={{ color: 'var(--text-faint)' }}>·</span>
                  <span style={{ color: 'var(--text-dim)' }}>
                    {sub.label} · {languageFromExt(path)} · {node.lineCount} LoC
                  </span>
                </div>
              </div>
            </div>

            <div style={{ ...riskHeroStyle, borderColor: risk.color, background: `color-mix(in srgb, ${risk.color} 8%, var(--panel))` }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <RiskIcon level={risk.label} color={risk.color} />
                <span style={{ fontSize: 10.5, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 600 }}>
                  Risk level
                </span>
              </div>
              <div style={{ fontSize: 26, fontWeight: 700, color: risk.color, lineHeight: 1, marginBottom: 8 }}>
                {risk.label}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5 }}>
                {risk.reason}
              </div>
            </div>
          </div>

          {/* What's impacted tile grid */}
          <section style={cardStyle}>
            <h2 style={cardTitleStyle}>What's impacted</h2>
            <div style={tileRowStyle}>
              <Tile icon={Box} count={downstreamSubsystems.length} label="Subsystems" color="var(--accent)" />
              <Tile
                icon={Globe}
                count={endpointCount ?? 0}
                label="Endpoints"
                color="var(--blue)"
                placeholder={extrasLoading ? '…' : (endpointCount === null ? '—' : undefined)}
                detail={extras?.endpoints.slice(0, 5).map((e) => `${e.method} ${e.route}`)}
              />
              <Tile icon={FlaskConical} count={tests.length} label="Tests" color="var(--green)" />
              <Tile
                icon={Database}
                count={tableCount ?? 0}
                label="Database tables"
                color="var(--accent-2)"
                placeholder={extrasLoading ? '…' : (tableCount === null ? '—' : undefined)}
                detail={extras?.tables.slice(0, 5).map((t) => t.name)}
              />
              <Tile
                icon={AlertTriangle}
                count={(health?.errors ?? 0) + (health?.warnings ?? 0)}
                label={health?.errors ? `${health.errors} critical` : 'Diagnostics'}
                color={health?.errors ? 'var(--red)' : 'var(--yellow)'}
              />
            </div>
          </section>

          {/* Recommended next steps */}
          <section style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <h2 style={{ ...cardTitleStyle, margin: 0 }}>Recommended next steps</h2>
              {!suggestionsLoading && suggestions.length > 0 && (
                <span style={suggestionsCached ? cachedBadgeStyle : freshBadgeStyle}>
                  {suggestionsCached ? '✓ cached' : '↗ fresh'}
                </span>
              )}
            </div>
            {suggestionsLoading ? (
              <div style={loadingRowStyle}>
                <Loader2 size={13} className="cn-spin" /> Analyzing {fileName}…
              </div>
            ) : suggestions.length === 0 ? (
              <div style={emptyRowStyle}>No suggested actions for this file yet.</div>
            ) : (
              <div style={stepRowStyle}>
                {suggestions.slice(0, 3).map((s, i) => (
                  <button
                    key={i}
                    type="button"
                    style={stepCardStyle}
                    onClick={() => void runSuggestion(s)}
                    title={`Run "${s.title}" as a mission`}
                  >
                    <div style={{ ...stepIconStyle, background: 'color-mix(in srgb, var(--accent) 14%, transparent)', color: 'var(--accent)' }}>
                      <Sparkles size={14} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                      <div style={stepTitleStyle}>{s.title}</div>
                      <div style={stepReasonStyle}>{s.reason || 'Recommended'}</div>
                    </div>
                    <Rocket size={13} style={{ color: 'var(--text-faint)' }} />
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* Dependency graph spoke-hub — cardinal SVG with bezier edges to
              the centered file card. Cards click through to focus that node
              in the constellation behind us. */}
          <section style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <h2 style={{ ...cardTitleStyle, margin: 0 }}>Dependency graph (direct)</h2>
              <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                {callers.length} in · {deps.length} out
              </span>
            </div>
            <SpokeHubGraph
              centerName={fileName}
              centerPath={path}
              centerSub={sub}
              callers={callers.slice(0, 3)}
              deps={deps.slice(0, 3)}
              tests={tests.slice(0, 3)}
              impacts={downstreamSubsystems.slice(0, 3)}
              onJump={(p) => {
                window.dispatchEvent(new CustomEvent('newton:focus-node', { detail: { nodeId: p } }))
                onClose()
              }}
            />
            <div style={legendRowStyle}>
              <LegendDot color="var(--accent)" label="Called by" />
              <LegendDot color="var(--green)" label="Depends on" />
              <LegendDot color="var(--yellow)" label="Impacts" />
              <LegendDot color="var(--blue)" label="Tests" />
            </div>
          </section>
        </main>

        {/* Right rail */}
        <aside style={rightRailStyle}>
          <section style={railCardStyle}>
            <h3 style={railTitleStyle}>File details</h3>
            <RailRow label="Type" value={extLabel(path)} />
            <RailRow label="Language" value={languageFromExt(path)} />
            <RailRow label="Lines of code" value={String(node.lineCount ?? 0)} />
            <RailRow label="Complexity" value={complexityFromLoc(node.lineCount ?? 0)} color={complexityColor(node.lineCount ?? 0)} />
            <RailRow label="Last modified" value={stats?.daysSinceLastTouch != null ? daysAgo(stats.daysSinceLastTouch) : '—'} />
            {owners.length > 0 && (
              <div style={{ ...railRowStyle, alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>Owners</span>
                <div style={ownersRowStyle}>
                  {owners.map((o, i) => (
                    <span
                      key={i}
                      style={{
                        ...avatarStyle,
                        background: avatarColor(o.email || o.name),
                        marginLeft: i === 0 ? 0 : -6,
                        zIndex: owners.length - i,
                      }}
                      title={`${o.name} · ${o.commits} commit${o.commits === 1 ? '' : 's'}`}
                    >
                      {initials(o.name)}
                    </span>
                  ))}
                  {ownersTotal > owners.length && (
                    <span style={{ fontSize: 11, color: 'var(--text-dim)', marginLeft: 6 }}>
                      +{ownersTotal - owners.reduce((s, o) => s + o.commits, 0)}
                    </span>
                  )}
                </div>
              </div>
            )}
          </section>

          <section style={railCardStyle}>
            <h3 style={railTitleStyle}>Quality</h3>
            <RailRow label="Risk score" value={`${risk.score} / 100`} color={risk.color} />
            <div style={{ height: 6, borderRadius: 4, background: 'var(--panel-2)', overflow: 'hidden', margin: '4px 0 10px' }}>
              <div style={{ width: `${risk.score}%`, height: '100%', background: risk.color, transition: 'width 0.3s ease' }} />
            </div>
            <RailRow label="Change frequency" value={freqLabel(stats?.last30Days ?? 0)} color={freqColor(stats?.last30Days ?? 0)} />
            <RailRow label="Commits (30d)" value={String(stats?.last30Days ?? 0)} />
            <RailRow label="Total commits" value={String(stats?.totalCommits ?? 0)} />
            <RailRow
              label="Test coverage"
              value="untracked"
              color="var(--text-faint)"
              hint="Coverage parsing isn't wired up yet"
            />
          </section>

          <section style={railCardStyle}>
            <h3 style={railTitleStyle}>Recent commits</h3>
            {commitsLoading ? (
              <div style={{ fontSize: 11, color: 'var(--text-dim)', padding: '6px 0' }}>Loading…</div>
            ) : commits.length === 0 ? (
              <div style={{ fontSize: 11, color: 'var(--text-faint)', padding: '6px 0' }}>No history.</div>
            ) : (
              commits.slice(0, 5).map((c) => (
                <div key={c.hash} style={railCommitStyle}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
                    <GitCommit size={10} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
                    <span style={railCommitMsgStyle} title={c.message}>{c.message}</span>
                  </div>
                  <div style={railCommitMetaStyle}>
                    <span>{c.author}</span>
                    <span style={{ color: 'var(--text-faint)' }}>·</span>
                    <span>{c.date}</span>
                  </div>
                </div>
              ))
            )}
          </section>
        </aside>
      </div>
    </div>
  )
}

// ---------- subcomponents ----------

function Tile({
  icon: Icon, count, label, color, placeholder, detail,
}: {
  icon: typeof Box; count: number; label: string; color: string
  placeholder?: string; detail?: string[]
}) {
  const showPlaceholder = placeholder !== undefined && (count === 0 || placeholder === '…')
  const titleAttr = detail && detail.length > 0 ? detail.join('\n') : undefined
  return (
    <div style={tileStyle} title={titleAttr}>
      <div style={{ ...tileIconStyle, background: 'color-mix(in srgb, ' + color + ' 14%, transparent)', color }}>
        <Icon size={16} />
      </div>
      <div style={{ fontSize: 24, fontWeight: 600, color: showPlaceholder ? 'var(--text-faint)' : 'var(--text)', lineHeight: 1 }}>
        {showPlaceholder ? placeholder : count}
      </div>
      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>{label}</div>
      {detail && detail.length > 0 && (
        <div style={tileDetailStyle}>
          {detail.slice(0, 3).map((d, i) => (
            <div key={i} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{d}</div>
          ))}
          {detail.length > 3 && (
            <div style={{ color: 'var(--text-faint)' }}>+{detail.length - 3} more</div>
          )}
        </div>
      )}
    </div>
  )
}

function RailRow({ label, value, color, hint }: { label: string; value: string; color?: string; hint?: string }) {
  return (
    <div style={railRowStyle} title={hint}>
      <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{label}</span>
      <span style={{ fontSize: 12, color: color ?? 'var(--text)', fontWeight: 500 }}>{value}</span>
    </div>
  )
}

function RiskIcon({ level, color }: { level: string; color: string }) {
  const Icon = level === 'High risk' ? ShieldAlert
    : level === 'Hot spot' ? AlertTriangle
    : level === 'Quiet' ? ShieldCheck
    : ShieldQuestion
  return <Icon size={18} style={{ color }} />
}

interface SpokeItem {
  label: string
  path?: string
  sublabel?: string
}

function SpokeHubGraph({
  centerName, centerPath, centerSub,
  callers, deps, tests, impacts, onJump,
}: {
  centerName: string
  centerPath: string
  centerSub: { color: string; label: string }
  callers: string[]
  deps: string[]
  tests: string[]
  impacts: Array<{ label: string; color: string; id: string }>
  onJump: (path: string) => void
}) {
  // Viewport box — SVG scales to container width via preserveAspectRatio.
  const W = 760, H = 360
  const CX = W / 2, CY = H / 2
  const CW = 200, CH = 56  // center card

  // Peripheral card geometry.
  const cardW = 150, cardH = 40

  // Map raw paths to spoke items with a label / sublabel split.
  const toItems = (paths: string[]): SpokeItem[] => paths.map((p) => ({
    label: p.split('/').pop() ?? p,
    sublabel: p.split('/').slice(-3, -1).join('/') || undefined,
    path: p,
  }))
  const callerItems  = toItems(callers)
  const depItems     = toItems(deps)
  const testItems    = toItems(tests)
  const impactItems: SpokeItem[] = impacts.map((s) => ({ label: s.label, sublabel: 'subsystem' }))

  // Position cards along each cardinal direction. Cards are evenly spaced
  // perpendicular to the connection axis.
  const layoutTop = (n: number) => Array.from({ length: n }, (_, i) =>
    ({ x: ((i + 1) / (n + 1)) * W - cardW / 2, y: 18 }))
  const layoutBottom = (n: number) => Array.from({ length: n }, (_, i) =>
    ({ x: ((i + 1) / (n + 1)) * W - cardW / 2, y: H - 18 - cardH }))
  const layoutLeft = (n: number) => Array.from({ length: n }, (_, i) =>
    ({ x: 12, y: ((i + 1) / (n + 1)) * H - cardH / 2 }))
  const layoutRight = (n: number) => Array.from({ length: n }, (_, i) =>
    ({ x: W - 12 - cardW, y: ((i + 1) / (n + 1)) * H - cardH / 2 }))

  const callerPositions  = layoutTop(callerItems.length)
  const depPositions     = layoutLeft(depItems.length)
  const impactPositions  = layoutRight(impactItems.length)
  const testPositions    = layoutBottom(testItems.length)

  // Anchor points on the center card.
  const centerTop    = { x: CX, y: CY - CH / 2 }
  const centerBottom = { x: CX, y: CY + CH / 2 }
  const centerLeft   = { x: CX - CW / 2, y: CY }
  const centerRight  = { x: CX + CW / 2, y: CY }

  // Bezier path helpers.
  const pathV = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const midY = (from.y + to.y) / 2
    return `M ${from.x} ${from.y} C ${from.x} ${midY}, ${to.x} ${midY}, ${to.x} ${to.y}`
  }
  const pathH = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const midX = (from.x + to.x) / 2
    return `M ${from.x} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x} ${to.y}`
  }

  const renderCard = (
    item: SpokeItem,
    pos: { x: number; y: number },
    color: string,
    iconKind: 'file' | 'service' | 'test' | 'table',
    key: string,
  ) => (
    <g
      key={key}
      transform={`translate(${pos.x}, ${pos.y})`}
      style={{ cursor: item.path ? 'pointer' : 'default' }}
      onClick={() => item.path && onJump(item.path)}
    >
      <rect width={cardW} height={cardH} rx={8} ry={8}
            fill="var(--panel-2)" stroke={color} strokeOpacity={0.4} strokeWidth={1}
            vectorEffect="non-scaling-stroke" />
      <g transform="translate(10, 10)">
        <rect width={20} height={20} rx={5} fill={color} fillOpacity={0.18} />
        <text x={10} y={14} textAnchor="middle"
              fontSize={9} fontWeight={700} fill={color} fontFamily="var(--font-mono)">
          {iconKind === 'file' ? 'TS'
            : iconKind === 'service' ? 'S'
            : iconKind === 'test' ? 'T'
            : 'DB'}
        </text>
      </g>
      <text x={38} y={18} fontSize={11} fontWeight={500} fill="var(--text)"
            fontFamily="var(--font-mono)" style={{ pointerEvents: 'none' }}>
        {truncate(item.label, 18)}
      </text>
      {item.sublabel && (
        <text x={38} y={30} fontSize={9} fill="var(--text-dim)" style={{ pointerEvents: 'none' }}>
          {truncate(item.sublabel, 22)}
        </text>
      )}
    </g>
  )

  return (
    <div style={spokeWrapStyle}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="xMidYMid meet">
        {/* Section labels (corners) */}
        <text x={16} y={14} fontSize={9.5} fontWeight={600} fill="var(--accent)"
              style={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
          CALLED BY ({callerItems.length})
        </text>
        <text x={W - 16} y={14} fontSize={9.5} fontWeight={600} fill="var(--yellow)"
              textAnchor="end" style={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
          IMPACTS ({impactItems.length})
        </text>
        <text x={16} y={H - 6} fontSize={9.5} fontWeight={600} fill="var(--green)"
              style={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
          DEPENDS ON ({depItems.length})
        </text>
        <text x={W - 16} y={H - 6} fontSize={9.5} fontWeight={600} fill="var(--blue)"
              textAnchor="end" style={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
          TESTS ({testItems.length})
        </text>

        {/* Bezier edges from each peripheral card to the center anchor. */}
        <g fill="none" strokeWidth={1} strokeDasharray="5 4" vectorEffect="non-scaling-stroke">
          {callerPositions.map((pos, i) => (
            <path key={`ce${i}`}
                  d={pathV({ x: pos.x + cardW / 2, y: pos.y + cardH }, centerTop)}
                  stroke="var(--accent)" strokeOpacity={0.55} />
          ))}
          {depPositions.map((pos, i) => (
            <path key={`de${i}`}
                  d={pathH({ x: pos.x + cardW, y: pos.y + cardH / 2 }, centerLeft)}
                  stroke="var(--green)" strokeOpacity={0.55} />
          ))}
          {impactPositions.map((pos, i) => (
            <path key={`ie${i}`}
                  d={pathH({ x: pos.x, y: pos.y + cardH / 2 }, centerRight)}
                  stroke="var(--yellow)" strokeOpacity={0.55} />
          ))}
          {testPositions.map((pos, i) => (
            <path key={`te${i}`}
                  d={pathV({ x: pos.x + cardW / 2, y: pos.y }, centerBottom)}
                  stroke="var(--blue)" strokeOpacity={0.55} />
          ))}
        </g>

        {/* Peripheral cards */}
        {callerItems.map((item, i) =>
          renderCard(item, callerPositions[i], 'var(--accent)', 'file', `c${i}`))}
        {depItems.map((item, i) =>
          renderCard(item, depPositions[i], 'var(--green)', 'file', `d${i}`))}
        {impactItems.map((item, i) =>
          renderCard(item, impactPositions[i], 'var(--yellow)', 'service', `i${i}`))}
        {testItems.map((item, i) =>
          renderCard(item, testPositions[i], 'var(--blue)', 'test', `t${i}`))}

        {/* Center file card */}
        <g transform={`translate(${CX - CW / 2}, ${CY - CH / 2})`}>
          <rect width={CW} height={CH} rx={10} ry={10}
                fill={`color-mix(in srgb, ${centerSub.color} 18%, var(--panel-2))`}
                stroke={centerSub.color} strokeWidth={2}
                vectorEffect="non-scaling-stroke" />
          <g transform="translate(10, 11)">
            <rect width={32} height={32} rx={7} fill={centerSub.color} fillOpacity={0.3} />
            <text x={16} y={22} textAnchor="middle"
                  fontSize={11} fontWeight={700} fill="#fff" fontFamily="var(--font-mono)">
              TS
            </text>
          </g>
          <text x={50} y={24} fontSize={13} fontWeight={600} fill="var(--text)"
                fontFamily="var(--font-mono)" style={{ pointerEvents: 'none' }}>
            {truncate(centerName, 18)}
          </text>
          <text x={50} y={40} fontSize={10} fill="var(--text-dim)" style={{ pointerEvents: 'none' }}>
            {truncate(centerPath.split('/').slice(0, -1).join('/'), 26)}
          </text>
        </g>

        {/* Empty-state for completely orphaned files */}
        {callerItems.length + depItems.length + testItems.length + impactItems.length === 0 && (
          <text x={CX} y={CY + 50} fontSize={11} fill="var(--text-faint)" textAnchor="middle">
            No direct dependencies tracked for this file.
          </text>
        )}
      </svg>
    </div>
  )
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-dim)' }}>
      <span style={{ width: 8, height: 8, borderRadius: 999, background: color, display: 'inline-block' }} />
      {label}
    </span>
  )
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0][0]!.toUpperCase()
  return (parts[0][0]! + parts[parts.length - 1][0]!).toUpperCase()
}

// Deterministic avatar background — small palette indexed by a cheap hash.
function avatarColor(seed: string): string {
  const palette = [
    'linear-gradient(135deg, #7c5cff 0%, #00d4ff 100%)',
    'linear-gradient(135deg, #f472b6 0%, #fb923c 100%)',
    'linear-gradient(135deg, #4ade80 0%, #60a5fa 100%)',
    'linear-gradient(135deg, #fbbf24 0%, #f87171 100%)',
    'linear-gradient(135deg, #60a5fa 0%, #c8b8e8 100%)',
    'linear-gradient(135deg, #f87171 0%, #f472b6 100%)',
  ]
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return palette[h % palette.length]
}

// ---------- helpers ----------

function isTestPath(p: string): boolean {
  return /(^|\/)(tests?|__tests__|spec|specs|e2e)\//.test(p) || /(\.test|\.spec|_test)\.[a-z0-9]+$/i.test(p)
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

function extLabel(p: string): string {
  const ext = p.split('.').pop()?.toLowerCase() ?? ''
  return ext ? `${ext.toUpperCase()} file` : 'File'
}

function complexityFromLoc(loc: number): string {
  if (loc < 100) return `${loc} (Low)`
  if (loc < 300) return `${loc} (Moderate)`
  if (loc < 600) return `${loc} (High)`
  return `${loc} (Very high)`
}
function complexityColor(loc: number): string {
  if (loc < 100) return 'var(--green)'
  if (loc < 300) return 'var(--text)'
  if (loc < 600) return 'var(--yellow)'
  return 'var(--red)'
}

function freqLabel(commits30d: number): string {
  if (commits30d === 0) return 'Untouched'
  if (commits30d <= 2) return 'Low'
  if (commits30d <= 6) return 'Moderate'
  if (commits30d <= 15) return 'High'
  return 'Very high'
}
function freqColor(commits30d: number): string {
  if (commits30d <= 2) return 'var(--text)'
  if (commits30d <= 6) return 'var(--text)'
  if (commits30d <= 15) return 'var(--yellow)'
  return 'var(--red)'
}

function daysAgo(days: number): string {
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  if (days < 365) return `${Math.round(days / 30)}mo ago`
  return `${Math.round(days / 365)}y ago`
}

function relativeTimeFromStats(stats: FileStats | null): string {
  if (!stats || stats.daysSinceLastTouch == null) return 'No git history'
  return `Last touched ${daysAgo(stats.daysSinceLastTouch)}`
}

function computeRisk(input: {
  loc: number; callers: number; deps: number
  errors: number; warnings: number; dirty: boolean
  stats: FileStats | null
}): { score: number; label: string; color: string; reason: string } {
  const sizePts   = Math.min(25, (input.loc / 500) * 25)
  const blastPts  = Math.min(30, (input.callers / 10) * 30)
  const healthPts = Math.min(25, input.errors * 8 + input.warnings * 2 + (input.dirty ? 5 : 0))
  const freqPts   = Math.min(20, ((input.stats?.last30Days ?? 0) / 10) * 20)
  const score = Math.round(sizePts + blastPts + healthPts + freqPts)
  let label: string, color: string
  if (score < 25)       { label = 'Quiet';     color = 'var(--green)' }
  else if (score < 50)  { label = 'Active';    color = 'var(--blue)' }
  else if (score < 75)  { label = 'Hot spot';  color = 'var(--yellow)' }
  else                  { label = 'High risk'; color = 'var(--red)' }
  // Build the explanation from the dominant contributor.
  const parts: Array<{ pts: number; text: string }> = [
    { pts: blastPts,  text: input.callers > 0 ? `${input.callers} caller${input.callers === 1 ? '' : 's'} depend on it` : '' },
    { pts: sizePts,   text: input.loc > 0 ? `${input.loc} LoC` : '' },
    { pts: healthPts, text: input.errors > 0 ? `${input.errors} open error${input.errors === 1 ? '' : 's'}` : (input.warnings > 0 ? `${input.warnings} warnings` : '') },
    { pts: freqPts,   text: (input.stats?.last30Days ?? 0) > 0 ? `${input.stats!.last30Days} commits in 30d` : '' },
  ].filter((p) => p.text).sort((a, b) => b.pts - a.pts)
  const reason = parts.length > 0
    ? parts.slice(0, 2).map((p) => p.text).join('; ') + '.'
    : 'Low-traffic file with no recent activity.'
  return { score, label, color, reason }
}

// ---------- styles ----------

const shellStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  background: 'var(--bg)',
  color: 'var(--text)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  zIndex: 50,
}
const loadingShellStyle: React.CSSProperties = {
  margin: 'auto',
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  fontSize: 13,
  color: 'var(--text-dim)',
}
const breadcrumbStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '10px 16px',
  borderBottom: '0.5px solid var(--border-soft)',
  background: 'var(--panel)',
  flexShrink: 0,
}
const crumbStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--text-dim)',
}
const bodyStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) 320px',
  gap: 0,
  overflow: 'hidden',
}
const mainColStyle: React.CSSProperties = {
  overflowY: 'auto',
  padding: '20px 24px 40px',
  display: 'flex',
  flexDirection: 'column',
  gap: 18,
}
const heroGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) 280px',
  gap: 14,
}
const fileHeaderCardStyle: React.CSSProperties = {
  padding: 18,
  borderRadius: 12,
  background: 'var(--panel)',
  border: '0.5px solid var(--border-soft)',
  display: 'flex',
  alignItems: 'flex-start',
  gap: 14,
}
const fileIconStyle: React.CSSProperties = {
  width: 44, height: 44, borderRadius: 10,
  display: 'grid', placeItems: 'center',
  flexShrink: 0,
}
const fileTitleStyle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 600,
  color: 'var(--text)',
  margin: 0,
  fontFamily: 'var(--font-mono)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
}
const changedPillStyle: React.CSSProperties = {
  fontSize: 9.5,
  fontWeight: 700,
  letterSpacing: 0.8,
  padding: '2px 7px',
  borderRadius: 999,
  background: 'color-mix(in srgb, var(--yellow) 18%, transparent)',
  color: 'var(--yellow)',
}
const fileSubtitleStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--text-dim)',
  marginTop: 6,
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flexWrap: 'wrap',
}
const riskHeroStyle: React.CSSProperties = {
  padding: 16,
  borderRadius: 12,
  border: '1px solid',
}
const cardStyle: React.CSSProperties = {
  padding: 18,
  borderRadius: 12,
  background: 'var(--panel)',
  border: '0.5px solid var(--border-soft)',
}
const cardTitleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--text)',
  margin: '0 0 12px',
}
const tileRowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
  gap: 10,
}
const tileStyle: React.CSSProperties = {
  padding: 14,
  borderRadius: 10,
  background: 'var(--panel-2)',
  border: '0.5px solid var(--border-soft)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 6,
}
const tileIconStyle: React.CSSProperties = {
  width: 28, height: 28, borderRadius: 7,
  display: 'grid', placeItems: 'center',
  marginBottom: 6,
}
const tileDetailStyle: React.CSSProperties = {
  marginTop: 8,
  paddingTop: 8,
  borderTop: '0.5px solid var(--border-soft)',
  width: '100%',
  fontSize: 10,
  color: 'var(--text-dim)',
  fontFamily: 'var(--font-mono)',
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  minWidth: 0,
}
const stepRowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  gap: 10,
}
const stepCardStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: 10,
  padding: 12,
  borderRadius: 10,
  background: 'var(--panel-2)',
  border: '0.5px solid var(--border-soft)',
  cursor: 'pointer',
  textAlign: 'left',
  color: 'inherit',
  font: 'inherit',
}
const stepIconStyle: React.CSSProperties = {
  width: 28, height: 28, borderRadius: 7,
  display: 'grid', placeItems: 'center',
  flexShrink: 0,
}
const stepTitleStyle: React.CSSProperties = {
  fontSize: 12.5,
  fontWeight: 500,
  color: 'var(--text)',
  lineHeight: 1.3,
}
const stepReasonStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--text-dim)',
  marginTop: 3,
  lineHeight: 1.35,
  overflow: 'hidden',
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
}
const loadingRowStyle: React.CSSProperties = {
  fontSize: 12, color: 'var(--text-dim)',
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '4px 0',
}
const emptyRowStyle: React.CSSProperties = {
  fontSize: 12, color: 'var(--text-faint)', padding: '4px 0',
}
const cachedBadgeStyle: React.CSSProperties = {
  fontSize: 10, fontWeight: 500, letterSpacing: 0.3,
  padding: '2px 7px', borderRadius: 999,
  background: 'color-mix(in srgb, var(--green) 14%, transparent)',
  color: 'var(--green)',
}
const freshBadgeStyle: React.CSSProperties = {
  fontSize: 10, fontWeight: 500, letterSpacing: 0.3,
  padding: '2px 7px', borderRadius: 999,
  background: 'color-mix(in srgb, var(--accent-2) 14%, transparent)',
  color: 'var(--accent-2)',
}
const spokeWrapStyle: React.CSSProperties = {
  width: '100%',
  background: 'color-mix(in srgb, var(--bg) 50%, var(--panel))',
  borderRadius: 10,
  border: '0.5px solid var(--border-soft)',
  padding: '6px 4px',
}
const legendRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 16,
  marginTop: 10,
  paddingTop: 10,
  borderTop: '0.5px solid var(--border-soft)',
  flexWrap: 'wrap',
}
const rightRailStyle: React.CSSProperties = {
  overflowY: 'auto',
  padding: '20px 16px 40px',
  borderLeft: '0.5px solid var(--border-soft)',
  background: 'var(--panel)',
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
}
const railCardStyle: React.CSSProperties = {
  padding: 14,
  borderRadius: 10,
  background: 'var(--panel-2)',
  border: '0.5px solid var(--border-soft)',
}
const railTitleStyle: React.CSSProperties = {
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: 0.6,
  color: 'var(--text-faint)',
  fontWeight: 600,
  margin: '0 0 10px',
}
const railRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  padding: '4px 0',
  borderBottom: '0.5px solid var(--border-soft)',
}
const railCommitStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  padding: '6px 0',
  borderBottom: '0.5px solid var(--border-soft)',
}
const railCommitMsgStyle: React.CSSProperties = {
  fontSize: 11.5,
  color: 'var(--text)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  flex: 1,
}
const railCommitMetaStyle: React.CSSProperties = {
  fontSize: 10.5,
  color: 'var(--text-faint)',
  display: 'flex',
  gap: 5,
  marginLeft: 16,
}
const ownersRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
}
const avatarStyle: React.CSSProperties = {
  width: 22,
  height: 22,
  borderRadius: 999,
  display: 'inline-grid',
  placeItems: 'center',
  fontSize: 9.5,
  fontWeight: 700,
  color: '#fff',
  border: '1.5px solid var(--panel-2)',
  letterSpacing: 0.3,
  position: 'relative',
}
