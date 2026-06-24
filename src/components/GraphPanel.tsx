import { useEffect, useMemo, useCallback, useState } from 'react'
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  Position,
  MarkerType,
} from 'reactflow'
import 'reactflow/dist/style.css'
import { RefreshCw, AlertTriangle, Zap, X } from 'lucide-react'
import { useStore } from '../store'

// Language → color mapping for graph nodes
const LANG_COLORS: Record<string, string> = {
  typescript: '#3178c6',
  javascript: '#f7df1e',
  tsx: '#3178c6',
  jsx: '#f7df1e',
  python: '#3776ab',
  go: '#00add8',
  rust: '#dea584',
  ruby: '#cc342d',
  java: '#f89820',
  markdown: '#6a737d',
  css: '#563d7c',
  html: '#e34c26',
  json: '#cbcb41',
  shell: '#89e051',
  unknown: '#9ca3af',
}

// Simple deterministic circular-ish layout based on directory grouping.
// Full dagre would be better but we avoid the extra dep here.
function layoutNodes(
  nodeIds: string[],
  paths: Record<string, string>,
  width: number,
  height: number,
): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {}
  // Group by top-level directory for cluster feel
  const groups: Record<string, string[]> = {}
  for (const id of nodeIds) {
    const p = paths[id] ?? id
    const topDir = p.includes('/') ? p.split('/')[0] : '__root'
    ;(groups[topDir] ??= []).push(id)
  }
  const groupNames = Object.keys(groups)
  const angleStep = (2 * Math.PI) / Math.max(groupNames.length, 1)
  const radius = Math.min(width, height) / 3
  const cx = width / 2
  const cy = height / 2

  groupNames.forEach((g, gi) => {
    const members = groups[g]
    const ga = gi * angleStep
    const gx = cx + radius * Math.cos(ga)
    const gy = cy + radius * Math.sin(ga)
    const memberRadius = Math.min(100, members.length * 12)
    members.forEach((id, mi) => {
      const ma = (mi / Math.max(members.length, 1)) * 2 * Math.PI
      positions[id] = {
        x: gx + memberRadius * Math.cos(ma) + (Math.random() - 0.5) * 10,
        y: gy + memberRadius * Math.sin(ma) + (Math.random() - 0.5) * 10,
      }
    })
  })
  return positions
}

export default function GraphPanel() {
  const graphData = useStore((s) => s.graphData)
  const graphLoading = useStore((s) => s.graphLoading)
  const loadGraph = useStore((s) => s.loadGraph)
  const impactData = useStore((s) => s.impactData)
  const impactLoading = useStore((s) => s.impactLoading)
  const loadImpact = useStore((s) => s.loadImpact)
  const clearImpact = useStore((s) => s.clearImpact)
  const openFile = useStore((s) => s.openFile)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    if (!graphData) loadGraph()
  }, [graphData, loadGraph])

  // Build react-flow nodes/edges from graph data
  const { nodes, edges } = useMemo(() => {
    if (!graphData) return { nodes: [] as Node[], edges: [] as Edge[] }
    const width = 900
    const height = 600
    const paths: Record<string, string> = {}
    for (const [id, n] of Object.entries(graphData.nodes)) {
      paths[id] = n.path
    }
    const pos = layoutNodes(Object.keys(graphData.nodes), paths, width, height)

    const rfNodes: Node[] = Object.values(graphData.nodes).map((n) => {
      const shortName = n.path.split('/').pop() ?? n.path
      const color = LANG_COLORS[n.language] ?? LANG_COLORS.unknown
      return {
        id: n.id,
        type: 'default',
        position: pos[n.id] ?? { x: 0, y: 0 },
        data: {
          label: (
            <div style={{ fontSize: 10, textAlign: 'center', maxWidth: 110 }}>
              <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {shortName}
              </div>
              <div style={{ color, fontSize: 9 }}>{n.language}</div>
            </div>
          ),
        },
        style: {
          background: 'var(--bg-1)',
          border: `1.5px solid ${color}`,
          color: 'var(--text)',
          width: 110,
          padding: 4,
        },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      }
    })

    // Deduplicate edges
    const seen = new Set<string>()
    const rfEdges: Edge[] = []
    for (const e of graphData.edges) {
      const key = `${e.source}->${e.target}`
      if (seen.has(key)) continue
      if (!graphData.nodes[e.source] || !graphData.nodes[e.target]) continue
      seen.add(key)
      rfEdges.push({
        id: key,
        source: e.source,
        target: e.target,
        animated: false,
        type: 'smoothstep',
        style: { stroke: 'var(--text-faint)', strokeWidth: 1 },
        markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--text-faint)' },
      })
    }

    return { nodes: rfNodes, edges: rfEdges }
  }, [graphData])

  // Highlight impacted nodes when impact analysis is shown
  const impactedSet = useMemo(() => {
    const s = new Set<string>(impactData?.impacted.map((i) => i.id) ?? [])
    if (impactData?.file) {
      // The file itself is a node id we need to find
      const entry = Object.entries(graphData?.nodes ?? {}).find(
        ([, n]) => n.path === impactData.file,
      )
      if (entry) s.add(entry[0])
    }
    return s
  }, [impactData, graphData])

  const onNodeClick = useCallback(
    (_evt: React.MouseEvent, node: Node) => {
      setSelectedId(node.id)
      const path = graphData?.nodes[node.id]?.path
      if (path) loadImpact(path)
    },
    [graphData, loadImpact],
  )

  const onNodeDoubleClick = useCallback(
    (_evt: React.MouseEvent, node: Node) => {
      const path = graphData?.nodes[node.id]?.path
      if (path) openFile(path)
    },
    [graphData, openFile],
  )

  const stats = graphData?.buildStats

  return (
    <div className="sidebar" style={{ padding: 0 }}>
      <div className="sidebar-header">
        <span>Architecture Graph</span>
        <div className="actions">
          <button
            className="mini-btn"
            title="Rebuild graph"
            onClick={() => loadGraph(true)}
            disabled={graphLoading}
          >
            <RefreshCw size={13} className={graphLoading ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {/* Stats bar */}
      <div style={{ padding: '4px 10px', fontSize: 11, color: 'var(--text-faint)', borderBottom: '1px solid var(--border)' }}>
        {graphData ? (
          <>
            {Object.keys(graphData.nodes).length} files · {graphData.edges.length} deps
            {stats && stats.total > 0 && (
              <span style={{ marginLeft: 6 }}>
                (parsed {stats.parsed}, cached {stats.cached}/{stats.total})
              </span>
            )}
          </>
        ) : (
          <span>{graphLoading ? 'Analyzing codebase…' : 'No graph data'}</span>
        )}
      </div>

      {/* Impact banner */}
      {impactData && (
        <div
          style={{
            padding: '8px 10px',
            background: 'var(--bg-2)',
            borderBottom: '1px solid var(--border)',
            fontSize: 11.5,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <AlertTriangle size={13} style={{ color: 'var(--yellow)' }} />
            <strong style={{ fontSize: 11 }}>Impact: {impactData.file.split('/').pop()}</strong>
            <button className="mini-btn" style={{ marginLeft: 'auto', width: 16, height: 16 }} onClick={clearImpact}>
              <X size={11} />
            </button>
          </div>
          {impactLoading ? (
            <div style={{ color: 'var(--text-faint)' }}>Analyzing…</div>
          ) : (
            <div style={{ color: 'var(--text-faint)' }}>
              {impactData.impacted.length === 0 ? (
                'No dependents — safe to modify.'
              ) : (
                <>
                  <strong style={{ color: 'var(--red)' }}>{impactData.impacted.length} file(s)</strong> depend on this:
                  <div style={{ marginTop: 4, maxHeight: 100, overflowY: 'auto' }}>
                    {impactData.impacted.slice(0, 20).map((f) => (
                      <div
                        key={f.id}
                        className="tree-row"
                        style={{ fontSize: 11, padding: '2px 0' }}
                        onClick={() => openFile(f.path)}
                        title={f.path}
                      >
                        <Zap size={10} style={{ color: 'var(--yellow)', marginRight: 4 }} />
                        {f.path}
                      </div>
                    ))}
                    {impactData.impacted.length > 20 && (
                      <div style={{ color: 'var(--text-faint)', fontSize: 10, padding: '2px 0' }}>
                        +{impactData.impacted.length - 20} more…
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Graph canvas */}
      <div style={{ height: 'calc(100% - 90px)', minHeight: 400, background: 'var(--bg-0)' }}>
        {graphData && Object.keys(graphData.nodes).length > 0 ? (
          <ReactFlow
            nodes={nodes.map((n) =>
              impactedSet.has(n.id)
                ? {
                    ...n,
                    style: {
                      ...(n.style as object),
                      boxShadow: '0 0 0 2px var(--yellow)',
                      opacity: 1,
                    },
                  }
                : impactedSet.size > 0
                ? { ...n, style: { ...(n.style as object), opacity: 0.35 } }
                : n,
            )}
            edges={edges}
            fitView
            onNodeClick={onNodeClick}
            onNodeDoubleClick={onNodeDoubleClick}
            nodesDraggable
            zoomOnScroll
            panOnScroll={false}
            proOptions={{ hideAttribution: true }}
          >
            <Background color="var(--border)" gap={20} />
            <Controls
              showInteractive={false}
              style={{ background: 'var(--bg-1)', border: '1px solid var(--border)' }}
            />
            <MiniMap
              nodeColor={(n) => {
                const lang = graphData.nodes[n.id]?.language
                return LANG_COLORS[lang ?? ''] ?? LANG_COLORS.unknown
              }}
              maskColor="rgba(0,0,0,0.6)"
              style={{ background: 'var(--bg-1)' }}
            />
          </ReactFlow>
        ) : (
          <div
            style={{
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--text-faint)',
              fontSize: 13,
              padding: 20,
              textAlign: 'center',
            }}
          >
            {graphLoading
              ? 'Parsing imports & building dependency graph…'
              : 'Click refresh to build the graph.'}
          </div>
        )}
      </div>
    </div>
  )
}