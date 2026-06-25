import { useEffect, useRef, useState } from 'react'
import type { editor } from 'monaco-editor'
import { Sparkles, Check, X, Loader2, ChevronRight } from 'lucide-react'
import { useStore } from '../store'

interface Props {
  editor: editor.IStandaloneCodeEditor
  monaco: typeof import('monaco-editor')
  tabId: string
  language: string
  filePath: string
}

interface PendingEdit {
  original: string
  edited: string
  range: { startLine: number; startCol: number; endLine: number; endCol: number }
  note?: string
}

/**
 * ⌘K inline AI edit with a diff preview overlay.
 * Operates on the current selection, or the whole file if nothing is selected.
 */
export default function InlineEditWidget({ editor, monaco, tabId, language, filePath }: Props) {
  const runInlineEdit = useStore((s) => s.runInlineEdit)
  const busy = useStore((s) => s.inlineEditBusy)
  const updateTabContent = useStore((s) => s.updateTabContent)

  const [open, setOpen] = useState(false)
  const [instruction, setInstruction] = useState('')
  const [pending, setPending] = useState<PendingEdit | null>(null)
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const widgetMounted = useRef(false)

  // register ⌘K command on the editor via an action (returns IDisposable)
  useEffect(() => {
    const action = editor.addAction({
      id: 'newton-inline-edit',
      label: 'Newton: Inline Edit',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK],
      run: () => openWidget(),
    })
    return () => action.dispose()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, monaco])

  function openWidget() {
    const sel = editor.getSelection()
    const pos = sel ?? editor.getPosition()
    if (!pos) return

    // Selection has startLineNumber/startColumn; Position has lineNumber/column
    const p = pos as any
    const line = p.startLineNumber ?? p.lineNumber
    const col = p.startColumn ?? p.column

    // get pixel coords (relative to editor content) for the selection start
    const scrolled = editor.getScrolledVisiblePosition({
      lineNumber: line,
      column: col,
    })
    const dom = editor.getDomNode()
    const layout = dom?.getBoundingClientRect()
    if (scrolled && layout) {
      const top = Math.max(8, Math.min(scrolled.top - 60, layout.height - 70))
      const left = Math.max(8, Math.min(scrolled.left + 24, layout.width - 440))
      setCoords({ top, left })
    } else if (layout) {
      setCoords({ top: 12, left: 24 })
    }

    setPending(null)
    setInstruction('')
    setOpen(true)
    setTimeout(() => inputRef.current?.focus(), 30)
  }

  // Monaco owns this shortcut when editor focus is perfect; this fallback covers
  // browser focus edge cases while staying scoped to the active editor DOM.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod || e.key.toLowerCase() !== 'k' || open) return

      const dom = editor.getDomNode()
      const active = document.activeElement
      if (!dom || !active || !dom.contains(active)) return

      e.preventDefault()
      e.stopPropagation()
      openWidget()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, open])

  function close() {
    setOpen(false)
    setPending(null)
    setInstruction('')
    editor.focus()
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const sel = editor.getSelection()
    const model = editor.getModel()
    if (!sel || !model) return

    const hasSel = !sel.isEmpty()
    const code = hasSel
      ? model.getValueInRange(sel)
      : model.getValue()

    const result = await runInlineEdit(code, instruction, language, filePath)
    if (!result) return
    if (result.code === code) {
      // nothing changed
      setPending({
        original: code,
        edited: code,
        range: {
          startLine: sel.startLineNumber,
          startCol: sel.startColumn,
          endLine: sel.endLineNumber,
          endCol: sel.endColumn,
        },
        note: result.note ?? 'No change.',
      })
      return
    }

    setPending({
      original: code,
      edited: result.code,
      range: {
        startLine: sel.startLineNumber,
        startCol: sel.startColumn,
        endLine: sel.endLineNumber,
        endCol: sel.endColumn,
      },
      note: result.note,
    })
  }

  function accept() {
    if (!pending) return
    const model = editor.getModel()
    if (!model) return

    const sel = editor.getSelection()
    const hasSel = !!sel && !sel.isEmpty()

    if (hasSel && sel) {
      // replace selection
      editor.executeEdits('inline-edit', [
        {
          range: sel,
          text: pending.edited,
          forceMoveMarkers: true,
        },
      ])
    } else {
      // replace whole file via store (so React state stays in sync)
      const full = model.getValue()
      const next = full === pending.original ? pending.edited : full
      updateTabContent(tabId, next)
      // also push into the monaco model
      model.setValue(next)
    }
    close()
  }

  function reject() {
    close()
  }

  // Escape to close
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, busy])

  // keep widget mounted reference stable
  useEffect(() => {
    widgetMounted.current = true
    return () => {
      widgetMounted.current = false
    }
  }, [])

  if (!open || !coords) return null

  return (
    <div
      className="inline-edit-overlay"
      style={{
        position: 'absolute',
        top: coords.top,
        left: coords.left,
        zIndex: 50,
      }}
    >
      {!pending ? (
        <form className="inline-edit-form" onSubmit={submit}>
          <Sparkles size={14} className="ie-icon" />
          <input
            ref={inputRef}
            className="ie-input"
            placeholder={busy ? 'Generating edit…' : 'Describe the edit… (⌘K)'}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            disabled={busy}
          />
          {busy ? (
            <Loader2 size={14} className="ie-spin" />
          ) : (
            <button type="submit" className="ie-go" title="Generate (Enter)">
              <ChevronRight size={14} />
            </button>
          )}
          <button type="button" className="ie-x" onClick={close} title="Close (Esc)">
            <X size={13} />
          </button>
        </form>
      ) : (
        <div className="inline-edit-diff">
          <div className="ied-head">
            <Sparkles size={13} />
            <span>AI edit preview</span>
            <span className="spacer" />
            <button className="ied-btn accept" onClick={accept} title="Accept (Enter)">
              <Check size={13} /> Accept
            </button>
            <button className="ied-btn reject" onClick={reject} title="Reject (Esc)">
              <X size={13} /> Reject
            </button>
          </div>
          <DiffView before={pending.original} after={pending.edited} language={language} />
          {pending.note && <div className="ied-note">{pending.note}</div>}
        </div>
      )}
    </div>
  )
}

// ---------- minimal line-level diff ----------
function DiffView({ before, after, language }: { before: string; after: string; language: string }) {
  const a = before.split('\n')
  const b = after.split('\n')
  // LCS-based line diff
  const ops = lineDiff(a, b)
  return (
    <div className="diff-body">
      {ops.map((op, i) => {
        if (op.type === 'eq') {
          return (
            <div key={i} className="diff-line ctx">
              <span className="ln">{op.a}</span>
              <code>{op.text}</code>
            </div>
          )
        }
        if (op.type === 'del') {
          return (
            <div key={i} className="diff-line del">
              <span className="ln">{op.a}</span>
              <code>{op.text}</code>
            </div>
          )
        }
        return (
          <div key={i} className="diff-line add">
            <span className="ln">{op.b}</span>
            <code>{op.text}</code>
          </div>
        )
      })}
      {/* keep language referenced for potential syntax highlight later */}
      <span style={{ display: 'none' }}>{language}</span>
    </div>
  )
}

type DiffOp =
  | { type: 'eq'; text: string; a: number; b: number }
  | { type: 'del'; text: string; a: number; b?: undefined }
  | { type: 'add'; text: string; b: number; a?: undefined }

function lineDiff(a: string[], b: string[]): DiffOp[] {
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const ops: DiffOp[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: 'eq', text: a[i], a: i + 1, b: j + 1 })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: 'del', text: a[i], a: i + 1 })
      i++
    } else {
      ops.push({ type: 'add', text: b[j], b: j + 1 })
      j++
    }
  }
  while (i < n) {
    ops.push({ type: 'del', text: a[i], a: i + 1 })
    i++
  }
  while (j < m) {
    ops.push({ type: 'add', text: b[j], b: j + 1 })
    j++
  }
  return ops
}
