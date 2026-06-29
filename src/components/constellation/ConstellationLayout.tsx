import { useEffect, useMemo, useState } from 'react'
import { Settings as SettingsIcon, Command, X } from 'lucide-react'
import { useStore } from '../../store'
import ThemePicker from '../ThemePicker'
import ConstellationCanvas from './ConstellationCanvas'
import EditorNodeView from './EditorNodeView'
import PromptHUD from './PromptHUD'
import SessionPanel from './SessionPanel'
import ConstellationPalette from './ConstellationPalette'
import { useFirstRun, markOnboarded } from './useFirstRun'
import { useCodebaseHealth } from './useCodebaseHealth'
import NodeDetailsPanel from './NodeDetailsPanel'

/**
 * Constellation layout — the new Newton shell.
 *
 * Phase 1: the canvas + a thin top bar.
 * Phase 2: clicking a node "zooms in" — Monaco grows out of the node into a
 *          full editor; Esc/back returns to the constellation.
 *
 * Lives behind settings.layout === 'constellation'. The classic VS-Code-style
 * layout stays the default until the constellation has feature parity.
 */
export default function ConstellationLayout() {
  const setSettingsOpen = useStore((s) => s.setSettingsOpen)
  const setPaletteOpen = useStore((s) => s.setPaletteOpen)
  const workspacePath = useStore((s) => s.workspacePath)
  const loadMissions = useStore((s) => s.loadMissions)

  // Classic layout fetches missions when the user opens Mission Control;
  // in constellation that panel never mounts, so the sessions list in
  // ⌘K would be empty without this. Cheap fire-and-forget.
  useEffect(() => { loadMissions() }, [loadMissions])
  // The active mission's step state drives the canvas activity overlay.
  // We pull straight from the store so the canvas re-renders on each SSE tick.
  const activeMission = useStore((s) => s.activeMission)
  const missions = useStore((s) => s.missions)
  const liveMission = activeMission
    ? missions.find((m) => m.id === activeMission.id) ?? activeMission
    : null

  // Codebase health overlay — diagnostics + git status per file. Auto-
  // refetches on window focus so it stays current after tests/commits.
  const { byPath: healthByPath } = useCodebaseHealth()

  // Currently-running step paths → pulsing accent. Completed step paths →
  // soft green "recently touched" mark. Recomputed every render but only
  // changes when mission.steps changes (cheap O(n)).
  const { activeNodeIds, touchedNodeIds } = useMemo(() => {
    if (!liveMission) return { activeNodeIds: new Set<string>(), touchedNodeIds: new Set<string>() }
    const active = new Set<string>()
    const touched = new Set<string>()
    for (const s of liveMission.steps) {
      if (!s.path) continue
      if (s.status === 'running') active.add(s.path)
      else if (s.status === 'done' || s.status === 'skipped') touched.add(s.path)
    }
    return { activeNodeIds: active, touchedNodeIds: touched }
  }, [liveMission])

  // The "selected" node (focus ring on canvas) and the "zoomed" node (editor
  // is open on that file) are tracked separately so a user can pre-select
  // without committing to editing — though right now click triggers both.
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  // Track the most-recent screen-space position of the focus node so the
  // session panel can anchor itself there.
  const [focusPos, setFocusPos] = useState<{ x: number; y: number } | null>(null)
  const [zoomed, setZoomed] = useState<{ path: string; originX: number; originY: number } | null>(null)
  // When set, the canvas animates to center on this node. Cleared after
  // the canvas reports completion (or when the user takes manual control).
  const [flyTo, setFlyTo] = useState<string | null>(null)

  // First-run state. firstRun captured once on mount (so toggling Settings
  // mid-session doesn't fire the animation twice). hintVisible is a
  // separate flag that we set false when the user dismisses or the
  // auto-fade timeout finishes.
  const firstRun = useFirstRun()
  const [hintVisible, setHintVisible] = useState(firstRun)
  useEffect(() => { if (firstRun) setHintVisible(true) }, [firstRun])
  useEffect(() => {
    if (!firstRun) return
    // Mark onboarded once the user has had ~7s with the hint visible.
    // Earlier dismiss also marks (handled in the X click).
    const t = window.setTimeout(() => { markOnboarded(); setHintVisible(false) }, 7000)
    return () => window.clearTimeout(t)
  }, [firstRun])

  // Single-click selects a node and opens the right-side details drawer
  // (mockup-inspired flow). Does NOT open the editor — that's a deliberate
  // second step via double-click or the drawer's "View in editor" button.
  const handleSelect = (nodeId: string, screenPos: { x: number; y: number } | null) => {
    setSelectedNode(nodeId)
    setFocusPos(screenPos)
  }

  // Double-click (or "View full file in editor" from the drawer) skips the
  // exploratory drawer and grows the editor straight from the node's pixel.
  const handleOpen = (nodeId: string, screenPos: { x: number; y: number } | null) => {
    setSelectedNode(nodeId)
    setFocusPos(screenPos)
    setZoomed({
      path: nodeId,
      originX: screenPos?.x ?? window.innerWidth / 2,
      originY: screenPos?.y ?? window.innerHeight / 2,
    })
  }

  // Global ⌘K / ⌘P open the palette (constellation layout has its own
  // keybindings since App's classic-mode hook doesn't run here).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && (e.key === 'k' || e.key === 'p')) {
        e.preventDefault()
        setPaletteOpen(true)
      } else if (mod && e.key === ',') {
        e.preventDefault()
        setSettingsOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setPaletteOpen, setSettingsOpen])

  // Palette dispatches `newton:focus-node` when the user picks a file. Fly
  // the canvas to it and open the details drawer — same as a single-click.
  useEffect(() => {
    const onFocus = (e: Event) => {
      const detail = (e as CustomEvent<{ nodeId: string }>).detail
      if (!detail?.nodeId) return
      setSelectedNode(detail.nodeId)
      setFocusPos(null)  // unknown until canvas reports back
      setFlyTo(detail.nodeId)
    }
    window.addEventListener('newton:focus-node', onFocus)
    return () => window.removeEventListener('newton:focus-node', onFocus)
  }, [])

  return (
    <div style={shellStyle}>
      <div style={topBarStyle}>
        <div style={brandStyle}>
          <div style={logoMarkStyle}>N</div>
          <span style={{ color: 'var(--text)', fontWeight: 500, fontSize: 13 }}>Newton</span>
          <span style={{ color: 'var(--text-faint)' }}>·</span>
          <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>
            {workspacePath ? workspacePath.split('/').pop() : 'workspace'}
          </span>
          {selectedNode && (
            <>
              <span style={{ color: 'var(--text-faint)' }}>·</span>
              <span style={{ color: 'var(--text-dim)', fontSize: 12, fontFamily: 'var(--font-mono, ui-monospace, monospace)' }}>
                {selectedNode}
              </span>
            </>
          )}
        </div>

        <div style={topBarActionsStyle}>
          <button
            type="button"
            className="ct-pill"
            onClick={() => setPaletteOpen(true)}
            title="Command palette (⌘K)"
            aria-label="Command palette"
          >
            <Command size={12} />
            <span>K</span>
          </button>
          <ThemePicker />
          <button
            type="button"
            className="ct-icon-btn"
            onClick={() => setSettingsOpen(true)}
            title="Settings"
            aria-label="Settings"
          >
            <SettingsIcon size={15} />
          </button>
        </div>
      </div>

      <div style={canvasWrapStyle}>
        <ConstellationCanvas
          selectedId={selectedNode}
          onSelect={handleSelect}
          onOpen={handleOpen}
          dimmed={!!zoomed}
          activeNodeIds={activeNodeIds}
          touchedNodeIds={touchedNodeIds}
          flyToNodeId={flyTo}
          onFlyComplete={() => setFlyTo(null)}
          firstRun={firstRun}
          healthByPath={healthByPath}
        />
        {zoomed && (
          <EditorNodeView
            key={zoomed.path}
            path={zoomed.path}
            originX={zoomed.originX}
            originY={zoomed.originY}
            onClose={() => setZoomed(null)}
          />
        )}
        {/* First-run hint floating above the prompt. Self-fades after ~6s. */}
        {hintVisible && (
          <div className="cn-onboard-hint" role="status">
            <span className="cn-onboard-hint-dot" />
            <span>Click any node to explore, or ask Newton anything from the prompt.</span>
            <button
              type="button"
              onClick={() => { markOnboarded(); setHintVisible(false) }}
              aria-label="Dismiss hint"
              title="Got it"
            >
              <X size={12} />
            </button>
          </div>
        )}
        {/* Prompt HUD stays visible even when the editor is open, so the
            user can ask about the file they're editing without going back. */}
        <PromptHUD focusNodeId={zoomed?.path ?? selectedNode} />
        {/* Active mission card anchored near the focus node (collapsed) or
            pinned to the right edge (expanded). Self-hiding when there's
            no active mission. */}
        <SessionPanel anchorX={focusPos?.x ?? null} anchorY={focusPos?.y ?? null} />

        {/* Right-side details drawer for the focused node. Single-click on
            a constellation node opens this; the "View in editor" button or
            a double-click on the node opens the Monaco editor. */}
        {selectedNode && !zoomed && (
          <NodeDetailsPanel
            nodeId={selectedNode}
            onClose={() => setSelectedNode(null)}
            onOpenInEditor={(id) => handleOpen(id, focusPos)}
          />
        )}
      </div>

      {/* ⌘K / ⌘P palette — global nav. Self-hides when settings.paletteOpen
          is false. Dispatches `newton:focus-node` for file picks. */}
      <ConstellationPalette />
    </div>
  )
}

const shellStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--bg)',
  color: 'var(--text)',
}

const topBarStyle: React.CSSProperties = {
  height: 40,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '0 14px',
  borderBottom: '0.5px solid var(--border-soft)',
  background: 'var(--panel)',
  flexShrink: 0,
}

const brandStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
}

const topBarActionsStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
}

const logoMarkStyle: React.CSSProperties = {
  width: 20,
  height: 20,
  borderRadius: 5,
  background: 'var(--accent-grad, var(--accent))',
  display: 'grid',
  placeItems: 'center',
  color: '#fff',
  fontWeight: 700,
  fontSize: 11,
}

const canvasWrapStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  position: 'relative',
}
