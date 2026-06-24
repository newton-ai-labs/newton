import { useEffect, useRef, useState } from 'react'
import { X, Play, Sparkles, Terminal as TermIcon } from 'lucide-react'
import { useStore } from '../store'

interface Line {
  id: number
  type: 'input' | 'output' | 'error' | 'nl' | 'system'
  text: string
}

let lineId = 0

export default function TerminalPanel() {
  const terminalOpen = useStore((s) => s.terminalOpen)
  const setTerminalOpen = useStore((s) => s.setTerminalOpen)
  const translateNlsh = useStore((s) => s.translateNlsh)
  const execCommand = useStore((s) => s.execCommand)
  const refreshTree = useStore((s) => s.refreshTree)

  const [lines, setLines] = useState<Line[]>([
    { id: lineId++, type: 'system', text: 'Newton Terminal — type English or shell commands' },
  ])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [nlMode, setNlMode] = useState(true)
  const [history, setHistory] = useState<string[]>([])
  const [histIdx, setHistIdx] = useState(-1)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight)
  }, [lines])

  if (!terminalOpen) return null

  const push = (type: Line['type'], text: string) =>
    setLines((l) => [...l, { id: lineId++, type, text }])

  const runCommand = async (cmd: string) => {
    setBusy(true)
    push('input', cmd)
    setHistory((h) => [...h, cmd])
    setHistIdx(-1)
    try {
      const result = await execCommand(cmd)
      if (result.stdout) push('output', result.stdout.trimEnd())
      if (result.stderr) push('error', result.stderr.trimEnd())
      if (!result.stdout && !result.stderr) push('output', '(no output)')
      if (result.code !== 0) push('error', `exit code: ${result.code}`)
      // refresh file tree after commands that might change the FS
      if (/\b(git|npm|mkdir|touch|rm|mv|cp|echo)\b/.test(cmd)) {
        setTimeout(() => refreshTree(), 300)
      }
    } catch (e) {
      push('error', (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const onSubmit = async () => {
    const v = input.trim()
    if (!v || busy) return
    setInput('')

    if (nlMode) {
      push('nl', `💬 ${v}`)
      setBusy(true)
      const cmd = await translateNlsh(v)
      if (cmd && !cmd.startsWith('#')) {
        push('system', `→ ${cmd}`)
        setBusy(false)
        await runCommand(cmd)
      } else if (cmd) {
        push('error', cmd)
        setBusy(false)
      } else {
        push('error', 'Could not translate.')
        setBusy(false)
      }
    } else {
      await runCommand(v)
    }
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      onSubmit()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (history.length === 0) return
      const idx = histIdx < 0 ? history.length - 1 : Math.max(0, histIdx - 1)
      setHistIdx(idx)
      setInput(history[idx])
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (histIdx < 0) return
      const idx = histIdx + 1
      if (idx >= history.length) {
        setHistIdx(-1)
        setInput('')
      } else {
        setHistIdx(idx)
        setInput(history[idx])
      }
    } else if (e.ctrlKey && e.key === 'l') {
      e.preventDefault()
      setLines([])
    }
  }

  return (
    <div className="terminal-panel">
      <div className="terminal-header">
        <div className="term-tabs">
          <span className="term-tab active">
            <TermIcon size={12} /> Terminal
          </span>
        </div>
        <div className="terminal-actions">
          <button
            className={`nl-toggle ${nlMode ? 'on' : ''}`}
            onClick={() => setNlMode(!nlMode)}
            title="Toggle natural-language mode"
          >
            <Sparkles size={11} /> {nlMode ? 'NL ON' : 'NL OFF'}
          </button>
          <button className="term-close" onClick={() => setTerminalOpen(false)} title="Close (⌃\`)">
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="terminal-body" ref={scrollRef}>
        {lines.map((l) => (
          <div key={l.id} className={`term-line term-${l.type}`}>
            {l.type === 'input' && <span className="term-prompt">$ </span>}
            {l.type === 'nl' && <span className="term-nl-prefix" />}
            <pre className="term-pre">{l.text}</pre>
          </div>
        ))}
      </div>

      <div className="terminal-input-row">
        <span className="term-prompt-inline">{nlMode ? <Sparkles size={12} /> : '$'}</span>
        <input
          className="terminal-input"
          placeholder={nlMode ? 'Describe what to do in English… (e.g. "list files", "git status")' : 'Type a shell command…'}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKey}
          autoFocus
          spellCheck={false}
          disabled={busy}
        />
        <button className="term-run-btn" onClick={onSubmit} disabled={busy || !input.trim()}>
          <Play size={12} />
        </button>
      </div>
    </div>
  )
}