import { useEffect, useState, useMemo } from 'react'
import { ListTree, ChevronRight, FunctionSquare, Box, Circle } from 'lucide-react'
import { useStore } from '../store'
import { detectSymbolsInText, type DetectedSymbol } from '../codeLens'

const KIND_META: Record<string, { Icon: any; color: string; label: string }> = {
  function: { Icon: FunctionSquare, color: 'var(--blue)', label: 'Function' },
  class: { Icon: Box, color: 'var(--yellow)', label: 'Class' },
  method: { Icon: Circle, color: 'var(--green)', label: 'Method' },
}

function kindMeta(kind: string) {
  return KIND_META[kind] ?? { Icon: Circle, color: 'var(--text-faint)', label: kind }
}

export default function OutlinePanel() {
  const activeTab = useStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const content = activeTab?.content ?? ''

  // Recompute symbols (debounced via React state on content change).
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const id = setTimeout(() => setTick((t) => t + 1), 200)
    return () => clearTimeout(id)
  }, [content])

  const symbols: DetectedSymbol[] = useMemo(() => {
    if (!activeTab) return []
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    tick // depend on tick so the debounce triggers a recompute
    return detectSymbolsInText(content)
  }, [content, tick, activeTab])

  const goToLine = (line: number) => {
    const event = new CustomEvent('newton:goto-line', { detail: { line, column: 1 } })
    window.dispatchEvent(event)
  }

  if (!activeTab) {
    return (
      <div className="sidebar">
        <div className="sidebar-header">
          <span>Outline</span>
        </div>
        <div className="scm-empty">
          <ListTree size={32} style={{ opacity: 0.3, marginBottom: 12 }} />
          <p>No active editor.</p>
          <p style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 6 }}>
            Open a file to see its symbol outline.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <span>Outline</span>
        <span className="scm-count" style={{ marginLeft: 'auto', marginRight: 8 }}>
          {symbols.length}
        </span>
      </div>

      <div className="sidebar-subheader" title={activeTab.path}>
        {activeTab.name}
      </div>

      {symbols.length === 0 ? (
        <div className="scm-empty">
          <ListTree size={28} style={{ opacity: 0.3, marginBottom: 8 }} />
          <p>No symbols detected in this file.</p>
        </div>
      ) : (
        <div className="outline-list">
          {symbols.map((sym) => {
            const meta = kindMeta(sym.kind)
            const { Icon } = meta
            return (
              <button
                key={`${sym.name}-${sym.startLine}`}
                className="outline-row"
                title={`${meta.label}: ${sym.name} (line ${sym.startLine})`}
                onClick={() => goToLine(sym.startLine)}
              >
                <Icon size={13} style={{ color: meta.color, flexShrink: 0 }} />
                <span className="outline-name">{sym.name}</span>
                <span className="outline-kind">{sym.kind}</span>
                <ChevronRight size={12} className="outline-go" />
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}