import { useEffect, useRef } from 'react'
import { X, Terminal as TermIcon } from 'lucide-react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { useStore } from '../store'
import '@xterm/xterm/css/xterm.css'

/**
 * Real terminal panel. Spawns a PTY-backed shell on the server via WebSocket
 * and renders it with xterm.js. Full TTY semantics: interactive programs,
 * ANSI escape codes, signals, colors, resize.
 *
 * Wire protocol (matches server/index.ts terminal WSS):
 *   client → server: { type: 'input', data } | { type: 'resize', cols, rows }
 *   server → client: { type: 'output', data } | { type: 'exit', code, signal }
 */
export default function TerminalPanel() {
  const terminalOpen = useStore((s) => s.terminalOpen)
  const setTerminalOpen = useStore((s) => s.setTerminalOpen)
  const refreshTree = useStore((s) => s.refreshTree)
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    if (!terminalOpen || !containerRef.current) return

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      fontSize: 13,
      lineHeight: 1.2,
      theme: {
        background: '#0a0b14',
        foreground: '#e5e7eb',
        cursor: '#a78bfa',
        selectionBackground: 'rgba(124, 58, 237, 0.3)',
      },
      scrollback: 5000,
      convertEol: false,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(containerRef.current)
    fit.fit()
    term.focus()
    termRef.current = term
    fitRef.current = fit

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${proto}//${window.location.host}/api/terminal/ws`

    let disposed = false
    let reconnectTimer: number | null = null
    let refreshTimer: number | null = null
    let backoffMs = 800

    const sendResize = (ws: WebSocket) => {
      if (ws.readyState !== WebSocket.OPEN) return
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
    }

    // Connect/reconnect: wire all handlers and store the WS on the ref so
    // input/resize use the current connection. Reconnects on close with a
    // small backoff that resets after a successful open.
    const connect = (): WebSocket => {
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        backoffMs = 800 // reset backoff on a clean open
        sendResize(ws)
      }
      ws.onmessage = (ev) => {
        let msg: any
        try { msg = JSON.parse(ev.data) } catch { return }
        if (msg.type === 'output' && typeof msg.data === 'string') {
          term.write(msg.data)
          // Best-effort: refresh file tree if the user likely changed the FS.
          if (/\b(git|npm|mkdir|touch|rm|mv|cp)\b/.test(msg.data)) {
            if (refreshTimer === null) {
              refreshTimer = window.setTimeout(() => {
                refreshTree()
                refreshTimer = null
              }, 600)
            }
          }
        } else if (msg.type === 'exit') {
          term.write(`\r\n\x1b[2m[process exited: code=${msg.code}${msg.signal ? `, signal=${msg.signal}` : ''}]\x1b[0m\r\n`)
        }
      }
      ws.onclose = () => {
        if (disposed) return
        term.write(`\r\n\x1b[2m[connection closed — reconnecting in ${Math.round(backoffMs / 100) / 10}s]\x1b[0m\r\n`)
        scheduleReconnect()
      }
      ws.onerror = () => {
        // onerror fires before onclose; let onclose handle reconnect.
      }
      return ws
    }

    const scheduleReconnect = () => {
      if (disposed || reconnectTimer !== null) return
      const delay = backoffMs
      backoffMs = Math.min(backoffMs * 2, 15_000)
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null
        if (disposed) return
        term.write('\x1b[2m[reconnecting...]\x1b[0m\r\n')
        connect()
      }, delay)
    }

    connect()

    const inputDisposable = term.onData((data) => {
      const ws = wsRef.current
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }))
      }
    })

    const ro = new ResizeObserver(() => {
      try { fit.fit() } catch { /* ignore */ }
      const ws = wsRef.current
      if (ws) sendResize(ws)
    })
    ro.observe(containerRef.current)

    return () => {
      disposed = true
      ro.disconnect()
      inputDisposable.dispose()
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      if (refreshTimer !== null) {
        window.clearTimeout(refreshTimer)
        refreshTimer = null
      }
      try { wsRef.current?.close() } catch { /* ignore */ }
      term.dispose()
      termRef.current = null
      fitRef.current = null
      wsRef.current = null
    }
  }, [terminalOpen, refreshTree])

  if (!terminalOpen) return null

  return (
    <div className="terminal-panel">
      <div className="terminal-header">
        <div className="term-tabs">
          <span className="term-tab active">
            <TermIcon size={12} /> Terminal
          </span>
        </div>
        <div className="terminal-actions">
          <button className="term-close" onClick={() => setTerminalOpen(false)} title="Close (⌃`)">
            <X size={14} />
          </button>
        </div>
      </div>
      <div ref={containerRef} className="terminal-body" style={{ padding: 6 }} />
    </div>
  )
}
