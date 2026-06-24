import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'
import {
  Send,
  Square,
  Trash2,
  Sparkles,
  FileCode,
  Copy,
  Check,
  Wand2,
  MessageSquare,
  Bot,
} from 'lucide-react'
import { useStore } from '../store'
import AgentPanel from './AgentPanel'

type PanelTab = 'chat' | 'agent'

const SUGGESTIONS = [
  'Review this file for bugs',
  'Explain this code',
  'Write a debounce function',
  'What is async/await?',
]

export default function ChatPanel() {
  const messages = useStore((s) => s.messages)
  const busy = useStore((s) => s.chatBusy)
  const sendMessage = useStore((s) => s.sendMessage)
  const stop = useStore((s) => s.stopGeneration)
  const clearChat = useStore((s) => s.clearChat)
  const settings = useStore((s) => s.settings)
  const activeTab = useStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
  const setSettingsOpen = useStore((s) => s.setSettingsOpen)

  const [text, setText] = useState('')
  const [panelTab, setPanelTab] = useState<PanelTab>('chat')
  const scrollRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const submit = () => {
    if (!text.trim() || busy) return
    sendMessage(text)
    setText('')
    if (taRef.current) taRef.current.style.height = 'auto'
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  const autosize = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 200) + 'px'
  }

  if (panelTab === 'agent') {
    return (
      <div className="chat-panel">
        <div className="chat-header">
          <div className="panel-tabs">
            <button
              className="panel-tab"
              onClick={() => setPanelTab('chat')}
              title="Chat"
            >
              <MessageSquare size={13} />
              Chat
            </button>
            <button
              className="panel-tab active"
              onClick={() => setPanelTab('agent')}
              title="Agent"
            >
              <Bot size={13} />
              Agent
            </button>
          </div>
        </div>
        <AgentPanel />
      </div>
    )
  }

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <div className="panel-tabs">
          <button
            className="panel-tab active"
            onClick={() => setPanelTab('chat')}
            title="Chat"
          >
            <MessageSquare size={13} />
            Chat
          </button>
          <button
            className="panel-tab"
            onClick={() => setPanelTab('agent')}
            title="Agent"
          >
            <Bot size={13} />
            Agent
          </button>
        </div>
        <button className="mini-btn" title="Clear chat" onClick={clearChat}>
          <Trash2 size={13} />
        </button>
      </div>

      <div className="chat-messages" ref={scrollRef}>
        {messages.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text-faint)', marginTop: 40, padding: '0 12px' }}>
            <div style={{ fontSize: 30, marginBottom: 12 }}>✨</div>
            <div style={{ fontSize: 14, color: 'var(--text-dim)', fontWeight: 600, marginBottom: 6 }}>
              Ask Newton anything
            </div>
            <div style={{ fontSize: 12.5, lineHeight: 1.6 }}>
              I can explain code, find bugs, generate snippets, and answer
              programming questions.
            </div>
            <div className="chat-suggestions" style={{ justifyContent: 'center', marginTop: 16 }}>
              {SUGGESTIONS.map((s) => (
                <button key={s} className="suggestion-btn" onClick={() => sendMessage(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <Message key={m.id} role={m.role} content={m.content} streaming={m.streaming} />
        ))}
      </div>

      <div className="chat-input-area">
        {activeTab && (
          <div className="chat-context">
            <FileCode size={11} />
            <span className="context-chip">{activeTab.path}</span>
            <span>attached as context</span>
          </div>
        )}
        <div className="chat-input-wrap">
          <textarea
            ref={taRef}
            className="chat-input"
            placeholder={
              settings.provider === 'demo'
                ? 'Ask the demo assistant… (add a provider in Settings for full power)'
                : `Message ${settings.provider}…`
            }
            value={text}
            rows={1}
            onChange={(e) => {
              setText(e.target.value)
              autosize(e.target)
            }}
            onKeyDown={onKey}
          />
          {busy ? (
            <button className="chat-send" title="Stop" onClick={stop} style={{ background: 'var(--red)' }}>
              <Square size={14} fill="#fff" />
            </button>
          ) : (
            <button className="chat-send" title="Send" onClick={submit} disabled={!text.trim()}>
              <Send size={14} />
            </button>
          )}
        </div>
        {settings.provider === 'demo' && (
          <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-faint)' }}>
            Running in demo mode.{' '}
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault()
                setSettingsOpen(true)
              }}
              style={{ color: 'var(--accent-2)' }}
            >
              Add an API key →
            </a>
          </div>
        )}
      </div>
    </div>
  )
}

function Message({
  role,
  content,
  streaming,
}: {
  role: 'system' | 'user' | 'assistant'
  content: string
  streaming?: boolean
}) {
  return (
    <div className={`msg ${role}`}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div className="avatar">{role === 'assistant' ? 'N' : 'You'}</div>
        <div className="role">{role === 'assistant' ? 'Newton' : 'You'}</div>
      </div>
      <div className="bubble">
        {content ? (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              code({ node, className, children, ...props }) {
                const match = /language-(\w+)/.exec(className || '')
                const code = String(children).replace(/\n$/, '')
                const isBlock = match || code.includes('\n')
                if (!isBlock) {
                  return (
                    <code className={className} {...props}>
                      {children}
                    </code>
                  )
                }
                return <CodeBlock code={code} lang={match?.[1] ?? 'text'} />
              },
            }}
          >
            {content}
          </ReactMarkdown>
        ) : streaming ? (
          <div className="typing">
            <span></span>
            <span></span>
            <span></span>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [copied, setCopied] = useState(false)
  const updateTabContent = useStore((s) => s.updateTabContent)
  const activeTabId = useStore((s) => s.activeTabId)
  const tabs = useStore((s) => s.tabs)
  const toast = useStore((s) => s.toast)
  const saveActiveTab = useStore((s) => s.saveActiveTab)

  const copy = () => {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const apply = () => {
    const tab = tabs.find((t) => t.id === activeTabId)
    if (!tab) {
      toast('Open a file first to apply code')
      return
    }
    updateTabContent(tab.id, code)
    saveActiveTab()
    toast(`Applied to ${tab.name}`)
  }

  return (
    <div style={{ position: 'relative' }}>
      <SyntaxHighlighter
        language={lang}
        style={vscDarkPlus}
        customStyle={{
          margin: 0,
          background: '#0a0b14',
          border: '1px solid var(--border)',
          borderRadius: 8,
          fontSize: 12.5,
          padding: 12,
        }}
      >
        {code}
      </SyntaxHighlighter>
      <div className="code-actions">
        <button className="code-action-btn" onClick={copy}>
          {copied ? <Check size={11} /> : <Copy size={11} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button className="code-action-btn apply" onClick={apply}>
          <Wand2 size={11} />
          Apply to file
        </button>
      </div>
    </div>
  )
}