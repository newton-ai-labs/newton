import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Search,
  File as FileIcon,
  Settings as SettingsIcon,
  Save,
  Sparkles,
  PanelLeft,
  PanelRight,
  Plus,
} from 'lucide-react'
import { useStore } from '../store'
import type { FileNode } from '../../shared/types'

interface Cmd {
  id: string
  label: string
  hint?: string
  icon: typeof Search
  run: () => void
  group: 'Commands'
}

export default function CommandPalette() {
  const open = useStore((s) => s.paletteOpen)
  const setOpen = useStore((s) => s.setPaletteOpen)
  const tree = useStore((s) => s.tree)
  const openFile = useStore((s) => s.openFile)
  const saveActiveTab = useStore((s) => s.saveActiveTab)
  const setSettingsOpen = useStore((s) => s.setSettingsOpen)
  const setSidebarVisible = useStore((s) => s.setSidebarVisible)
  const setChatVisible = useStore((s) => s.setChatVisible)
  const sidebarVisible = useStore((s) => s.sidebarVisible)
  const chatVisible = useStore((s) => s.chatVisible)
  const createFile = useStore((s) => s.createFile)
  const sendMessage = useStore((s) => s.sendMessage)

  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // gather all files
  const files = useMemo(() => {
    const out: { path: string; name: string }[] = []
    const walk = (n: FileNode) => {
      if (n.type === 'file') out.push({ path: n.path, name: n.name })
      n.children?.forEach(walk)
    }
    if (tree) walk(tree)
    return out
  }, [tree])

  const commands: Cmd[] = useMemo(
    () => [
      {
        id: 'save',
        label: 'Save File',
        hint: '⌘S',
        icon: Save,
        run: () => saveActiveTab(),
        group: 'Commands',
      },
      {
        id: 'settings',
        label: 'Open Settings',
        icon: SettingsIcon,
        run: () => setSettingsOpen(true),
        group: 'Commands',
      },
      {
        id: 'toggle-sidebar',
        label: sidebarVisible ? 'Hide Sidebar' : 'Show Sidebar',
        icon: PanelLeft,
        run: () => setSidebarVisible(!sidebarVisible),
        group: 'Commands',
      },
      {
        id: 'toggle-chat',
        label: chatVisible ? 'Hide AI Panel' : 'Show AI Panel',
        icon: PanelRight,
        run: () => setChatVisible(!chatVisible),
        group: 'Commands',
      },
      {
        id: 'explain',
        label: 'AI: Explain current file',
        icon: Sparkles,
        run: () => sendMessage('Explain this file to me'),
        group: 'Commands',
      },
      {
        id: 'review',
        label: 'AI: Review for bugs',
        icon: Sparkles,
        run: () => sendMessage('Review this file for bugs and suggest improvements'),
        group: 'Commands',
      },
    ],
    [saveActiveTab, setSettingsOpen, setSidebarVisible, setChatVisible, sidebarVisible, chatVisible, sendMessage],
  )

  const results = useMemo(() => {
    const query = q.trim().toLowerCase()
    const matchedFiles = query
      ? files.filter((f) => f.path.toLowerCase().includes(query)).slice(0, 8)
      : files.slice(0, 8)
    const matchedCmds = query
      ? commands.filter((c) => c.label.toLowerCase().includes(query))
      : commands
    return { files: matchedFiles, cmds: matchedCmds }
  }, [q, files, commands])

  const flat = useMemo(() => {
    return [
      ...results.cmds.map((c) => ({ kind: 'cmd' as const, ...c })),
      ...results.files.map((f) => ({ kind: 'file' as const, ...f })),
    ]
  }, [results])

  useEffect(() => {
    if (open) {
      setQ('')
      setSel(0)
      setTimeout(() => inputRef.current?.focus(), 30)
    }
  }, [open])

  useEffect(() => setSel(0), [q])

  if (!open) return null

  const choose = (i: number) => {
    const item = flat[i]
    if (!item) return
    if (item.kind === 'cmd') {
      item.run()
    } else {
      openFile(item.path)
    }
    setOpen(false)
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSel((s) => Math.min(s + 1, flat.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSel((s) => Math.max(s - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      choose(sel)
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <div className="palette-input">
          <Search size={16} style={{ color: 'var(--text-faint)' }} />
          <input
            ref={inputRef}
            placeholder="Search files and commands…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
          />
        </div>
        <div className="palette-list">
          {flat.length === 0 && (
            <div className="palette-empty">No results</div>
          )}
          {flat.map((item, i) => {
            const active = i === sel
            const Icon = item.kind === 'cmd' ? item.icon : FileIcon
            return (
              <div
                key={(item.kind === 'cmd' ? 'c' : 'f') + (item.kind === 'cmd' ? item.id : item.path)}
                className={`palette-item ${active ? 'active' : ''}`}
                onClick={() => choose(i)}
                onMouseEnter={() => setSel(i)}
              >
                <Icon size={14} style={{ color: 'var(--text-dim)', flexShrink: 0 }} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {item.kind === 'cmd' ? item.label : item.path}
                </span>
                {item.kind === 'cmd' && item.hint && <span className="palette-hint">{item.hint}</span>}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}