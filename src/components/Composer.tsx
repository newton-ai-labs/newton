import { useEffect, useRef, useState } from 'react'
import { X, Wand2, FilePlus2, Check, ChevronDown, ChevronRight, Loader2, Sparkles } from 'lucide-react'
import { useStore } from '../store'
import type { ComposerFileChange } from '../../shared/types'

interface PendingFile {
  path: string
  content: string
}

export default function Composer() {
  const composerOpen = useStore((s) => s.composerOpen)
  const setComposerOpen = useStore((s) => s.setComposerOpen)
  const tabs = useStore((s) => s.tabs)
  const activeTabId = useStore((s) => s.activeTabId)
  const tree = useStore((s) => s.tree)
  const openFile = useStore((s) => s.openFile)
  const applyCodeToFile = useStore((s) => s.applyCodeToFile)
  const toast = useStore((s) => s.toast)
  const refreshTree = useStore((s) => s.refreshTree)
  const settings = useStore((s) => s.settings)

  const [instruction, setInstruction] = useState('')
  const [pendingFiles, setPendingFiles] = useState<PendingFile[]>([])
  const [results, setResults] = useState<ComposerFileChange[] | null>(null)
  const [summary, setSummary] = useState('')
  const [busy, setBusy] = useState(false)
  const [expandedChanges, setExpandedChanges] = useState<Record<number, boolean>>({})
  const [showFilePicker, setShowFilePicker] = useState(false)

  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Auto-include active file + all open dirty files as pending context
  useEffect(() => {
    if (composerOpen) {
      const initial: PendingFile[] = []
      const seen = new Set<string>()
      // active file first
      const active = tabs.find((t) => t.id === activeTabId)
      if (active && !seen.has(active.path)) {
        initial.push({ path: active.path, content: active.content })
        seen.add(active.path)
      }
      // then other open tabs
      for (const t of tabs) {
        if (!seen.has(t.path) && t.content.trim()) {
          initial.push({ path: t.path, content: t.content })
          seen.add(t.path)
        }
      }
      setPendingFiles(initial.slice(0, 8)) // cap at 8 files
      setResults(null)
      setInstruction('')
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [composerOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  // Esc to close
  useEffect(() => {
    if (!composerOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setComposerOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [composerOpen, setComposerOpen])

  if (!composerOpen) return null

  const submit = async () => {
    if (!instruction.trim() || pendingFiles.length === 0 || busy) return
    setBusy(true)
    setResults(null)
    try {
      const cfg =
        settings.provider === 'demo'
          ? { provider: 'demo' as const, model: 'demo' }
          : {
              provider: settings.provider,
              model: settings.providerConfigs[settings.provider]?.model || 'demo',
              apiKey: settings.providerConfigs[settings.provider]?.apiKey || undefined,
              baseUrl: settings.providerConfigs[settings.provider]?.baseUrl || undefined,
            }
      const r = await fetch('/api/composer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instruction: instruction.trim(),
          provider: cfg,
          files: pendingFiles,
        }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = await r.json()
      setResults(data.changes || [])
      setSummary(data.summary || '')
      // expand all diffs by default
      const expanded: Record<number, boolean> = {}
      ;(data.changes || []).forEach((_: any, i: number) => (expanded[i] = true))
      setExpandedChanges(expanded)
    } catch (e) {
      toast(`Composer failed: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  const acceptChange = async (change: ComposerFileChange, index: number) => {
    await applyCodeToFile(change.path, change.after)
    // mark applied
    setResults((prev) =>
      prev ? prev.map((c, i) => (i === index ? { ...c, status: 'applied' } : c)) : null,
    )
  }

  const rejectChange = (index: number) => {
    setResults((prev) =>
      prev ? prev.map((c, i) => (i === index ? { ...c, status: 'rejected' } : c)) : null,
    )
  }

  const acceptAll = async () => {
    if (!results) return
    for (let i = 0; i < results.length; i++) {
      const c = results[i]
      if (c.status === 'pending') {
        await acceptChange(c, i)
      }
    }
    await refreshTree()
    toast(`Applied ${results.filter((r) => r.status !== 'rejected').length} change(s)`)
    setComposerOpen(false)
  }

  const removePendingFile = (path: string) => {
    setPendingFiles((p) => p.filter((f) => f.path !== path))
  }

  const addFileFromTree = async (path: string) => {
    if (pendingFiles.some((f) => f.path === path)) return
    try {
      const r = await fetch(`/api/file?path=${encodeURIComponent(path)}`)
      if (!r.ok) return
      const data = await r.json()
      setPendingFiles((p) => [...p, { path, content: data.content ?? '' }])
    } catch {
      /* ignore */
    }
    setShowFilePicker(false)
  }

  // Flatten tree for file picker
  const allFiles: string[] = []
  if (tree) {
    const walk = (n: any) => {
      if (n.type === 'file') allFiles.push(n.path)
      n.children?.forEach(walk)
    }
    walk(tree)
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        backdropFilter: 'blur(2px)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: 80,
      }}
      onClick={() => setComposerOpen(false)}
    >
      <div
        className="composer-modal"
        style={{
          width: 'min(800px, 92vw)',
          maxHeight: '80vh',
          background: 'var(--bg-sidebar)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '12px 16px',
            borderBottom: '1px solid var(--border)',
          }}
        >
          <Wand2 size={18} style={{ color: 'var(--blue)' }} />
          <span style={{ fontWeight: 600, fontSize: 15 }}>Composer</span>
          <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>
            Multi-file AI editing
          </span>
          <div style={{ flex: 1 }} />
          <button
            className="mini-btn"
            style={{ width: 24, height: 24 }}
            onClick={() => setComposerOpen(false)}
          >
            <X size={14} />
          </button>
        </div>

        {/* Pending context files */}
        <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--border)' }}>
          <div
            style={{
              fontSize: 11,
              color: 'var(--text-faint)',
              marginBottom: 6,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span style={{ fontWeight: 600 }}>Context ({pendingFiles.length})</span>
            <button
              className="mini-btn"
              style={{ fontSize: 10, padding: '1px 6px', display: 'flex', gap: 3, alignItems: 'center' }}
              onClick={() => setShowFilePicker(!showFilePicker)}
            >
              <FilePlus2 size={11} /> Add file
            </button>
          </div>
          {showFilePicker && (
            <div
              style={{
                maxHeight: 150,
                overflowY: 'auto',
                border: '1px solid var(--border)',
                borderRadius: 6,
                marginBottom: 8,
                background: 'var(--bg)',
              }}
            >
              {allFiles
                .filter((p) => !pendingFiles.some((f) => f.path === p))
                .slice(0, 100)
                .map((p) => (
                  <div
                    key={p}
                    className="tree-row"
                    style={{ fontSize: 12 }}
                    onClick={() => addFileFromTree(p)}
                  >
                    <span style={{ paddingLeft: 22 }} />
                    <span className="name">{p}</span>
                  </div>
                ))}
            </div>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
            {pendingFiles.map((f) => (
              <span
                key={f.path}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  fontSize: 11,
                  background: 'color-mix(in srgb, var(--blue) 14%, transparent)',
                  color: 'var(--blue)',
                  padding: '2px 8px',
                  borderRadius: 4,
                }}
              >
                {f.path.split('/').pop()}
                <button
                  onClick={() => removePendingFile(f.path)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0, display: 'flex' }}
                >
                  <X size={11} />
                </button>
              </span>
            ))}
            {pendingFiles.length === 0 && (
              <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                No files in context. Click "Add file".
              </span>
            )}
          </div>
        </div>

        {/* Instruction input */}
        <div style={{ padding: 16 }}>
          <textarea
            ref={inputRef}
            className="input"
            style={{
              width: '100%',
              minHeight: 80,
              resize: 'vertical',
              fontSize: 14,
              fontFamily: 'var(--font-sans)',
            }}
            placeholder="Describe the changes you want across these files… (e.g. 'extract the validation logic into a shared util and update all call sites')"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                submit()
              }
            }}
            disabled={busy}
          />
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginTop: 8,
            }}
          >
            <button
              className="btn-primary"
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
              onClick={submit}
              disabled={!instruction.trim() || pendingFiles.length === 0 || busy}
            >
              {busy ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}
              {busy ? 'Generating…' : 'Generate'}
            </button>
            <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
              ⌘+Enter to generate
            </span>
          </div>
        </div>

        {/* Results */}
        {results !== null && (
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              borderTop: '1px solid var(--border)',
            }}
          >
            {summary && (
              <div
                style={{
                  padding: '8px 16px',
                  fontSize: 12,
                  color: 'var(--text-dim)',
                  background: 'var(--bg-elevated)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <Sparkles size={12} style={{ color: 'var(--blue)' }} />
                {summary}
              </div>
            )}

            {results.length === 0 && (
              <div
                style={{
                  padding: 24,
                  textAlign: 'center',
                  color: 'var(--text-faint)',
                  fontSize: 13,
                }}
              >
                No changes proposed. Try a different instruction or add more files to context.
              </div>
            )}

            {results.map((change, i) => {
              const expanded = expandedChanges[i] ?? false
              return (
                <div
                  key={i}
                  style={{
                    borderBottom: '1px solid var(--border)',
                    padding: '10px 16px',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      marginBottom: 4,
                    }}
                  >
                    <button
                      onClick={() =>
                        setExpandedChanges((p) => ({ ...p, [i]: !p[i] }))
                      }
                      className="mini-btn"
                      style={{ width: 18, height: 18, padding: 0 }}
                    >
                      {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </button>
                    <code style={{ fontSize: 12, color: 'var(--text)' }}>
                      {change.path}
                    </code>
                    <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                      {change.description}
                    </span>
                    <div style={{ flex: 1 }} />
                    {change.status === 'pending' && (
                      <>
                        <button
                          className="mini-btn"
                          style={{
                            fontSize: 11,
                            padding: '3px 8px',
                            color: 'var(--green)',
                          }}
                          onClick={() => acceptChange(change, i)}
                        >
                          <Check size={12} /> Accept
                        </button>
                        <button
                          className="mini-btn"
                          style={{ fontSize: 11, padding: '3px 8px' }}
                          onClick={() => rejectChange(i)}
                        >
                          <X size={12} /> Reject
                        </button>
                      </>
                    )}
                    {change.status === 'applied' && (
                      <span
                        style={{
                          fontSize: 11,
                          color: 'var(--green)',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                        }}
                      >
                        <Check size={12} /> Applied
                      </span>
                    )}
                    {change.status === 'rejected' && (
                      <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                        Rejected
                      </span>
                    )}
                  </div>

                  {expanded && (
                    <pre
                      style={{
                        fontSize: 11,
                        fontFamily: 'var(--font-mono)',
                        background: 'var(--bg)',
                        border: '1px solid var(--border)',
                        borderRadius: 6,
                        padding: 8,
                        overflow: 'auto',
                        maxHeight: 250,
                        margin: '4px 0 0',
                        color: 'var(--text-dim)',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                      }}
                    >
                      {change.after.slice(0, 3000)}
                      {change.after.length > 3000 ? '\n… (truncated)' : ''}
                    </pre>
                  )}
                </div>
              )
            })}

            {results.length > 0 && results.some((r) => r.status === 'pending') && (
              <div style={{ padding: 16 }}>
                <button
                  className="btn-primary"
                  style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
                  onClick={acceptAll}
                >
                  <Check size={14} /> Accept All & Apply
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}