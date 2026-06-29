import { useState, useEffect, useRef } from 'react'
import { X, Check, KeyRound, Cpu, Zap, Shield, Share2, Sparkles, type LucideIcon } from 'lucide-react'
import { useStore } from '../store'
import { replayOnboarding } from './constellation/useFirstRun'
import {
  PROVIDER_REGISTRY,
  type Provider,
  type Settings as SettingsType,
  type PerProviderSettings,
} from '../../shared/types'

// Map of icon names used in PROVIDER_REGISTRY to components
const PROVIDER_ICONS: Record<string, LucideIcon> = {
  Cpu,
  Zap,
  Shield,
  Share2,
  Sparkles,
}

export default function SettingsModal() {
  const open = useStore((s) => s.settingsOpen)
  const setOpen = useStore((s) => s.setSettingsOpen)
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const toast = useStore((s) => s.toast)
  const [saved, setSaved] = useState(false)
  const modalRef = useRef<HTMLDivElement>(null)

  // Escape key handler + focus trap (must be before early return to follow Rules of Hooks)
  useEffect(() => {
    if (!open) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        return
      }
      // Basic focus trap: Tab cycles through focusable elements
      if (e.key === 'Tab' && modalRef.current) {
        const focusable = modalRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
        if (focusable.length === 0) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    // Focus first focusable element on mount
    const focusable = modalRef.current?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )
    focusable?.focus()
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, setOpen])

  if (!open) return null

  const set = (partial: Partial<SettingsType>) => setSettings(partial)

  /** Update a single field in the active provider's config. */
  const setProviderField = (field: keyof PerProviderSettings, value: string) => {
    const id = settings.provider
    const current = settings.providerConfigs[id] ?? {
      model: '',
      apiKey: '',
      baseUrl: '',
    }
    set({
      providerConfigs: {
        ...settings.providerConfigs,
        [id]: { ...current, [field]: value },
      },
    })
    showSaved()
  }

  const activeDef = PROVIDER_REGISTRY.find((p) => p.id === settings.provider)!
  const activeCfg = settings.providerConfigs[settings.provider]

  const showSaved = () => {
    setSaved(true)
    setTimeout(() => setSaved(false), 1200)
  }

  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
        className="modal settings-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id="settings-modal-title">Settings</h2>
          <button className="mini-btn" onClick={() => setOpen(false)}>
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          {/* Provider */}
          <section>
            <h3>AI Provider</h3>
            <p className="section-desc">Choose how Newton's assistant is powered.</p>
            <div className="provider-grid">
              {PROVIDER_REGISTRY.map((p) => {
                const Icon = PROVIDER_ICONS[p.icon] ?? Cpu
                const active = settings.provider === p.id
                return (
                  <div
                    key={p.id}
                    className={`provider-card ${active ? 'active' : ''}`}
                    onClick={() => {
                      // switching provider — ensure it has a default model
                      const next = { ...settings.providerConfigs }
                      if (!next[p.id]?.model) {
                        next[p.id] = {
                          model: p.models[0],
                          apiKey: next[p.id]?.apiKey ?? '',
                          baseUrl: next[p.id]?.baseUrl ?? p.defaultBaseUrl,
                        }
                      }
                      set({ provider: p.id, providerConfigs: next })
                    }}
                  >
                    <div className="provider-icon" style={{ background: `${p.color}22`, color: p.color }}>
                      <Icon size={16} />
                    </div>
                    <div className="provider-meta">
                      <div className="provider-name">{p.name}</div>
                      <div className="provider-desc">{p.desc}</div>
                    </div>
                    {active && (
                      <div className="provider-check">
                        <Check size={14} />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>

          {/* Per-provider config */}
          {activeDef.needsKey && (
            <section>
              <h3>
                <KeyRound size={13} style={{ verticalAlign: '-2px', marginRight: 6 }} />
                {activeDef.name} API Key
              </h3>
              <input
                type="password"
                className="input"
                placeholder={activeDef.keyHint || 'sk-...'}
                value={activeCfg?.apiKey ?? ''}
                onChange={(e) => setProviderField('apiKey', e.target.value)}
              />
              <p className="hint">
                <strong>Local storage only.</strong> Your key is stored in this browser's localStorage and sent directly to {activeDef.name}. It never touches Newton's servers.
              </p>
            </section>
          )}

          {/* Model — free text + datalist so users can type custom models */}
          {settings.provider !== 'demo' && (
            <section>
              <h3>Model</h3>
              <input
                className="input"
                list="model-suggestions"
                placeholder={activeDef.models[0]}
                value={activeCfg?.model ?? ''}
                onChange={(e) => setProviderField('model', e.target.value)}
              />
              <datalist id="model-suggestions">
                {activeDef.models.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
              <p className="hint">Type a custom model name or pick from suggestions.</p>
            </section>
          )}

          {/* Base URL */}
          {activeDef.needsBaseUrl && settings.provider !== 'demo' && (
            <section>
              <h3>{activeDef.name} Base URL</h3>
              <input
                className="input"
                placeholder={activeDef.defaultBaseUrl}
                value={activeCfg?.baseUrl ?? ''}
                onChange={(e) => setProviderField('baseUrl', e.target.value)}
              />
              <p className="hint">
                {settings.provider === 'ollama'
                  ? <>Make sure Ollama is running (<code>ollama serve</code>).</>
                  : <>Override for self-hosted or compatible endpoints.</>}
              </p>
            </section>
          )}

          {/* Editor */}
          <section>
            <h3>Editor</h3>
            <label className="field-row">
              <span>Font size</span>
              <input
                type="number"
                className="input small"
                min={10}
                max={24}
                value={settings.fontSize}
                onChange={(e) => set({ fontSize: Number(e.target.value) })}
              />
            </label>
          </section>

          {/* System prompt */}
          <section>
            <h3>System Prompt</h3>
            <textarea
              className="input"
              rows={3}
              value={settings.systemPrompt}
              onChange={(e) => set({ systemPrompt: e.target.value })}
              onBlur={showSaved}
            />
            <p className="hint">Instructions prepended to every assistant message.</p>
          </section>

          {/* Layout — experimental constellation shell */}
          <section>
            <h3>Layout <span style={{ fontSize: 10, color: 'var(--yellow)', marginLeft: 6, padding: '1px 6px', borderRadius: 4, background: 'color-mix(in srgb, var(--yellow) 16%, transparent)', textTransform: 'uppercase', letterSpacing: 0.4 }}>experimental</span></h3>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className={`layout-pick-btn ${settings.layout === 'classic' ? 'is-active' : ''}`}
                onClick={() => set({ layout: 'classic' })}
              >
                <div className="layout-pick-name">Classic</div>
                <div className="layout-pick-desc">Activity bar, tabs, panels — the original Newton layout.</div>
              </button>
              <button
                type="button"
                className={`layout-pick-btn ${settings.layout === 'constellation' ? 'is-active' : ''}`}
                onClick={() => set({ layout: 'constellation' })}
              >
                <div className="layout-pick-name">Constellation</div>
                <div className="layout-pick-desc">Your codebase as a graph. Click a node to zoom into its file.</div>
              </button>
            </div>
            <p className="hint">
              Switching applies immediately. Constellation is in active development — some features (editor, prompt, sessions) land in upcoming phases.
              {' '}
              <button
                type="button"
                onClick={() => {
                  replayOnboarding()
                  if (settings.layout !== 'constellation') set({ layout: 'constellation' })
                  setOpen(false)
                  toast('Replaying onboarding')
                }}
                style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', padding: 0, font: 'inherit' }}
              >
                Replay onboarding
              </button>
            </p>
          </section>
        </div>

        <div className="modal-footer">
          {saved && (
            <span style={{ color: 'var(--green)', fontSize: 13, marginRight: 'auto' }}>
              <Check size={12} style={{ verticalAlign: '-1px' }} /> Saved
            </span>
          )}
          <button className="btn-primary" onClick={() => { setOpen(false); toast('Settings saved') }}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}