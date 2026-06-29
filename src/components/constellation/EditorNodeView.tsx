import { useEffect, useRef, useState } from 'react'
import Editor, { type BeforeMount, type OnMount } from '@monaco-editor/react'
import type * as MonacoNs from 'monaco-editor'
import { ArrowLeft, FileCode, Save, Check } from 'lucide-react'
import { getTheme, subscribeTheme } from '../../theme'
import { registerAllMonacoThemes, monacoThemeName } from '../../themes/monacoThemes'

/**
 * Single-file Monaco editor mounted inline inside the constellation when a
 * node is zoomed. Independent of the classic EditorArea (no tabs, no
 * codelens, no command palette wiring) — this is the constellation's own
 * file view.
 *
 * Lifecycle:
 *   - Mount: animate from scale(0) at the origin point → scale(1) full size
 *   - Fetch file content via /api/file
 *   - Save on Cmd/Ctrl+S → POST /api/file
 *   - Esc → calls onClose (parent animates back to constellation)
 */

interface Props {
  /** Workspace-relative path the node represents. */
  path: string
  /** Pixel position of the source node in the canvas — drives the grow-from origin. */
  originX: number
  originY: number
  onClose: () => void
}

export default function EditorNodeView({ path, originX, originY, onClose }: Props) {
  const [content, setContent] = useState<string | null>(null)
  const [savedContent, setSavedContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savedFlash, setSavedFlash] = useState(false)
  const editorRef = useRef<MonacoNs.editor.IStandaloneCodeEditor | null>(null)

  const [appTheme, setAppTheme] = useState(() => getTheme())
  useEffect(() => subscribeTheme((t) => setAppTheme(t)), [])

  useEffect(() => {
    let cancelled = false
    setContent(null)
    setError(null)
    fetch(`/api/file?path=${encodeURIComponent(path)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((data: { content: string }) => {
        if (cancelled) return
        setContent(data.content ?? '')
        setSavedContent(data.content ?? '')
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message)
      })
    return () => { cancelled = true }
  }, [path])

  // Esc anywhere closes the editor — global so the user doesn't have to
  // focus the editor surface first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const save = async () => {
    if (content === null) return
    try {
      const r = await fetch('/api/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, content }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      setSavedContent(content)
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 1200)
    } catch (e) {
      setError(`Save failed: ${(e as Error).message}`)
    }
  }

  const beforeMount: BeforeMount = (monaco) => {
    registerAllMonacoThemes(monaco)
  }
  const onMount: OnMount = (ed, monaco) => {
    editorRef.current = ed
    ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => save())
    ed.updateOptions({ tabSize: 2 })
    setTimeout(() => ed.focus(), 50)
  }

  const dirty = content !== null && content !== savedContent
  const language = languageFromPath(path)

  return (
    <div
      style={{
        ...wrapStyle,
        // Grow-from-node origin — CSS animation interpolates scale around this.
        transformOrigin: `${originX}px ${originY}px`,
      }}
      className="cn-editor-grow"
    >
      <div style={headerStyle}>
        <button type="button" className="ct-pill" onClick={onClose} title="Back to constellation (Esc)" style={{ gap: 5 }}>
          <ArrowLeft size={12} />
          <span>back</span>
        </button>
        <FileCode size={14} style={{ color: 'var(--accent-2)', flexShrink: 0 }} />
        <span style={{ fontFamily: 'var(--font-mono, ui-monospace, monospace)', fontSize: 12.5, color: 'var(--text)' }}>{path}</span>
        {dirty && (
          <span style={{ fontSize: 11, color: 'var(--warning)' }}>● unsaved</span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: 'var(--text-faint)', fontFamily: 'var(--font-mono, ui-monospace, monospace)' }}>esc</span>
          <button
            type="button"
            className="ct-pill"
            onClick={save}
            disabled={!dirty}
            style={{
              gap: 5,
              opacity: dirty ? 1 : 0.5,
              cursor: dirty ? 'pointer' : 'default',
              background: dirty ? 'color-mix(in srgb, var(--accent) 22%, var(--panel-2))' : undefined,
              color: dirty ? 'var(--text)' : undefined,
            }}
            title="Save (⌘S)"
          >
            {savedFlash ? <Check size={12} /> : <Save size={12} />}
            <span>{savedFlash ? 'saved' : 'save'}</span>
          </button>
        </div>
      </div>

      <div style={bodyStyle}>
        {error && <div style={errStyle}>Couldn't load {path}: {error}</div>}
        {!error && content === null && <div style={loadingStyle}>Opening {path}…</div>}
        {!error && content !== null && (
          <Editor
            height="100%"
            value={content}
            language={language}
            theme={monacoThemeName(appTheme)}
            beforeMount={beforeMount}
            onMount={onMount}
            onChange={(v) => setContent(v ?? '')}
            options={{
              fontSize: 13,
              fontFamily: "'JetBrains Mono', ui-monospace, monospace",
              fontLigatures: true,
              minimap: { enabled: true, scale: 1 },
              smoothScrolling: true,
              cursorSmoothCaretAnimation: 'on',
              scrollBeyondLastLine: false,
              automaticLayout: true,
            }}
          />
        )}
      </div>
    </div>
  )
}

function languageFromPath(p: string): string {
  const ext = p.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript',
    js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
    py: 'python', go: 'go', rs: 'rust', rb: 'ruby', php: 'php',
    java: 'java', kt: 'kotlin', c: 'c', cpp: 'cpp', cs: 'csharp',
    json: 'json', md: 'markdown', html: 'html', css: 'css', scss: 'scss',
    yaml: 'yaml', yml: 'yaml', toml: 'toml', sh: 'shell',
  }
  return map[ext] ?? 'plaintext'
}

const wrapStyle: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--bg)',
  border: '1px solid var(--accent)',
  borderRadius: 10,
  overflow: 'hidden',
  boxShadow: 'var(--shadow-strong, 0 24px 80px rgba(0,0,0,0.6))',
  zIndex: 5,
}

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '8px 12px',
  borderBottom: '0.5px solid var(--border-soft)',
  background: 'var(--panel)',
  flexShrink: 0,
}

const bodyStyle: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  position: 'relative',
}

const loadingStyle: React.CSSProperties = {
  width: '100%', height: '100%', display: 'grid', placeItems: 'center',
  color: 'var(--text-dim)', fontSize: 13,
}
const errStyle: React.CSSProperties = {
  ...loadingStyle, color: 'var(--red)',
}
