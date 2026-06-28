import { useEffect, useState } from 'react'
import {
  Brain,
  RefreshCw,
  Plus,
  X,
  Cpu,
  Layers,
  CheckSquare,
  Lightbulb,
  Trash2,
  FolderTree,
} from 'lucide-react'
import { useStore } from '../store'
import type { MemoryEntryType } from '../../shared/types'

const ENTRY_ICONS: Record<MemoryEntryType, typeof Brain> = {
  decision: CheckSquare,
  task: CheckSquare,
  note: Lightbulb,
  pattern: Layers,
}

const ENTRY_COLORS: Record<MemoryEntryType, string> = {
  decision: 'var(--blue)',
  task: 'var(--green)',
  note: 'var(--yellow)',
  pattern: 'var(--purple, var(--blue))',
}

export default function MemoryPanel() {
  const memory = useStore((s) => s.memory)
  const memoryBusy = useStore((s) => s.memoryBusy)
  const loadMemory = useStore((s) => s.loadMemory)
  const refreshMemory = useStore((s) => s.refreshMemory)
  const addMemoryEntry = useStore((s) => s.addMemoryEntry)
  const removeMemoryEntry = useStore((s) => s.removeMemoryEntry)
  const openFile = useStore((s) => s.openFile)

  const [showAdd, setShowAdd] = useState(false)
  const [newType, setNewType] = useState<MemoryEntryType>('note')
  const [newText, setNewText] = useState('')

  useEffect(() => {
    if (!memory) loadMemory()
  }, [memory, loadMemory])

  const handleAdd = async () => {
    if (!newText.trim()) return
    await addMemoryEntry(newType, newText)
    setNewText('')
    setShowAdd(false)
  }

  const recentFiles = memory
    ? Object.entries(memory.recentFiles)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 8)
    : []

  return (
    <div className="sidebar" style={{ padding: 0 }}>
      <div className="sidebar-header">
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <Brain size={14} /> Memory
        </span>
        <div className="actions">
          <button
            className="mini-btn"
            title="Add entry"
            onClick={() => setShowAdd((v) => !v)}
          >
            <Plus size={13} />
          </button>
          <button
            className="mini-btn"
            title="Rescan workspace"
            onClick={() => refreshMemory()}
            disabled={memoryBusy}
          >
            <RefreshCw size={13} className={memoryBusy ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {/* Add entry form */}
      {showAdd && (
        <div
          style={{
            padding: 10,
            borderBottom: '1px solid var(--border)',
            background: 'var(--bg-2)',
          }}
        >
          <select
            value={newType}
            onChange={(e) => setNewType(e.target.value as MemoryEntryType)}
            style={{
              width: '100%',
              marginBottom: 6,
              padding: '4px 6px',
              background: 'var(--bg-1)',
              color: 'var(--text)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              fontSize: 12,
            }}
          >
            <option value="decision">Decision</option>
            <option value="note">Note</option>
            <option value="pattern">Pattern</option>
            <option value="task">Task</option>
          </select>
          <textarea
            autoFocus
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            placeholder="e.g. We use conventional commits and Vitest for testing."
            rows={3}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleAdd()
            }}
            style={{
              width: '100%',
              padding: '6px 8px',
              background: 'var(--bg-1)',
              color: 'var(--text)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              fontSize: 12,
              resize: 'vertical',
              fontFamily: 'inherit',
            }}
          />
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <button className="btn-primary" style={{ fontSize: 11, padding: '3px 10px' }} onClick={handleAdd}>
              Add
            </button>
            <button
              className="mini-btn"
              style={{ fontSize: 11, padding: '3px 10px' }}
              onClick={() => setShowAdd(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div style={{ overflowY: 'auto', height: 'calc(100% - 42px)' }}>
        {!memory ? (
          <div style={{ padding: 20, color: 'var(--text-faint)', textAlign: 'center', fontSize: 13 }}>
            {memoryBusy ? 'Scanning workspace…' : 'No memory yet.'}
          </div>
        ) : (
          <>
            {/* Tech Stack */}
            <Section icon={Cpu} title="Tech Stack" color="var(--blue)">
              {memory.techStack.length === 0 ? (
                <Empty>Run refresh to detect.</Empty>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {memory.techStack.map((t) => (
                    <span
                      key={t.name}
                      title={`${t.category}${t.version ? ` · ${t.version}` : ''}`}
                      style={{
                        fontSize: 10.5,
                        padding: '2px 7px',
                        background: 'var(--bg-2)',
                        border: '1px solid var(--border)',
                        borderRadius: 10,
                        color: 'var(--text)',
                      }}
                    >
                      {t.name}
                      {t.version && (
                        <span style={{ color: 'var(--text-faint)', marginLeft: 3 }}>
                          {t.version}
                        </span>
                      )}
                    </span>
                  ))}
                </div>
              )}
            </Section>

            {/* Structure */}
            {memory.structure && (
            <Section icon={FolderTree} title="Structure" color="var(--green)">
              <div style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                {memory.structure.totalFiles} files · {memory.structure.totalDirs} dirs
              </div>
              {memory.structure.languages?.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  {memory.structure.languages.slice(0, 6).map((l) => (
                    <div
                      key={l.name}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        fontSize: 11,
                        marginBottom: 2,
                      }}
                    >
                      <span style={{ width: 70, color: 'var(--text)' }}>{l.name}</span>
                      <div
                        style={{
                          flex: 1,
                          height: 4,
                          background: 'var(--bg-2)',
                          borderRadius: 2,
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            width: `${l.percentage}%`,
                            height: '100%',
                            background: 'var(--blue)',
                            borderRadius: 2,
                          }}
                        />
                      </div>
                      <span style={{ width: 32, textAlign: 'right', color: 'var(--text-faint)' }}>
                        {l.percentage}%
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Section>
            )}

            {/* TODOs */}
            {memory.todos?.length > 0 && (
              <Section icon={CheckSquare} title={`TODOs (${memory.todos.length})`} color="var(--yellow)">
                <div style={{ maxHeight: 160, overflowY: 'auto' }}>
                  {memory.todos.slice(0, 30).map((todo, i) => (
                    <div
                      key={i}
                      className="tree-row"
                      style={{ fontSize: 11, padding: '3px 4px', alignItems: 'flex-start', gap: 4 }}
                      title={todo.file}
                      onClick={() => openFile(todo.file)}
                    >
                      <span
                        style={{
                          fontSize: 9,
                          fontWeight: 700,
                          padding: '0 3px',
                          borderRadius: 3,
                          background:
                            todo.tag === 'FIXME'
                              ? 'var(--red)'
                              : todo.tag === 'HACK'
                              ? 'var(--purple, var(--blue))'
                              : 'var(--yellow)',
                          color: todo.tag === 'FIXME' ? '#fff' : '#000',
                          flexShrink: 0,
                        }}
                      >
                        {todo.tag}
                      </span>
                      <span style={{ flex: 1, color: 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {todo.text}
                      </span>
                      <span style={{ color: 'var(--text-faint)', fontSize: 10, flexShrink: 0 }}>
                        {todo.file.split('/').pop()}:{todo.line}
                      </span>
                    </div>
                  ))}
                </div>
              </Section>
            )}

            {/* Recent Files */}
            {recentFiles.length > 0 && (
              <Section icon={Layers} title="Recent" color="var(--text-faint)">
                {recentFiles.map(([path]) => (
                  <div
                    key={path}
                    className="tree-row"
                    style={{ fontSize: 11, padding: '2px 4px' }}
                    onClick={() => openFile(path)}
                    title={path}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {path}
                    </span>
                  </div>
                ))}
              </Section>
            )}

            {/* Entries (decisions/notes/patterns) */}
            <Section icon={Lightbulb} title={`Notes (${memory.entries.length})`} color="var(--yellow)">
              {memory.entries.length === 0 ? (
                <Empty>Click + to add a decision or note.</Empty>
              ) : (
                memory.entries.map((entry) => {
                  const Icon = ENTRY_ICONS[entry.type]
                  return (
                    <div
                      key={entry.id}
                      style={{
                        display: 'flex',
                        gap: 6,
                        padding: '5px 4px',
                        borderBottom: '1px solid var(--border)',
                        fontSize: 11.5,
                      }}
                    >
                      <Icon size={12} style={{ color: ENTRY_COLORS[entry.type], flexShrink: 0, marginTop: 1 }} />
                      <span style={{ flex: 1, color: 'var(--text)' }}>{entry.text}</span>
                      <button
                        className="mini-btn"
                        style={{ width: 16, height: 16, flexShrink: 0 }}
                        onClick={() => removeMemoryEntry(entry.id)}
                        title="Remove"
                      >
                        <Trash2 size={10} />
                      </button>
                    </div>
                  )
                })
              )}
            </Section>
          </>
        )}
      </div>
    </div>
  )
}

function Section({
  icon: Icon,
  title,
  color,
  children,
}: {
  icon: typeof Brain
  title: string
  color: string
  children: React.ReactNode
}) {
  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 10px',
          fontSize: 11,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          color: 'var(--text-faint)',
        }}
      >
        <Icon size={12} style={{ color }} />
        {title}
      </div>
      <div style={{ padding: '0 10px 8px' }}>{children}</div>
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 11, color: 'var(--text-faint)', fontStyle: 'italic' }}>{children}</div>
}