import { useState } from 'react'
import {
  ChevronRight,
  FilePlus,
  FolderPlus,
  RefreshCw,
  Trash2,
  Folder,
  FolderOpen,
} from 'lucide-react'
import { useStore } from '../store'
import type { FileNode } from '../../shared/types'
import { fileIcon, fileColor } from './fileIcons'

export default function FileExplorer() {
  const tree = useStore((s) => s.tree)
  const loading = useStore((s) => s.treeLoading)
  const refreshTree = useStore((s) => s.refreshTree)
  const createFile = useStore((s) => s.createFile)
  const expanded = useStore((s) => s.expandedDirs)
  const toggleDir = useStore((s) => s.toggleDir)
  const openFile = useStore((s) => s.openFile)
  const activeTabPath = useStore((s) => {
    const t = s.tabs.find((x) => x.id === s.activeTabId)
    return t?.path ?? null
  })
  const deleteNode = useStore((s) => s.deleteNode)

  const [creating, setCreating] = useState<
    { parent: string } | null
  >(null)
  const [newName, setNewName] = useState('')

  const startCreate = (parent: string) => {
    setCreating({ parent })
    setNewName('')
  }
  const commitCreate = async () => {
    if (!creating || !newName.trim()) {
      setCreating(null)
      return
    }
    const isDir = newName.endsWith('/')
    const full = creating.parent
      ? `${creating.parent}/${newName.replace(/\/$/, '')}`
      : newName.replace(/\/$/, '')
    await createFile(full, isDir ? 'directory' : 'file')
    setCreating(null)
    setNewName('')
  }

  if (!tree) {
    return (
      <div className="sidebar">
        <Header
          onNewFile={() => startCreate('')}
          onNewFolder={() => startCreate('')}
          onRefresh={refreshTree}
        />
        <div className="file-tree" style={{ color: 'var(--text-faint)', fontSize: 13, padding: 16 }}>
          {loading ? 'Loading…' : 'No folder open.'}
        </div>
      </div>
    )
  }

  return (
    <div className="sidebar">
      <Header
        onNewFile={() => startCreate(tree.path === '.' ? '' : tree.path)}
        onNewFolder={() => startCreate(tree.path === '.' ? '' : tree.path)}
        onRefresh={refreshTree}
      />
      <div className="file-tree">
        {creating && (
          <div style={{ padding: '2px 8px' }}>
            <input
              autoFocus
              className="input"
              style={{ padding: '4px 8px', fontSize: 12 }}
              placeholder="name.ts (end with / for folder)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onBlur={commitCreate}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitCreate()
                if (e.key === 'Escape') setCreating(null)
              }}
            />
          </div>
        )}
        {tree.children?.map((child) => (
          <TreeNode
            key={child.path}
            node={child}
            depth={0}
            expanded={expanded}
            onToggle={toggleDir}
            onOpen={openFile}
            activePath={activeTabPath}
            onDelete={deleteNode}
            onNewHere={startCreate}
          />
        ))}
      </div>
    </div>
  )
}

function Header({
  onNewFile,
  onNewFolder,
  onRefresh,
}: {
  onNewFile: () => void
  onNewFolder: () => void
  onRefresh: () => void
}) {
  return (
    <div className="sidebar-header">
      <span>Explorer</span>
      <div className="actions">
        <button className="mini-btn" title="New File" onClick={onNewFile}>
          <FilePlus size={14} />
        </button>
        <button className="mini-btn" title="New Folder" onClick={onNewFolder}>
          <FolderPlus size={14} />
        </button>
        <button className="mini-btn" title="Refresh" onClick={onRefresh}>
          <RefreshCw size={13} />
        </button>
      </div>
    </div>
  )
}

function TreeNode({
  node,
  depth,
  expanded,
  onToggle,
  onOpen,
  activePath,
  onDelete,
  onNewHere,
}: {
  node: FileNode
  depth: number
  expanded: Record<string, boolean>
  onToggle: (p: string) => void
  onOpen: (p: string) => void
  activePath: string | null
  onDelete: (p: string) => void
  onNewHere: (parent: string) => void
}) {
  const pad = 8 + depth * 12
  const isOpen = expanded[node.path]
  const isActive = activePath === node.path

  if (node.type === 'directory') {
    return (
      <div>
        <div
          className="tree-row"
          onClick={() => onToggle(node.path)}
        >
          <span className="chev" style={{ paddingLeft: pad }}>
            <ChevronRight size={13} className={isOpen ? 'open' : ''} />
          </span>
          <span className="file-icon" style={{ color: 'var(--blue)' }}>
            {isOpen ? <FolderOpen size={15} /> : <Folder size={15} />}
          </span>
          <span className="name">{node.name}</span>
          <span style={{ marginLeft: 'auto' }} className="tree-row-actions">
            <button
              className="mini-btn"
              style={{ width: 18, height: 18 }}
              title="New file"
              onClick={(e) => {
                e.stopPropagation()
                onNewHere(node.path)
              }}
            >
              <FilePlus size={11} />
            </button>
          </span>
        </div>
        {isOpen &&
          node.children?.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              onOpen={onOpen}
              activePath={activePath}
              onDelete={onDelete}
              onNewHere={onNewHere}
            />
          ))}
      </div>
    )
  }

  const Icon = fileIcon(node.name)
  const color = fileColor(node.name)
  return (
    <div
      className={`tree-row ${isActive ? 'active' : ''}`}
      onClick={() => onOpen(node.path)}
    >
      <span style={{ paddingLeft: pad + 14 }} />
      <span className="file-icon" style={{ color }}>
        <Icon size={14} />
      </span>
      <span className="name">{node.name}</span>
      <button
        className="mini-btn"
        style={{ width: 18, height: 18, marginLeft: 'auto', opacity: 0.4 }}
        title="Delete"
        onClick={(e) => {
          e.stopPropagation()
          if (confirm(`Delete ${node.path}?`)) onDelete(node.path)
        }}
      >
        <Trash2 size={11} />
      </button>
    </div>
  )
}