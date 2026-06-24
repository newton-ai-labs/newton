import { useEffect, useMemo, useState } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import {
  Files,
  Search as SearchIcon,
  Settings as SettingsIcon,
  Sparkles,
  Command,
  PanelLeft,
  PanelRight,
  Terminal as TermIcon,
  Mic,
  FlaskConical,
  GitBranch,
  Network,
  Brain,
  Rocket,
  X,
} from 'lucide-react'
import { useStore } from './store'
import FileExplorer from './components/FileExplorer'
import EditorArea from './components/EditorArea'
import ChatPanel from './components/ChatPanel'
import SettingsModal from './components/SettingsModal'
import CommandPalette from './components/CommandPalette'
import TerminalPanel from './components/TerminalPanel'
import VoicePanel from './components/VoicePanel'
import SourceControlPanel from './components/SourceControlPanel'
import GraphPanel from './components/GraphPanel'
import MemoryPanel from './components/MemoryPanel'
import MissionPanel from './components/MissionPanel'
import Composer from './components/Composer'

export default function App() {
  const refreshTree = useStore((s) => s.refreshTree)
  const setPaletteOpen = useStore((s) => s.setPaletteOpen)
  const setSettingsOpen = useStore((s) => s.setSettingsOpen)
  const sidebarVisible = useStore((s) => s.sidebarVisible)
  const chatVisible = useStore((s) => s.chatVisible)
  const setSidebarVisible = useStore((s) => s.setSidebarVisible)
  const setChatVisible = useStore((s) => s.setChatVisible)
  const activeView = useStore((s) => s.activeView)
  const setActiveView = useStore((s) => s.setActiveView)
  const tree = useStore((s) => s.tree)
  const activeTab = useStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const toasts = useStore((s) => s.toasts)
  const settings = useStore((s) => s.settings)
  const terminalOpen = useStore((s) => s.terminalOpen)
  const setTerminalOpen = useStore((s) => s.setTerminalOpen)
  const setVoiceOpen = useStore((s) => s.setVoiceOpen)
  const setComposerOpen = useStore((s) => s.setComposerOpen)
  const generateTests = useStore((s) => s.generateTests)
  const genTestsBusy = useStore((s) => s.genTestsBusy)
  const gitStatus = useStore((s) => s.gitStatus)
  const memory = useStore((s) => s.memory)
  const loadMemory = useStore((s) => s.loadMemory)
  const [welcomeDismissed, setWelcomeDismissed] = useState(false)

  useEffect(() => {
    refreshTree()
    loadMemory()
  }, [refreshTree, loadMemory])

  // Show welcome banner once per session when we have a digest and it hasn't been dismissed
  const welcomeDigest = useStore((s) => s.welcomeDigest)
  const showWelcome = !welcomeDismissed && !!welcomeDigest && !!memory

  // global shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key === 'p') {
        e.preventDefault()
        setPaletteOpen(true)
      } else if (mod && e.key === 'k') {
        e.preventDefault()
        setPaletteOpen(true)
      } else if (mod && e.key === 's') {
        // monaco handles editor save, but also support top-level
        // (monaco stops propagation when focused, so this is a fallback)
      } else if (mod && e.key === ',') {
        e.preventDefault()
        setSettingsOpen(true)
      } else if (mod && e.key === 'b') {
        e.preventDefault()
        setSidebarVisible(!sidebarVisible)
      } else if (mod && e.key === 'j') {
        e.preventDefault()
        setChatVisible(!chatVisible)
      } else if (mod && e.shiftKey && e.key === 'i') {
        e.preventDefault()
        setChatVisible(!chatVisible)
      } else if (e.ctrlKey && e.key === '`') {
        e.preventDefault()
        setTerminalOpen(!terminalOpen)
      } else if (mod && e.shiftKey && e.key === 'v') {
        e.preventDefault()
        setVoiceOpen(true)
      } else if (mod && e.shiftKey && e.key === 't') {
        e.preventDefault()
        generateTests()
      } else if (mod && e.key === 'i') {
        e.preventDefault()
        setComposerOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    setPaletteOpen,
    setSettingsOpen,
    sidebarVisible,
    chatVisible,
    setSidebarVisible,
    setChatVisible,
    terminalOpen,
    setTerminalOpen,
    setVoiceOpen,
    generateTests,
    setComposerOpen,
  ])

  const dirty = activeTab && activeTab.content !== activeTab.savedContent

  return (
    <div className="app">
     <div className="app-body">
      {/* Activity Bar */}
      <div className="activity-bar">
        <div className="logo-mark">N</div>
        <div className="activity-icons">
          <button
            className={`activity-btn ${activeView === 'explorer' && sidebarVisible ? 'active' : ''}`}
            title="Explorer (⌘B)"
            onClick={() => {
              if (activeView === 'explorer' && sidebarVisible) setSidebarVisible(false)
              else {
                setActiveView('explorer')
                setSidebarVisible(true)
              }
            }}
          >
            <Files size={20} />
          </button>
          <button
            className={`activity-btn ${activeView === 'search' ? 'active' : ''}`}
            title="Search"
            onClick={() => {
              setActiveView('search')
              setSidebarVisible(true)
            }}
          >
            <SearchIcon size={20} />
          </button>
          <button
            className={`activity-btn ${activeView === 'graph' ? 'active' : ''}`}
            title="Architecture Graph"
            onClick={() => {
              if (activeView === 'graph' && sidebarVisible) setSidebarVisible(false)
              else {
                setActiveView('graph')
                setSidebarVisible(true)
              }
            }}
          >
            <Network size={20} />
          </button>
          <button
            className={`activity-btn ${activeView === 'scm' ? 'active' : ''}`}
            title="Source Control (⌃G)"
            onClick={() => {
              if (activeView === 'scm' && sidebarVisible) setSidebarVisible(false)
              else {
                setActiveView('scm')
                setSidebarVisible(true)
              }
            }}
          >
            <GitBranch size={20} />
            {gitStatus && gitStatus.changes.length > 0 && (
              <span className="activity-badge">{gitStatus.changes.length}</span>
            )}
          </button>
          <button
            className={`activity-btn ${activeView === 'memory' ? 'active' : ''}`}
            title="Workspace Memory"
            onClick={() => {
              if (activeView === 'memory' && sidebarVisible) setSidebarVisible(false)
              else {
                setActiveView('memory')
                setSidebarVisible(true)
              }
            }}
          >
            <Brain size={19} />
          </button>
          <button
            className={`activity-btn ${activeView === 'mission' ? 'active' : ''}`}
            title="Mission Control"
            onClick={() => {
              if (activeView === 'mission' && sidebarVisible) setSidebarVisible(false)
              else {
                setActiveView('mission')
                setSidebarVisible(true)
              }
            }}
          >
            <Rocket size={19} />
          </button>
          <button
            className={`activity-btn ${terminalOpen ? 'active' : ''}`}
            title="Terminal (⌃`)"
            onClick={() => setTerminalOpen(!terminalOpen)}
          >
            <TermIcon size={19} />
          </button>
          <button
            className="activity-btn"
            title="Voice Coding (⌘⇧V)"
            onClick={() => setVoiceOpen(true)}
          >
            <Mic size={19} />
          </button>
        </div>
        <div style={{ flex: 1 }} />
        <button
          className="activity-btn"
          title="Command Palette (⌘P)"
          onClick={() => setPaletteOpen(true)}
        >
          <Command size={19} />
        </button>
        <button
          className="activity-btn"
          title="Settings (⌘,)"
          onClick={() => setSettingsOpen(true)}
        >
          <SettingsIcon size={20} />
        </button>
      </div>

      {/* Welcome Back banner */}
      {showWelcome && (
        <div
          style={{
            padding: '8px 14px',
            background: 'linear-gradient(90deg, color-mix(in srgb, var(--blue) 18%, transparent), transparent)',
            borderBottom: '1px solid var(--border)',
            fontSize: 12,
            color: 'var(--text)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <Sparkles size={13} className="spark" style={{ color: 'var(--blue)' }} />
          <span style={{ flex: 1 }}>{welcomeDigest}</span>
          <button
            className="mini-btn"
            style={{ width: 18, height: 18 }}
            onClick={() => setWelcomeDismissed(true)}
            title="Dismiss"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* Main */}
      <div className="main-area">
        <PanelGroup direction="horizontal" className="main">
          {sidebarVisible && (
            <>
              <Panel defaultSize={20} minSize={12} maxSize={40} className="sidebar-panel" order={1}>
                {activeView === 'explorer' ? (
                  <FileExplorer />
                ) : activeView === 'scm' ? (
                  <SourceControlPanel />
                ) : activeView === 'graph' ? (
                  <GraphPanel />
                ) : activeView === 'memory' ? (
                  <MemoryPanel />
                ) : activeView === 'mission' ? (
                  <MissionPanel />
                ) : (
                  <SearchView />
                )}
              </Panel>
              <PanelResizeHandle className="resize-handle" />
            </>
          )}

          <Panel minSize={30} order={2}>
            <div className="editor-and-terminal">
              <EditorArea />
              {terminalOpen && <TerminalPanel />}
            </div>
          </Panel>

          {chatVisible && (
            <>
              <PanelResizeHandle className="resize-handle" />
              <Panel defaultSize={32} minSize={18} maxSize={55} order={3}>
                <ChatPanel />
              </Panel>
            </>
          )}
        </PanelGroup>
      </div>
     </div>

      {/* Status Bar */}
      <div className="status-bar">
        <div className="status-left">
          <button
            className="status-btn"
            title="Toggle Sidebar"
            onClick={() => setSidebarVisible(!sidebarVisible)}
          >
            <PanelLeft size={13} />
          </button>
          {tree && <span className="status-item">{tree.path === '.' ? 'workspace' : tree.path}</span>}
          {dirty && <span className="status-item" style={{ color: 'var(--yellow)' }}>● unsaved</span>}
          {activeTab && (
            <button
              className="status-btn gen-tests-btn"
              title="Generate tests (⌘⇧T)"
              onClick={generateTests}
              disabled={genTestsBusy}
            >
              <FlaskConical size={12} /> {genTestsBusy ? 'Generating…' : 'Gen Tests'}
            </button>
          )}
        </div>
        <div className="status-center">
          {activeTab && (
            <>
              <span className="status-item">{activeTab.language}</span>
              <span className="status-item">UTF-8</span>
              <span className="status-item">LF</span>
            </>
          )}
        </div>
        <div className="status-right">
          <span className="status-item provider-badge">
            <Sparkles size={11} className="spark" />
            {settings.provider === 'demo' ? 'Demo' : settings.provider}
            {settings.provider !== 'demo' && (
              <> · {settings.providerConfigs[settings.provider]?.model}</>
            )}
          </span>
          <button
            className="status-btn"
            title="Toggle Terminal (⌃`)"
            onClick={() => setTerminalOpen(!terminalOpen)}
          >
            <TermIcon size={13} />
          </button>
          <button
            className="status-btn"
            title="Toggle AI Panel"
            onClick={() => setChatVisible(!chatVisible)}
          >
            <PanelRight size={13} />
          </button>
        </div>
      </div>

      {/* Toasts */}
      <div className="toast-stack">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            {t.text}
          </div>
        ))}
      </div>

      {/* Overlays */}
      <SettingsModal />
      <CommandPalette />
      <VoicePanel />
      <Composer />
    </div>
  )
}

function SearchView() {
  const tree = useStore((s) => s.tree)
  const openFile = useStore((s) => s.openFile)
  const [q, setQ] = useState('')
  const [mode, setMode] = useState<'semantic' | 'files'>('semantic')
  const [semanticResults, setSemanticResults] = useState<any[]>([])
  const [searching, setSearching] = useState(false)

  // Filename results (instant, client-side)
  const fileResults = useMemo(() => {
    if (!q.trim() || !tree) return [] as { path: string; name: string }[]
    const out: { path: string; name: string }[] = []
    const walk = (n: any) => {
      if (n.type === 'file' && n.path.toLowerCase().includes(q.toLowerCase())) {
        out.push({ path: n.path, name: n.name })
      }
      n.children?.forEach(walk)
    }
    walk(tree)
    return out.slice(0, 50)
  }, [q, tree])

  // Semantic results (debounced, server-side TF-IDF)
  useEffect(() => {
    if (mode !== 'semantic' || !q.trim()) {
      setSemanticResults([])
      return
    }
    setSearching(true)
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `${import.meta.env.VITE_API_BASE || ''}/api/search?q=${encodeURIComponent(q)}&limit=15`,
        )
        if (res.ok) {
          const data = await res.json()
          setSemanticResults(data.hits || [])
        }
      } catch {
        /* ignore */
      } finally {
        setSearching(false)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [q, mode])

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <span>Search</span>
        <div style={{ display: 'flex', gap: 2 }}>
          <button
            className={`mini-btn ${mode === 'semantic' ? 'active' : ''}`}
            style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4 }}
            onClick={() => setMode('semantic')}
            title="Semantic code search (TF-IDF)"
          >
            Code
          </button>
          <button
            className={`mini-btn ${mode === 'files' ? 'active' : ''}`}
            style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4 }}
            onClick={() => setMode('files')}
            title="Search by filename"
          >
            Files
          </button>
        </div>
      </div>
      <div style={{ padding: 8 }}>
        <input
          className="input"
          placeholder={mode === 'semantic' ? 'Search code semantically…' : 'Search files by name…'}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus
        />
      </div>
      <div className="file-tree">
        {q.trim() === '' && (
          <div style={{ color: 'var(--text-faint)', fontSize: 12.5, padding: 8 }}>
            {mode === 'semantic'
              ? '🔍 Semantic search finds code by meaning — try "where is auth handled?" or "database connection"'
              : 'Type to search files. Use ⌘P for the command palette.'}
          </div>
        )}

        {/* Semantic results */}
        {mode === 'semantic' && q.trim() !== '' && (
          <>
            {searching && (
              <div style={{ color: 'var(--text-faint)', fontSize: 12, padding: '8px 12px' }}>
                Searching codebase…
              </div>
            )}
            {!searching && semanticResults.length === 0 && (
              <div style={{ color: 'var(--text-faint)', fontSize: 12.5, padding: 8 }}>
                No code matches. Try different keywords.
              </div>
            )}
            {semanticResults.map((hit, i) => (
              <div
                key={`${hit.filePath}-${i}`}
                className="search-result"
                onClick={() => openFile(hit.filePath)}
                title={hit.filePath}
                style={{ cursor: 'pointer', padding: '6px 10px', borderBottom: '1px solid var(--border)' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                  <span
                    style={{
                      fontSize: 9.5,
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      color: 'var(--blue)',
                      background: 'color-mix(in srgb, var(--blue) 14%, transparent)',
                      padding: '1px 5px',
                      borderRadius: 3,
                    }}
                  >
                    {hit.kind || 'code'}
                  </span>
                  <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--text)' }}>
                    {hit.symbol || hit.filePath.split('/').pop()}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 3 }}>
                  {hit.filePath}:{hit.startLine}-{hit.endLine}
                </div>
                <pre
                  style={{
                    fontSize: 10.5,
                    color: 'var(--text-dim)',
                    background: 'var(--bg-elevated)',
                    padding: '4px 6px',
                    borderRadius: 4,
                    overflow: 'hidden',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    maxHeight: 48,
                    margin: 0,
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  {hit.snippet}
                </pre>
              </div>
            ))}
          </>
        )}

        {/* File results */}
        {mode === 'files' && q.trim() !== '' && fileResults.length === 0 && (
          <div style={{ color: 'var(--text-faint)', fontSize: 12.5, padding: 8 }}>
            No files found.
          </div>
        )}
        {mode === 'files' &&
          fileResults.map((r) => (
            <div
              key={r.path}
              className="tree-row"
              onClick={() => openFile(r.path)}
              title={r.path}
            >
              <span style={{ paddingLeft: 22 }} />
              <span className="name" style={{ fontSize: 12.5 }}>{r.path}</span>
            </div>
          ))}
      </div>
    </div>
  )
}
