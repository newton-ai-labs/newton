/**
 * Tiny force-directed graph layout. Pure data, no DOM.
 *
 * For Newton-sized codebases (~50 files) this runs ~200 iterations in single
 * milliseconds. For bigger projects we'll switch to a worker + Barnes-Hut
 * (Phase 7's clustering work), but this is fine for now and dependency-free.
 *
 * Model:
 *   - every node has position + velocity
 *   - connected nodes attract via Hooke's-law springs (edges)
 *   - all node pairs repel via Coulomb-style inverse-square
 *   - everything is pulled toward the canvas center by a weak gravity
 *   - velocity is damped each tick
 */

export interface LayoutNode {
  id: string
  x: number
  y: number
  vx: number
  vy: number
  /** visual radius — bigger nodes (more imports/lines) get more "mass" */
  radius: number
}

export interface LayoutEdge {
  source: string
  target: string
}

export interface LayoutInput {
  ids: string[]
  edges: LayoutEdge[]
  /** optional per-node radius (defaults to 6) */
  radii?: Record<string, number>
  width: number
  height: number
  /** how many iterations to settle (default 300) */
  iterations?: number
}

// Tuned for aggressive spread — nodes push hard apart, edges stretch long,
// gravity is barely there. The canvas's auto-fit zooms us to whatever the
// layout converges on, so it's fine for the cluster to be wider than the
// nominal canvas dims.
const REPULSION = 26000
const SPRING_LEN = 260
const SPRING_K = 0.028
const GRAVITY = 0.0018
const DAMPING = 0.82
const MAX_VELOCITY = 26

/**
 * Run the simulation synchronously and return final node positions.
 * Deterministic given the same seed-ordering of `ids`.
 */
export function runForceLayout(input: LayoutInput): Record<string, { x: number; y: number; radius: number }> {
  const { ids, edges, radii = {}, width, height } = input
  const iterations = input.iterations ?? 300
  const cx = width / 2
  const cy = height / 2

  // Initial placement: concentric rings so things don't all start at the
  // center (which would make the first repulsion step explode).
  const nodes: LayoutNode[] = ids.map((id, i) => {
    const ring = Math.floor(Math.sqrt(i))
    const angle = (i / Math.max(1, ids.length)) * Math.PI * 2
    const r = 40 + ring * 70
    return {
      id,
      x: cx + Math.cos(angle) * r,
      y: cy + Math.sin(angle) * r,
      vx: 0,
      vy: 0,
      radius: radii[id] ?? 6,
    }
  })

  const idx = new Map(nodes.map((n, i) => [n.id, i]))

  for (let step = 0; step < iterations; step++) {
    // Coulomb repulsion: O(n²) pairwise. Fine up to ~150 nodes.
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]
        const b = nodes[j]
        const dx = b.x - a.x
        const dy = b.y - a.y
        const dist2 = dx * dx + dy * dy + 1
        const force = REPULSION / dist2
        const dist = Math.sqrt(dist2)
        const fx = (dx / dist) * force
        const fy = (dy / dist) * force
        a.vx -= fx
        a.vy -= fy
        b.vx += fx
        b.vy += fy
      }
    }

    // Hooke springs along edges.
    for (const e of edges) {
      const ai = idx.get(e.source)
      const bi = idx.get(e.target)
      if (ai === undefined || bi === undefined) continue
      const a = nodes[ai]
      const b = nodes[bi]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const dist = Math.sqrt(dx * dx + dy * dy) + 0.01
      const displacement = dist - SPRING_LEN
      const fx = (dx / dist) * displacement * SPRING_K
      const fy = (dy / dist) * displacement * SPRING_K
      a.vx += fx
      a.vy += fy
      b.vx -= fx
      b.vy -= fy
    }

    // Gravity toward center + damping + integrate.
    for (const n of nodes) {
      n.vx += (cx - n.x) * GRAVITY
      n.vy += (cy - n.y) * GRAVITY
      n.vx *= DAMPING
      n.vy *= DAMPING
      // clamp insane velocities so a single bad pair can't slingshot a node
      const speed = Math.sqrt(n.vx * n.vx + n.vy * n.vy)
      if (speed > MAX_VELOCITY) {
        n.vx = (n.vx / speed) * MAX_VELOCITY
        n.vy = (n.vy / speed) * MAX_VELOCITY
      }
      n.x += n.vx
      n.y += n.vy
    }
  }

  const out: Record<string, { x: number; y: number; radius: number }> = {}
  for (const n of nodes) {
    out[n.id] = { x: n.x, y: n.y, radius: n.radius }
  }
  return out
}
