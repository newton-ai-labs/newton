import { useEffect, useState } from 'react'

/**
 * Shared graph cache so the canvas and the prompt HUD (and anything else
 * that lands later) don't each fetch /api/graph independently. Module-level
 * means the cache survives component remounts within a session.
 *
 * For now the graph is treated as immutable for the session — if the user
 * adds files, they need to refresh to see them. Phase 5+ may add invalidation.
 */

export interface GraphResponse {
  nodes: Record<string, { id: string; path: string; lineCount: number; imports: string[] }>
  edges: Array<{ source: string; target: string }>
  reverseEdges?: Record<string, string[]>
  stats?: { fileCount: number; edgeCount: number }
}

let cached: GraphResponse | null = null
let inflight: Promise<GraphResponse> | null = null
const subscribers = new Set<(g: GraphResponse) => void>()

function fetchGraph(): Promise<GraphResponse> {
  if (inflight) return inflight
  inflight = fetch('/api/graph')
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`graph ${r.status}`))))
    .then((data: GraphResponse) => {
      cached = data
      for (const fn of subscribers) fn(data)
      inflight = null
      return data
    })
    .catch((e) => {
      inflight = null
      throw e
    })
  return inflight
}

export function useGraph(): { graph: GraphResponse | null; error: string | null } {
  const [graph, setGraph] = useState<GraphResponse | null>(cached)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (cached) {
      setGraph(cached)
      return
    }
    let cancelled = false
    const onData = (g: GraphResponse) => { if (!cancelled) setGraph(g) }
    subscribers.add(onData)
    fetchGraph().catch((e) => { if (!cancelled) setError((e as Error).message) })
    return () => {
      cancelled = true
      subscribers.delete(onData)
    }
  }, [])

  return { graph, error }
}

/**
 * Return the 1-hop neighbors of a node — files it imports AND files that
 * import it. Capped so we don't accidentally attach a hub file's entire
 * neighborhood (e.g. App.tsx might be imported by 30 places).
 */
export function neighborsOf(graph: GraphResponse, nodeId: string, limit = 8): string[] {
  if (!graph.nodes[nodeId]) return []
  const out: string[] = []
  const seen = new Set<string>()
  // forward: who the node imports
  for (const t of graph.nodes[nodeId].imports ?? []) {
    if (graph.nodes[t] && !seen.has(t)) { seen.add(t); out.push(t) }
    if (out.length >= limit) return out
  }
  // reverse: who imports the node
  const inbound = graph.reverseEdges?.[nodeId] ?? []
  for (const s of inbound) {
    if (graph.nodes[s] && !seen.has(s)) { seen.add(s); out.push(s) }
    if (out.length >= limit) return out
  }
  return out
}
