import { useEffect, useRef, useState } from 'react'
import Editor, { type OnMount, type BeforeMount } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import type * as MonacoNs from 'monaco-editor'
import { X, Sparkles } from 'lucide-react'
import { useStore, type EditorTab } from '../store'
import { fileIcon, fileColor } from './fileIcons'
import InlineEditWidget from './InlineEditWidget'
import { registerCopilot } from '../ghostCompletions'

export default function EditorArea() {
  const tabs = useStore((s) => s.tabs)
  const activeTabId = useStore((s) => s.activeTabId)
  const setActiveTab = useStore((s) => s.setActiveTab)
  const closeTab = useStore((s) => s.closeTab)
  const updateTabContent = useStore((s) => s.updateTabContent)
  const saveActiveTab = useStore((s) => s.saveActiveTab)
  const settings = useStore((s) => s.settings)
  const setSettingsOpen = useStore((s) => s.setSettingsOpen)

  const active = tabs.find((t) => t.id === activeTabId) ?? null

  if (!active) {
    return (
      <div className="editor-area">
        <div className="editor-host">
          <div className="empty-state">
            <div className="big-logo">N</div>
            <h2>Welcome to Newton</h2>
            <p>
              An AI-native code editor that runs in your browser. Edit files from
              this workspace, chat with the built-in AI assistant, and connect a
              real LLM provider for full power.
            </p>
            <div className="quick">
              <button className="chip-btn" onClick={() => setSettingsOpen(true)}>
                <Sparkles size={12} style={{ marginRight: 6, verticalAlign: '-2px' }} />
                Configure AI
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="editor-area">
      <div className="tab-bar">
        {tabs.map((t) => (
          <Tab
            key={t.id}
            tab={t}
            active={t.id === activeTabId}
            onClick={() => setActiveTab(t.id)}
            onClose={() => closeTab(t.id)}
          />
        ))}
      </div>
      <div className="editor-host">
        <CodeView
          key={active.id}
          tab={active}
          onChange={(v) => updateTabContent(active.id, v ?? '')}
          onSave={() => saveActiveTab()}
          fontSize={settings.fontSize}
        />
      </div>
    </div>
  )
}

function Tab({
  tab,
  active,
  onClick,
  onClose,
}: {
  tab: EditorTab
  active: boolean
  onClick: () => void
  onClose: () => void
}) {
  const Icon = fileIcon(tab.name)
  const color = fileColor(tab.name)
  const dirty = tab.content !== tab.savedContent
  return (
    <div className={`tab ${active ? 'active' : ''} ${dirty ? 'dirty' : ''}`} onClick={onClick}>
      <span style={{ color }}>
        <Icon size={14} />
      </span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{tab.name}</span>
      {dirty ? (
        <span className="dirty-dot" onClick={(e) => { e.stopPropagation(); onClose() }} />
      ) : (
        <span className="close" onClick={(e) => { e.stopPropagation(); onClose() }}>
          <X size={12} />
        </span>
      )}
    </div>
  )
}

function CodeView({
  tab,
  onChange,
  onSave,
  fontSize,
}: {
  tab: EditorTab
  onChange: (v: string | undefined) => void
  onSave: () => void
  fontSize: number
}) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const [editorInst, setEditorInst] = useState<editor.IStandaloneCodeEditor | null>(null)
  const [monacoInst, setMonacoInst] = useState<typeof MonacoNs | null>(null)

  const beforeMount: BeforeMount = (monaco) => {
    // Define a custom dark theme once
    monaco.editor.defineTheme('newton-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '5a5f7a', fontStyle: 'italic' },
        { token: 'keyword', foreground: '7c5cff' },
        { token: 'string', foreground: '4ade80' },
        { token: 'number', foreground: 'fbbf24' },
        { token: 'type', foreground: '00d4ff' },
        { token: 'function', foreground: '60a5fa' },
        { token: 'variable', foreground: 'e6e8f0' },
      ],
      colors: {
        'editor.background': '#0d0f1a',
        'editor.foreground': '#e6e8f0',
        'editorLineNumber.foreground': '#3a4068',
        'editorLineNumber.activeForeground': '#9398b8',
        'editor.selectionBackground': '#7c5cff40',
        'editor.lineHighlightBackground': '#141726',
        'editorCursor.foreground': '#00d4ff',
        'editorIndentGuide.background': '#1a1d30',
        'editorIndentGuide.activeBackground': '#2a2f48',
        'editorWidget.background': '#141726',
        'editorWidget.border': '#232842',
        'editorSuggestWidget.background': '#141726',
        'editorSuggestWidget.selectedBackground': '#1b1f30',
        'input.background': '#0e1019',
        'input.border': '#232842',
      },
    })
    monaco.editor.defineTheme('newton-light', {
      base: 'vs',
      inherit: true,
      rules: [],
      colors: {
        'editor.background': '#ffffff',
      },
    })
  }

  const onMount: OnMount = (ed, monaco) => {
    editorRef.current = ed
    setEditorInst(ed)
    setMonacoInst(monaco)
    // Ctrl/Cmd+S to save
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      onSave()
    })
    // Format on the active doc
    ed.updateOptions({ tabSize: 2 })

    // Newton Copilot: ghost-text completions (Tab to accept)
    const copilot = registerCopilot(monaco)
    // Ensure inline suggestions are enabled
    ed.updateOptions({ inlineSuggest: { enabled: true } })
    // store disposable on editor for cleanup
    const copilotDispose = copilot
    ;(ed as unknown as { _copilotDispose?: () => void })._copilotDispose =
      copilotDispose.dispose
  }

  // keep settings font in sync
  useEffect(() => {
    editorRef.current?.updateOptions({ fontSize })
  }, [fontSize])

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <Editor
        height="100%"
        beforeMount={beforeMount}
        onMount={onMount}
        theme="newton-dark"
        language={tab.language}
        value={tab.content}
        onChange={onChange}
        loading={<div style={{ padding: 20, color: '#5a5f7a' }}>Loading editor…</div>}
        options={{
          fontSize,
          fontFamily: "'JetBrains Mono', ui-monospace, monospace",
          fontLigatures: true,
          minimap: { enabled: true, scale: 1 },
          smoothScrolling: true,
          cursorSmoothCaretAnimation: 'on',
          cursorBlinking: 'smooth',
          renderLineHighlight: 'all',
          scrollBeyondLastLine: false,
          padding: { top: 14, bottom: 14 },
          lineNumbers: 'on',
          roundedSelection: true,
          automaticLayout: true,
          bracketPairColorization: { enabled: true },
          guides: { bracketPairs: true, indentation: true },
          scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
          wordWrap: 'off',
          fixedOverflowWidgets: true,
        }}
      />
      {editorInst && monacoInst && (
        <InlineEditWidget
          editor={editorInst}
          monaco={monacoInst}
          tabId={tab.id}
          language={tab.language}
          filePath={tab.path}
        />
      )}
    </div>
  )
}
