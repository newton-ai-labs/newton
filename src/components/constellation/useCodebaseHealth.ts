import { useEffect, useState } from 'react'
import { useStore } from '../../store'

/**
 * Codebase health snapshot — diagnostics + git status combined into
 * per-node-id lookups. The constellation canvas reads these to render
 * "this file has errors" + "this file is dirty" overlays on the right
 * nodes.
 *
 * Refetched on:
 *   - mount (initial paint)
 *   - window focus (cheap UX win after terminal/git work)
 *   - mission terminal transition (so dots reflect post-mission state)
 *
 * Also exposes a manual `refresh()` for callers that know they've
 * changed something.
 */

export interface NodeHealth {
  errors: number
  warnings: number
  /** git status: 'M' modified, 'A' added, 'D' deleted, 'U' untracked, '?' untracked, undefined = clean */
  gitStatus?: string
}

interface Diagnostic { filePath: string; severity: 'error' | 'warning' }
interface DiagnosticsResult { diagnostics: Diagnostic[] }
interface GitChange { path: string; status: string }
interface GitStatusResult { initialized: boolean; changes: GitChange[] }

const cache: {
  diag: DiagnosticsResult | null
  scm: GitStatusResult | null
} = { diag: null, scm: null }

export function useCodebaseHealth(): {
  byPath: Map<string, NodeHealth>
  totalErrors: number
  totalWarnings: number
  dirtyCount: number
} {
  const [diag, setDiag] = useState<DiagnosticsResult | null>(cache.diag)
  const [scm, setScm] = useState<GitStatusResult | null>(cache.scm)
  // Watch for mission terminal transitions. When a mission flips from
  // running → done/failed/cancelled, files on disk likely changed, so
  // diagnostics + git status are stale. The terminal-status string is
  // the dependency that retriggers our fetch effect.
  const missionTerminalState = useStore((s) => {
    const m = s.activeMission ? s.missions.find((x) => x.id === s.activeMission!.id) ?? s.activeMission : null
    if (!m) return ''
    if (m.status === 'done' || m.status === 'failed' || m.status === 'cancelled') {
      return `${m.id}:${m.status}:${m.updatedAt}`
    }
    return ''
  })
  // Diagnostics-refresh CustomEvent is dispatched by the classic
  // FixPreviewModal apply flow — keep listening in constellation too.
  const [externalNonce, setExternalNonce] = useState(0)

  useEffect(() => {
    let cancelled = false
    // First fetch of the session is plain GET (server cache OK). Subsequent
    // refetches triggered by mission completion need a real re-check, so
    // we POST /api/diagnostics/refresh which clears the server's lastDiag.
    const isInitial = cache.diag === null
    const fetchBoth = async () => {
      try {
        const diagPromise = isInitial
          ? fetch('/api/diagnostics').then((r) => (r.ok ? r.json() : null))
          : fetch('/api/diagnostics/refresh', { method: 'POST' }).then((r) => (r.ok ? r.json() : null))
        const [dRes, sRes] = await Promise.all([
          diagPromise,
          fetch('/api/git/status').then((r) => (r.ok ? r.json() : null)),
        ])
        if (cancelled) return
        if (dRes) { cache.diag = dRes; setDiag(dRes) }
        if (sRes) { cache.scm = sRes; setScm(sRes) }
      } catch {
        /* health is advisory — silent failures keep the constellation usable */
      }
    }
    fetchBoth()
    // Re-fetch when the window regains focus — cheap UX win for switching
    // from terminal back to Newton after running tests/git commit.
    const onFocus = () => fetchBoth()
    const onDiagRefresh = () => setExternalNonce((n) => n + 1)
    window.addEventListener('focus', onFocus)
    window.addEventListener('newton:diagnostics-refresh', onDiagRefresh)
    return () => {
      cancelled = true
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('newton:diagnostics-refresh', onDiagRefresh)
    }
    // Re-runs on mission terminal transition + external refresh nonce.
  }, [missionTerminalState, externalNonce])

  // Build a single per-path map combining both signals.
  const byPath = new Map<string, NodeHealth>()
  const getOrInit = (p: string): NodeHealth => {
    let h = byPath.get(p)
    if (!h) { h = { errors: 0, warnings: 0 }; byPath.set(p, h) }
    return h
  }

  let totalErrors = 0, totalWarnings = 0
  if (diag?.diagnostics) {
    for (const d of diag.diagnostics) {
      const h = getOrInit(d.filePath)
      if (d.severity === 'error') { h.errors++; totalErrors++ }
      else { h.warnings++; totalWarnings++ }
    }
  }
  let dirtyCount = 0
  if (scm?.changes) {
    for (const c of scm.changes) {
      const h = getOrInit(c.path)
      h.gitStatus = c.status
      dirtyCount++
    }
  }

  return { byPath, totalErrors, totalWarnings, dirtyCount }
}
