import { useState } from 'react'
import { X, Check, KeyRound, Cpu, Zap, Shield } from 'lucide-react'
import { useStore } from '../store'
import type { Provider, Settings as SettingsType } from '../../shared/types'

const PROVIDERS: {
  id: Provider
  name: string
  desc: string
  icon: typeof Zap
  color: string
  models: string[]
  needsKey: boolean
  needsBaseUrl?: boolean
}[] = [
  {
    id: 'demo',
    name: 'Demo (no key)',
    desc: 'Built-in offline assistant. Great for trying Newton without setup.',
    icon: Zap,
    color: 'var(--accent-2)',
    models: ['demo'],
    needsKey: false,
  },
  {
    id: 'openai',
    name: 'OpenAI',
    desc: 'GPT-4o, o1 and more. Requires an OpenAI API key.',
    icon: Cpu,
    color: '#10a37f',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1-preview', 'o1-mini'],
    needsKey: true,
    needsBaseUrl: true,
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    desc: 'Claude 3.5 Sonnet / Haiku. Requires an Anthropic API key.',
    icon: Shield,
    color: '#d97757',
    models: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022'],
    needsKey: true,
  },
  {
    id: 'ollama',
    name: 'Ollama (local)',
    desc: 'Run models locally with Ollama. Free and private.',
    icon: Cpu,
    color: '#7c5cff',
    models: ['llama3.1', 'qwen2.5-coder', 'deepseek-coder-v2', 'mistral'],
    needsKey: false,
    needsBaseUrl: true,
  },
]

export default function SettingsModal() {
  const open = useStore((s) => s.settingsOpen)
  const setOpen = useStore((s) => s.setSettingsOpen)
  const settings = useStore((s) => s.settings)
  const setSettings = useStore((s) => s.setSettings)
  const toast = useStore((s) => s.toast)
  const [saved, setSaved] = useState(false)

  if (!open) return null

  const set = (partial: Partial<SettingsType>) => setSettings(partial)

  const activeProvider = PROVIDERS.find((p) => p.id === settings.provider)!

  const showSaved = () => {
    setSaved(true)
    setTimeout(() => setSaved(false), 1200)
  }

  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Settings</h2>
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
              {PROVIDERS.map((p) => {
                const Icon = p.icon
                const active = settings.provider === p.id
                return (
                  <div
                    key={p.id}
                    className={`provider-card ${active ? 'active' : ''}`}
                    onClick={() => {
                      set({
                        provider: p.id,
                        ...(p.id === 'openai' && !settings.openaiModel ? { openaiModel: p.models[0] } : {}),
                        ...(p.id === 'anthropic' && !settings.anthropicModel ? { anthropicModel: p.models[0] } : {}),
                        ...(p.id === 'ollama' && !settings.ollamaModel ? { ollamaModel: p.models[0] } : {}),
                      })
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
          {activeProvider.needsKey && (
            <section>
              <h3>
                <KeyRound size={13} style={{ verticalAlign: '-2px', marginRight: 6 }} />
                {activeProvider.name} API Key
              </h3>
              <input
                type="password"
                className="input"
                placeholder={`sk-...`}
                value={
                  activeProvider.id === 'openai' ? settings.openaiApiKey : settings.anthropicApiKey
                }
                onChange={(e) =>
                  set(
                    activeProvider.id === 'openai'
                      ? { openaiApiKey: e.target.value }
                      : { anthropicApiKey: e.target.value },
                  )
                }
                onBlur={showSaved}
              />
              <p className="hint">Stored locally in your browser. Never sent anywhere except the provider.</p>
            </section>
          )}

          {/* Model */}
          {settings.provider !== 'demo' && (
            <section>
              <h3>Model</h3>
              <select
                className="input"
                value={
                  settings.provider === 'openai'
                    ? settings.openaiModel
                    : settings.provider === 'anthropic'
                      ? settings.anthropicModel
                      : settings.ollamaModel
                }
                onChange={(e) => {
                  if (settings.provider === 'openai') set({ openaiModel: e.target.value })
                  else if (settings.provider === 'anthropic') set({ anthropicModel: e.target.value })
                  else set({ ollamaModel: e.target.value })
                }}
              >
                {activeProvider.models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </section>
          )}

          {/* Base URL */}
          {activeProvider.needsBaseUrl && settings.provider === 'openai' && (
            <section>
              <h3>OpenAI Base URL (optional)</h3>
              <input
                className="input"
                placeholder="https://api.openai.com/v1"
                value={settings.openaiBaseUrl}
                onChange={(e) => set({ openaiBaseUrl: e.target.value })}
                onBlur={showSaved}
              />
              <p className="hint">Override for Azure OpenAI or OpenAI-compatible endpoints.</p>
            </section>
          )}

          {settings.provider === 'ollama' && (
            <section>
              <h3>Ollama URL</h3>
              <input
                className="input"
                placeholder="http://localhost:11434"
                value={settings.ollamaBaseUrl}
                onChange={(e) => set({ ollamaBaseUrl: e.target.value })}
                onBlur={showSaved}
              />
              <p className="hint">Make sure Ollama is running (<code>ollama serve</code>).</p>
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