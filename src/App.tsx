import { useEffect, useState, lazy, Suspense } from 'react'
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
  AlertCircle,
  ListTree,
} from 'lucide-react'
import { useStore } from './store'
import ErrorBoundary from './components/ErrorBoundary'

// Core components loaded immediately
import FileExplorer from './components/FileExplorer'
import EditorArea from './components/EditorArea'
import ChatPanel from './components/ChatPanel'
import CommandPalette from './components/CommandPalette'
import ThemePicker from './components/ThemePicker'
import ConstellationLayout from './components/constellation/ConstellationLayout'

// Lazy-loaded components for code splitting
const SettingsModal = lazy(() => import('./components/SettingsModal'))
const TerminalPanel = lazy(() => import('./components/TerminalPanel'))
const VoicePanel = lazy(() => import('./components/VoicePanel'))
const SourceControlPanel = lazy(() => import('./components/SourceControlPanel'))
const GraphPanel = lazy(() => import('./components/GraphPanel'))
const MemoryPanel = lazy(() => import('./components/MemoryPanel'))
const MissionPanel = lazy(() => import('./components/MissionPanel'))
const SearchPanel = lazy(() => import('./components/SearchPanel'))
const OutlinePanel = lazy(() => import('./components/OutlinePanel'))
const ProblemsPanel = lazy(() => import('./components/ProblemsPanel').then(m => ({ default: m.ProblemsPanel })))
const Composer = lazy(() => import('./components/Composer'))
const FixPreviewModal = lazy(() => import('./components/FixPreviewModal'))

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
  const loadMemory = useStore((s) => s.loadMemory)

  useEffect(() => {
    refreshTree()
    loadMemory()
  }, [refreshTree, loadMemory])

  // global shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key === 'p') {
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

  // Constellation layout opt-in. Renders the new shell entirely outside the
  // classic layout below — they don't share chrome. Settings modal still
  // works (mounted by the constellation shell too).
  if (settings.layout === 'constellation') {
    return (
      <ErrorBoundary>
        <ConstellationLayout />
        <Suspense fallback={null}>
          <SettingsModal />
        </Suspense>
      </ErrorBoundary>
    )
  }

  return (
    <ErrorBoundary>
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
            className={`activity-btn ${activeView === 'outline' ? 'active' : ''}`}
            title="Symbol Outline"
            onClick={() => {
              if (activeView === 'outline' && sidebarVisible) setSidebarVisible(false)
              else {
                setActiveView('outline')
                setSidebarVisible(true)
              }
            }}
          >
            <ListTree size={19} />
          </button>
          <button
            className={`activity-btn ${activeView === 'problems' ? 'active' : ''}`}
            title="Problems & Diagnostics"
            onClick={() => {
              if (activeView === 'problems' && sidebarVisible) setSidebarVisible(false)
              else {
                setActiveView('problems')
                setSidebarVisible(true)
              }
            }}
          >
            <AlertCircle size={20} />
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
        <ThemePicker className="activity-btn" />
        <button
          className="activity-btn"
          title="Settings (⌘,)"
          onClick={() => setSettingsOpen(true)}
        >
          <SettingsIcon size={20} />
        </button>
      </div>

      {/* Main */}
      <div className="main-area">
        <PanelGroup direction="horizontal" className="main">
          {sidebarVisible && (
            <>
              <Panel defaultSize={20} minSize={12} maxSize={40} className="sidebar-panel" order={1}>
                <Suspense fallback={<div className="panel-loading">Loading...</div>}>
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
                  ) : activeView === 'search' ? (
                    <SearchPanel />
                  ) : activeView === 'outline' ? (
                    <OutlinePanel />
                  ) : activeView === 'problems' ? (
                    <ProblemsPanel
                      onOpenFile={(p: string, line?: number) => {
                        // Open the file at the diagnostic location
                        useStore.getState().openFile(p).then(() => {
                          if (line) {
                            // Reveal the line in the editor after a short delay
                            setTimeout(() => {
                              const event = new CustomEvent('newton:goto-line', { detail: { line, column: 1 } })
                              window.dispatchEvent(event)
                            }, 200)
                          }
                        })
                      }}
                    />
                  ) : (
                    <FileExplorer />
                  )}
                </Suspense>
              </Panel>
              <PanelResizeHandle className="resize-handle" />
            </>
          )}

          <Panel minSize={30} order={2}>
            <div className="editor-and-terminal">
              <EditorArea />
              {terminalOpen && (
                <Suspense fallback={<div className="panel-loading">Loading terminal...</div>}>
                  <TerminalPanel />
                </Suspense>
              )}
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
      <Suspense fallback={null}>
        <SettingsModal />
        <VoicePanel />
        <Composer />
        <FixPreviewModal />
      </Suspense>
      <CommandPalette />
    </div>
    </ErrorBoundary>
  )
}
