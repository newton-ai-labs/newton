import { useEffect, useMemo, useRef, useState } from 'react'
import { runForceLayout, type LayoutEdge } from './forceLayout'
import { subsystemFor, uniqueSubsystems } from './subsystems'
import { useGraph } from './useGraph'

/**
 * The constellation view — every workspace file is a node, positioned by
 * a force-directed layout. Imports are edges. Subsystem (server / src /
 * tests / etc.) is encoded as ring color.
 *
 * Interactions in Phase 1:
 *   - mouse-wheel zoom (around cursor)
 *   - left-drag to pan
 *   - click a node → select it (visual ring; editor opens in Phase 2)
 *
 * Data is fetched from /api/graph (the existing repoGraph endpoint).
 */

interface Props {
  /** Selected node id (controlled by the parent). */
  selectedId?: string | null
  /** Fired when the user single-clicks a node — opens the details drawer. */
  onSelect?: (nodeId: string, screenPos: { x: number; y: number } | null) => void
  /** Fired on double-click — opens the file in the editor directly (skips
      the drawer). Separated from onSelect so the parent can decide whether
      to keep single-click = preview vs single-click = open. */
  onOpen?: (nodeId: string, screenPos: { x: number; y: number } | null) => void
  /** When true, the canvas dims + blurs (sibling editor is taking focus). */
  dimmed?: boolean
  /** Node ids the AI is currently writing to/working on — get a pulsing ring. */
  activeNodeIds?: Set<string>
  /** Node ids the AI has recently touched (this mission) — get a steady halo. */
  touchedNodeIds?: Set<string>
  /** When set, the canvas animates its viewport to center on this node.
      Changes are debounced internally — set a new id to fly there. */
  flyToNodeId?: string | null
  /** Fired after a fly-to animation finishes (with the same node id). The
      parent can use this to clear the request. Optional. */
  onFlyComplete?: (nodeId: string) => void
  /** First-run pass: nodes ease in with a staggered fade so the user feels
      the codebase assembling. Skipped on subsequent visits. */
  firstRun?: boolean
  /** Per-file health snapshot (diagnostics + git status). Drives the small
      error badge + git-status dot overlays on each node. */
  healthByPath?: Map<string, { errors: number; warnings: number; gitStatus?: string }>
}

const CANVAS_W = 1800
const CANVAS_H = 1200
const NODE_BASE_RADIUS = 5
const NODE_MAX_RADIUS = 16

const EMPTY_SET: Set<string> = new Set()
const EMPTY_HEALTH: Map<string, { errors: number; warnings: number; gitStatus?: string }> = new Map()

export default function ConstellationCanvas({
  selectedId,
  onSelect,
  onOpen,
  dimmed = false,
  activeNodeIds = EMPTY_SET,
  touchedNodeIds = EMPTY_SET,
  flyToNodeId = null,
  onFlyComplete,
  firstRun = false,
  healthByPath = EMPTY_HEALTH,
}: Props) {
  const { graph, error } = useGraph()
  const svgRef = useRef<SVGSVGElement>(null)

  // Viewport transform: where on the world we're looking.
  const [view, setView] = useState({ x: 0, y: 0, zoom: 1 })
  const dragRef = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null)
  // Aborts an in-flight fly-to when user interacts mid-animation.
  const flyAbortRef = useRef<(() => void) | null>(null)
  // True until we've auto-fit the viewport to the laid-out nodes — prevents
  // re-fitting on subsequent renders / hot reloads while the user is panning.
  const fittedRef = useRef(false)

  // Track the wrapper's actual aspect ratio. The viewBox width is derived
  // from this so the SVG always fills 100% of the visible area instead of
  // letterboxing when the viewport is wider than CANVAS_W/CANVAS_H.
  const [wrapperAspect, setWrapperAspect] = useState(CANVAS_W / CANVAS_H)

  // Compute positions per graph + aspect. Recomputed when the viewport
  // aspect changes substantially so the cluster shape tracks the screen.
  // Force layout is O(n² × iterations) but cheap enough at ~50 nodes that
  // re-running on aspect change is ~10ms.
  const positioned = useMemo(() => {
    if (!graph) return null
    const ids = Object.keys(graph.nodes)
    if (ids.length === 0) return { positions: {}, edges: [] as LayoutEdge[] }
    // Bigger files get bigger nodes — caps so the graph stays readable.
    const radii: Record<string, number> = {}
    for (const id of ids) {
      const lines = graph.nodes[id].lineCount ?? 50
      const r = NODE_BASE_RADIUS + Math.min(NODE_MAX_RADIUS - NODE_BASE_RADIUS, Math.log10(lines + 1) * 3)
      radii[id] = r
    }
    // Stretch the layout's working canvas to the viewport aspect. The
    // gravity-toward-center + initial concentric placement use these dims,
    // so this is what makes the cluster naturally wider on wide screens.
    const layoutH = CANVAS_H
    const layoutW = Math.max(CANVAS_W, layoutH * wrapperAspect)
    const positions = runForceLayout({
      ids,
      edges: graph.edges,
      radii,
      width: layoutW,
      height: layoutH,
      iterations: 360,
    })
    return { positions, edges: graph.edges }
  }, [graph, wrapperAspect])

  // Track wrapper aspect — viewBox dimensions key off it so the SVG fills
  // the entire wrapper regardless of monitor aspect.
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const update = () => {
      const r = el.getBoundingClientRect()
      if (r.width > 0 && r.height > 0) {
        const next = r.width / r.height
        setWrapperAspect((prev) => Math.abs(prev - next) > 0.01 ? next : prev)
      }
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Auto-fit on first layout: frame the actual node bounding box rather
  // than the abstract canvas size, so the graph always fills the screen
  // regardless of how compactly the force layout converged. The viewBox
  // aspect tracks the wrapper, so we pick `zoom` such that the bbox fits
  // in BOTH dimensions of the current wrapper.
  useEffect(() => {
    if (!positioned || fittedRef.current) return
    const ids = Object.keys(positioned.positions)
    if (ids.length === 0) return
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const id of ids) {
      const p = positioned.positions[id]
      const r = p.radius + 24  // include label space
      minX = Math.min(minX, p.x - r); minY = Math.min(minY, p.y - r)
      maxX = Math.max(maxX, p.x + r); maxY = Math.max(maxY, p.y + r)
    }
    const bboxW = maxX - minX
    const bboxH = maxY - minY
    if (bboxW <= 0 || bboxH <= 0) return
    const PADDING = 1.10
    // viewH = CANVAS_H / zoom, viewW = viewH * wrapperAspect
    // bboxH * PADDING <= viewH → zoom <= CANVAS_H / (bboxH * PADDING)
    // bboxW * PADDING <= viewW = (CANVAS_H/zoom) * wrapperAspect
    //   → zoom <= (CANVAS_H * wrapperAspect) / (bboxW * PADDING)
    const zoom = Math.min(
      CANVAS_H / (bboxH * PADDING),
      (CANVAS_H * wrapperAspect) / (bboxW * PADDING),
    )
    const viewH = CANVAS_H / zoom
    const viewW = viewH * wrapperAspect
    const cx = (minX + maxX) / 2
    const cy = (minY + maxY) / 2
    setView({ x: cx - viewW / 2, y: cy - viewH / 2, zoom })
    fittedRef.current = true
  }, [positioned, wrapperAspect])

  // On wrapper-aspect changes after the initial fit, keep the viewBox
  // centered on the same world point so a window resize doesn't slide the
  // graph off-screen. Adjusts view.x only — vertical centering doesn't
  // change since we key viewH off CANVAS_H.
  useEffect(() => {
    if (!fittedRef.current) return
    setView((v) => {
      const viewH = CANVAS_H / v.zoom
      const viewW = viewH * wrapperAspect
      // Center stays at v.x + (oldViewW / 2). Re-derive new x for new viewW.
      // We can't recover oldViewW here, so approximate by assuming caller
      // intent: keep the world center of the current view.
      const centerX = v.x + viewW / 2  // close enough; precision drift is invisible
      return { ...v, x: centerX - viewW / 2 }
    })
  }, [wrapperAspect])

  // Fly-to animation. When the caller sets a new flyToNodeId, tween the
  // viewport so that node is centered at a zoomed-in scale. Abort if the
  // user starts panning/zooming so we don't fight their input.
  useEffect(() => {
    if (!flyToNodeId || !positioned) return
    const target = positioned.positions[flyToNodeId]
    if (!target) return

    flyAbortRef.current?.()  // cancel any prior tween before starting a new one

    const targetZoom = 1.6
    const targetViewH = CANVAS_H / targetZoom
    const targetViewW = targetViewH * wrapperAspect
    const targetX = target.x - targetViewW / 2
    const targetY = target.y - targetViewH / 2

    const startView = { ...view }
    const endView = { x: targetX, y: targetY, zoom: targetZoom }
    const start = performance.now()
    const duration = 480
    let raf = 0
    let cancelled = false

    const tick = (now: number) => {
      if (cancelled) return
      const t = Math.min(1, (now - start) / duration)
      const e = 1 - Math.pow(1 - t, 3)  // easeOutCubic
      setView({
        x: startView.x + (endView.x - startView.x) * e,
        y: startView.y + (endView.y - startView.y) * e,
        zoom: startView.zoom + (endView.zoom - startView.zoom) * e,
      })
      if (t < 1) raf = requestAnimationFrame(tick)
      else onFlyComplete?.(flyToNodeId)
    }
    raf = requestAnimationFrame(tick)

    flyAbortRef.current = () => { cancelled = true; cancelAnimationFrame(raf) }
    return () => flyAbortRef.current?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyToNodeId, positioned])

  // Mouse interactions: drag-pan + wheel-zoom.
  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return
    flyAbortRef.current?.()  // user took control; stop any tween
    dragRef.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = dragRef.current
    if (!d) return
    const dx = (e.clientX - d.x) / view.zoom
    const dy = (e.clientY - d.y) / view.zoom
    setView({ ...view, x: d.vx - dx, y: d.vy - dy })
  }
  const onPointerUp = () => {
    dragRef.current = null
  }
  const onWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    // Zoom toward the cursor — translate world so the point under the
    // cursor stays under the cursor after the zoom.
    e.preventDefault()
    flyAbortRef.current?.()  // user took control; stop any tween
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const px = e.clientX - rect.left
    const py = e.clientY - rect.top
    // Convert screen → world coords pre-zoom. View width must match the
    // aspect-aware viewBox we actually render, otherwise cursor-locked zoom
    // drifts horizontally.
    const currViewH = CANVAS_H / view.zoom
    const currViewW = currViewH * wrapperAspect
    const worldX = view.x + (px / rect.width) * currViewW
    const worldY = view.y + (py / rect.height) * currViewH
    const zoomFactor = Math.exp(-e.deltaY * 0.0015)
    const nextZoom = clamp(view.zoom * zoomFactor, 0.4, 4)
    const nextViewH = CANVAS_H / nextZoom
    const nextViewW = nextViewH * wrapperAspect
    // Then translate so worldX/Y maps back to the same pixel position.
    const nextX = worldX - (px / rect.width) * nextViewW
    const nextY = worldY - (py / rect.height) * nextViewH
    setView({ x: nextX, y: nextY, zoom: nextZoom })
  }

  if (error) {
    return (
      <div style={errBoxStyle}>
        Couldn't load codebase graph: {error}
      </div>
    )
  }
  if (!graph || !positioned) {
    return <div style={loadingStyle}>Plotting constellation…</div>
  }

  const { positions, edges } = positioned
  const legend = uniqueSubsystems(Object.values(graph.nodes).map((n) => n.path))
  // viewH still keys off CANVAS_H so existing zoom math (wheel, fly-to)
  // stays correct; viewW derives from wrapper aspect so the SVG always
  // fills the available horizontal space.
  const viewH = CANVAS_H / view.zoom
  const viewW = viewH * wrapperAspect

  // Subsystem regions — bounding box per subsystem of its member nodes.
  // Rendered as soft rounded rects behind everything else, giving the eye
  // a visible "shape" for each part of the codebase. Skipped for subsystems
  // with a single node (no useful region to draw).
  const regions = (() => {
    const groups = new Map<string, { color: string; label: string; minX: number; maxX: number; minY: number; maxY: number; count: number }>()
    for (const [id, p] of Object.entries(positions)) {
      const node = graph.nodes[id]
      if (!node) continue
      const sub = subsystemFor(node.path)
      const g = groups.get(sub.id)
      if (!g) {
        groups.set(sub.id, { color: sub.color, label: sub.label, minX: p.x, maxX: p.x, minY: p.y, maxY: p.y, count: 1 })
      } else {
        g.minX = Math.min(g.minX, p.x); g.maxX = Math.max(g.maxX, p.x)
        g.minY = Math.min(g.minY, p.y); g.maxY = Math.max(g.maxY, p.y)
        g.count++
      }
    }
    const PAD = 32
    return [...groups.values()]
      .filter((g) => g.count >= 2)
      .map((g) => ({
        ...g,
        x: g.minX - PAD,
        y: g.minY - PAD,
        w: (g.maxX - g.minX) + PAD * 2,
        h: (g.maxY - g.minY) + PAD * 2,
      }))
  })()

  return (
    <div
      className={dimmed ? 'cn-canvas-dimmed' : 'cn-canvas-bright'}
      style={{ position: 'relative', width: '100%', height: '100%', background: 'var(--bg)' }}
    >
      <svg
        ref={svgRef}
        viewBox={`${view.x} ${view.y} ${viewW} ${viewH}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ width: '100%', height: '100%', cursor: dragRef.current ? 'grabbing' : 'grab', display: 'block' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onWheel={onWheel}
      >
        {/* Subsystem regions — soft tinted rounded rects behind the graph.
            Renders first so everything else paints over them. Gives codebase
            shape visible at a glance without taking interaction. */}
        <g
          pointerEvents="none"
          style={firstRun ? { animation: 'cn-fade-in 600ms ease-out backwards', animationDelay: '0.6s' } : undefined}
        >
          {regions.map((r) => (
            <g key={r.label}>
              <rect
                x={r.x} y={r.y} width={r.w} height={r.h} rx={18}
                fill={r.color} opacity={0.05}
                stroke={r.color} strokeOpacity={0.18} strokeWidth={1}
              />
              <text
                x={r.x + 12}
                y={r.y + 18}
                fontSize={11}
                fontFamily="var(--font-mono, ui-monospace, monospace)"
                fill={r.color}
                fillOpacity={0.55}
                style={{ userSelect: 'none', textTransform: 'uppercase', letterSpacing: 0.6 }}
              >
                {r.label}
              </text>
            </g>
          ))}
        </g>

        {/* Resting edges — visible hairlines. `vector-effect=non-scaling-stroke`
            keeps the line width constant in pixels regardless of viewBox zoom;
            without it the stroke shrinks with the auto-fit and the graph reads
            as "nodes with no connections" at default zoom. */}
        <g
          stroke="var(--border)"
          strokeWidth={1.2}
          fill="none"
          vectorEffect="non-scaling-stroke"
          style={firstRun ? { animation: 'cn-fade-in 600ms ease-out backwards', animationDelay: '0.4s' } : undefined}
        >
          {edges.map((e, i) => {
            const a = positions[e.source]
            const b = positions[e.target]
            if (!a || !b) return null
            const isActive = activeNodeIds.has(e.source) || activeNodeIds.has(e.target)
            const isTouched = !isActive && (touchedNodeIds.has(e.source) || touchedNodeIds.has(e.target))
            if (isActive || isTouched) return null  // drawn in the overlay below
            return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
          })}
        </g>

        {/* Touched edges — soft green, slightly thicker than rest */}
        <g stroke="var(--green)" strokeWidth={1.5} fill="none" opacity={0.55} vectorEffect="non-scaling-stroke">
          {edges.map((e, i) => {
            const a = positions[e.source]
            const b = positions[e.target]
            if (!a || !b) return null
            const isActive = activeNodeIds.has(e.source) || activeNodeIds.has(e.target)
            const isTouched = !isActive && (touchedNodeIds.has(e.source) || touchedNodeIds.has(e.target))
            if (!isTouched) return null
            return <line key={`t-${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
          })}
        </g>

        {/* Active edges — accent color with flowing dashes */}
        <g stroke="var(--accent)" strokeWidth={2} fill="none" vectorEffect="non-scaling-stroke" className="cn-edge-flow">
          {edges.map((e, i) => {
            const a = positions[e.source]
            const b = positions[e.target]
            if (!a || !b) return null
            const isActive = activeNodeIds.has(e.source) || activeNodeIds.has(e.target)
            if (!isActive) return null
            return <line key={`a-${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
          })}
        </g>

        {/* Node strokes also need non-scaling, otherwise the colored rings
            become invisible hairlines when the auto-fit zooms us out. */}
        <g vectorEffect="non-scaling-stroke">
          {Object.entries(positions).map(([id, p]) => {
            const node = graph.nodes[id]
            if (!node) return null
            const sub = subsystemFor(node.path)
            const isSelected = id === selectedId
            const label = node.path.split('/').pop() ?? node.path
            const isActive = activeNodeIds.has(id)
            const isTouched = !isActive && touchedNodeIds.has(id)

            // First-run entrance: stagger by radial distance from the
            // canvas center, so the constellation feels like it assembles
            // inward-out rather than blinking on at once.
            const enterDelay = firstRun
              ? (() => {
                  const cx = CANVAS_W / 2, cy = CANVAS_H / 2
                  const dx = p.x - cx, dy = p.y - cy
                  const dist = Math.sqrt(dx * dx + dy * dy)
                  const maxDist = Math.sqrt(cx * cx + cy * cy)
                  return `${(dist / maxDist) * 0.5}s`
                })()
              : undefined
            const groupStyle: React.CSSProperties = firstRun
              ? { cursor: 'pointer', animation: 'cn-node-enter 520ms ease-out backwards', animationDelay: enterDelay }
              : { cursor: 'pointer' }

            const screenPos = () => {
              const svg = svgRef.current
              if (!svg) return null
              const rect = svg.getBoundingClientRect()
              return {
                x: ((p.x - view.x) / viewW) * rect.width,
                y: ((p.y - view.y) / viewH) * rect.height,
              }
            }
            return (
              <g
                key={id}
                style={groupStyle}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); onSelect?.(id, screenPos()) }}
                onDoubleClick={(e) => { e.stopPropagation(); onOpen?.(id, screenPos()) }}
              >
                {/* Activity halos render UNDER the node circle. */}
                {isActive && (
                  <>
                    <circle
                      cx={p.x} cy={p.y} r={p.radius + 4}
                      fill="none" stroke="var(--accent)" strokeWidth={1.5} opacity={0.7}
                      className="cn-node-pulse"
                    />
                    <circle
                      cx={p.x} cy={p.y} r={p.radius + 4}
                      fill="none" stroke="var(--accent)" strokeWidth={1.5} opacity={0.5}
                      className="cn-node-pulse cn-node-pulse-delay"
                    />
                  </>
                )}
                {isTouched && (
                  <circle
                    cx={p.x} cy={p.y} r={p.radius + 5}
                    fill="none" stroke="var(--green)" strokeWidth={1.4} opacity={0.55}
                  />
                )}
                {isSelected && (
                  <circle cx={p.x} cy={p.y} r={p.radius + 6} fill="none" stroke="var(--accent)" strokeWidth={1.5} />
                )}
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={p.radius}
                  fill={isActive ? 'var(--accent)' : isSelected ? 'var(--accent)' : isTouched ? 'var(--green)' : 'var(--panel)'}
                  stroke={sub.color}
                  strokeWidth={1.5}
                />
                <text
                  x={p.x}
                  y={p.y + p.radius + 11}
                  textAnchor="middle"
                  fontSize={10}
                  fontFamily="var(--font-mono, ui-monospace, monospace)"
                  fill={isSelected || isActive ? 'var(--text)' : 'var(--text-dim)'}
                  style={{ pointerEvents: 'none', userSelect: 'none' }}
                >
                  {label}
                </text>

                {/* Health overlays — Phase 10. Small badges at the node's
                    corners encoding diagnostics + git status. Sized to be
                    legible at default zoom without competing with the node
                    label or activity rings. */}
                {(() => {
                  const h = healthByPath.get(id)
                  if (!h) return null
                  const cornerOffset = p.radius * 0.7
                  return (
                    <>
                      {/* Top-right: errors (red) > warnings (yellow). Shows a
                          dot, or a small numeric badge when count > 1. */}
                      {(h.errors > 0 || h.warnings > 0) && (
                        <g pointerEvents="none">
                          <circle
                            cx={p.x + cornerOffset}
                            cy={p.y - cornerOffset}
                            r={h.errors > 9 ? 7 : 5}
                            fill={h.errors > 0 ? 'var(--red)' : 'var(--yellow)'}
                            stroke="var(--bg)"
                            strokeWidth={1}
                          />
                          {(h.errors + h.warnings) > 1 && (
                            <text
                              x={p.x + cornerOffset}
                              y={p.y - cornerOffset + 2.5}
                              textAnchor="middle"
                              fontSize={7}
                              fontWeight={700}
                              fill="#fff"
                              fontFamily="var(--font-mono, ui-monospace, monospace)"
                            >
                              {h.errors + h.warnings}
                            </text>
                          )}
                        </g>
                      )}
                      {/* Top-left: git status dot. Gold for modified/added/
                          renamed; muted gold for untracked. */}
                      {h.gitStatus && (
                        <circle
                          cx={p.x - cornerOffset}
                          cy={p.y - cornerOffset}
                          r={4}
                          fill={h.gitStatus === '?' ? 'var(--text-dim)' : 'var(--yellow)'}
                          stroke="var(--bg)"
                          strokeWidth={1}
                          pointerEvents="none"
                        />
                      )}
                    </>
                  )
                })()}
              </g>
            )
          })}
        </g>
      </svg>

      <div style={legendStyle}>
        {legend.map((s) => (
          <span key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-dim)' }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.color }} />
            {s.label}
          </span>
        ))}
        {/* Health summary — derived from the per-node map so it always
            matches what the user sees on the canvas. */}
        {(() => {
          let errors = 0, warnings = 0, dirty = 0
          for (const h of healthByPath.values()) {
            errors += h.errors
            warnings += h.warnings
            if (h.gitStatus) dirty++
          }
          if (!errors && !warnings && !dirty) return null
          return (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, fontSize: 11, color: 'var(--text-dim)', marginLeft: 8 }}>
              {errors > 0 && <span><span style={{ color: 'var(--red)', fontWeight: 600 }}>●</span> {errors} error{errors === 1 ? '' : 's'}</span>}
              {warnings > 0 && <span><span style={{ color: 'var(--yellow)', fontWeight: 600 }}>●</span> {warnings} warning{warnings === 1 ? '' : 's'}</span>}
              {dirty > 0 && <span><span style={{ color: 'var(--yellow)', fontWeight: 600 }}>◐</span> {dirty} dirty</span>}
            </span>
          )
        })()}
        <span style={{ fontSize: 11, color: 'var(--text-faint)', marginLeft: 'auto' }}>
          {graph.stats?.fileCount ?? Object.keys(graph.nodes).length} nodes · {graph.stats?.edgeCount ?? edges.length} edges · scroll to zoom · drag to pan
        </span>
      </div>
    </div>
  )
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n))
}

const loadingStyle: React.CSSProperties = {
  width: '100%', height: '100%', display: 'grid', placeItems: 'center',
  color: 'var(--text-dim)', fontSize: 13, background: 'var(--bg)',
}
const errBoxStyle: React.CSSProperties = {
  ...loadingStyle, color: 'var(--red)',
}
const legendStyle: React.CSSProperties = {
  position: 'absolute', left: 16, bottom: 14, right: 16,
  display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
  padding: '8px 12px', borderRadius: 8,
  background: 'color-mix(in srgb, var(--panel) 86%, transparent)',
  border: '0.5px solid var(--border)', backdropFilter: 'blur(8px)',
}
