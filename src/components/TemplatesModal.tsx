import { useState, useEffect } from 'react'
import { FolderPlus, FileCode, Server, Globe, FileText, Sparkles } from 'lucide-react'
import { useStore } from '../store'

interface Template {
  id: string
  name: string
  desc: string
}

const TEMPLATE_ICONS: Record<string, typeof FileCode> = {
  'empty': FolderPlus,
  'react-ts': Sparkles,
  'node-ts': Server,
  'express-api': Server,
  'html': Globe,
}

interface Props {
  open: boolean
  onClose: () => void
}

export default function TemplatesModal({ open, onClose }: Props) {
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [projectName, setProjectName] = useState('')
  const [creating, setCreating] = useState(false)
  const createFromTemplate = useStore((s) => s.createFromTemplate)

  useEffect(() => {
    if (open) {
      setLoading(true)
      fetch('/api/templates')
        .then((r) => r.json())
        .then((data) => {
          setTemplates(data.templates ?? [])
          setLoading(false)
        })
        .catch(() => setLoading(false))
    }
  }, [open])

  const handleCreate = async () => {
    if (!selectedId || !projectName.trim()) return
    setCreating(true)
    await createFromTemplate(selectedId, projectName.trim())
    setCreating(false)
    setProjectName('')
    setSelectedId(null)
    onClose()
  }

  if (!open) return null

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div className="modal-header">
          <h2>New Project from Template</h2>
        </div>
        <div className="modal-body">
          {loading ? (
            <p style={{ color: 'var(--text-faint)' }}>Loading templates...</p>
          ) : (
            <>
              <p className="hint" style={{ marginBottom: 12 }}>
                Choose a template to start your project.
              </p>
              <div className="template-grid">
                {templates.map((t) => {
                  const Icon = TEMPLATE_ICONS[t.id] ?? FileText
                  const isSelected = selectedId === t.id
                  return (
                    <button
                      key={t.id}
                      className={`template-card ${isSelected ? 'selected' : ''}`}
                      onClick={() => setSelectedId(t.id)}
                    >
                      <Icon size={24} />
                      <span className="template-name">{t.name}</span>
                      <span className="template-desc">{t.desc}</span>
                    </button>
                  )
                })}
              </div>
              {selectedId && (
                <div style={{ marginTop: 16 }}>
                  <label className="hint" style={{ display: 'block', marginBottom: 6 }}>
                    Project name
                  </label>
                  <input
                    autoFocus
                    className="input"
                    placeholder="my-awesome-project"
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                  />
                </div>
              )}
            </>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={handleCreate}
            disabled={!selectedId || !projectName.trim() || creating}
          >
            <FolderPlus size={14} /> {creating ? 'Creating...' : 'Create Project'}
          </button>
        </div>
      </div>
    </div>
  )
}
