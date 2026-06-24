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
  AtSign,
  X,
  Search as SearchIcon,
  Loader2,
  FileEdit,
} from 'lucide-react'
import { useStore, langFromPath } from '../store'
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

  // @-mentions state
  const [mentionOpen, setMentionOpen] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionIdx, setMentionIdx] = useState(0)
  const searchResults = useStore((s) => s.searchResults)
  const searchBusy = useStore((s) => s.searchBusy)
  const searchCode = useStore((s) => s.searchCode)
  const clearSearch = useStore((s) => s.clearSearch)
  const attachedContext = useStore((s) => s.attachedContext)
  const attachFile = useStore((s) => s.attachFile)
  const detachFile = useStore((s) => s.detachFile)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  // Handle @-mention detection and search
  useEffect(() => {
    if (!mentionOpen) return
    const q = mentionQuery.trim()
    if (!q) return
    const t = setTimeout(() => searchCode(q), 200)
    return () => clearTimeout(t)
  }, [mentionOpen, mentionQuery, searchCode])

  const submit = () => {
    if (!text.trim() || busy) return
    sendMessage(text)
    setText('')
    if (taRef.current) taRef.current.style.height = 'auto'
  }

  const onKey = (e: React.KeyboardEvent) => {
    // @-mention navigation
    if (mentionOpen && searchResults.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMentionIdx((i) => (i + 1) % searchResults.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMentionIdx((i) => (i - 1 + searchResults.length) % searchResults.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        const hit = searchResults[mentionIdx]
        if (hit) {
          attachFile(hit.filePath)
          // remove the @query from the text
          setText((t) => t.replace(/@[^@\s]*$/, ''))
          setMentionOpen(false)
          setMentionQuery('')
          clearSearch()
          setMentionIdx(0)
          taRef.current?.focus()
        }
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setMentionOpen(false)
        setMentionQuery('')
        clearSearch()
        return
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  const onTextChange = (val: string) => {
    setText(val)
    // Detect @-mention
    const match = val.match(/@([^@\s]*)$/)
    if (match) {
      setMentionOpen(true)
      setMentionQuery(match[1])
      setMentionIdx(0)
    } else {
      if (mentionOpen) {
        setMentionOpen(false)
        setMentionQuery('')
        clearSearch()
      }
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
        {/* Attached context chips */}
        {(attachedContext.length > 0 || activeTab) && (
          <div className="chat-context">
            {activeTab && (
              <span className="context-chip">
                <FileCode size={10} />
                {activeTab.path}
              </span>
            )}
            {attachedContext.map((f) => (
              <span key={f.path} className="context-chip removable">
                <AtSign size={10} />
                {f.path}
                <button
                  className="chip-x"
                  onClick={() => detachFile(f.path)}
                  title="Remove"
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="chat-input-wrap" style={{ position: 'relative' }}>
          {/* @-mention popup */}
          {mentionOpen && (
            <div className="mention-popup">
              <div className="mention-popup-header">
                {searchBusy ? (
                  <Loader2 size={11} className="spin" />
                ) : (
                  <SearchIcon size={11} />
                )}
                <span>
                  {searchBusy ? 'Searching codebase…' : 'Codebase results'}
                  {mentionQuery && ` for "${mentionQuery}"`}
                </span>
              </div>
              {searchResults.length === 0 && !searchBusy && (
                <div className="mention-empty">
                  No matches. Try a different term.
                </div>
              )}
              {searchResults.map((hit, i) => (
                <button
                  key={`${hit.filePath}:${hit.startLine}`}
                  className={`mention-item ${i === mentionIdx ? 'active' : ''}`}
                  onMouseEnter={() => setMentionIdx(i)}
                  onClick={() => {
                    attachFile(hit.filePath)
                    setText((t) => t.replace(/@[^@\s]*$/, ''))
                    setMentionOpen(false)
                    setMentionQuery('')
                    clearSearch()
                    setMentionIdx(0)
                    taRef.current?.focus()
                  }}
                >
                  <FileCode size={12} />
                  <div className="mention-item-body">
                    <div className="mention-item-path">{hit.filePath}</div>
                    {hit.symbol && (
                      <div className="mention-item-symbol">
                        {hit.kind}: <code>{hit.symbol}</code>
                        <span className="mention-item-lines">
                          {' '}L{hit.startLine}–{hit.endLine}
                        </span>
                      </div>
                    )}
                  </div>
                  <span className="mention-item-score">
                    {(hit.score * 100).toFixed(0)}%
                  </span>
                </button>
              ))}
              <div className="mention-popup-footer">
                <kbd>↑↓</kbd> navigate · <kbd>↵</kbd> attach · <kbd>esc</kbd> close
              </div>
            </div>
          )}

          <textarea
            ref={taRef}
            className="chat-input"
            placeholder={
              settings.provider === 'demo'
                ? 'Ask anything… type @ to search your codebase'
                : `Message ${settings.provider}… type @ to add files`
            }
            value={text}
            rows={1}
            onChange={(e) => {
              onTextChange(e.target.value)
              autosize(e.target)
            }}
            onKeyDown={onKey}
            onBlur={() => {
              // delay so click on popup registers first
              setTimeout(() => {
                setMentionOpen(false)
              }, 200)
            }}
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
        <div className="chat-hint-row">
          <span className="chat-hint">
            <AtSign size={10} /> <code>@</code> to attach files
          </span>
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
  const [showApply, setShowApply] = useState(false)
  const [targetPath, setTargetPath] = useState('')
  const activeTabId = useStore((s) => s.activeTabId)
  const tabs = useStore((s) => s.tabs)
  const toast = useStore((s) => s.toast)
  const applyCodeToFile = useStore((s) => s.applyCodeToFile)

  // Infer the target filename from code content or active file
  const inferPath = (): string => {
    // Check for `// filepath:` or `# filepath:` annotation
    const fpMatch = code.match(/^(?:\/\/|#|<!--)\s*(?:filepath|file|path)[:\s]+(.+?)\s*(?:-->|\n|$)/im)
    if (fpMatch) return fpMatch[1].trim()
    // Fall back to active file
    const tab = tabs.find((t) => t.id === activeTabId)
    if (tab) return tab.path
    // Infer from language
    const extMap: Record<string, string> = {
      typescript: 'snippet.ts', javascript: 'snippet.js', python: 'snippet.py',
      go: 'snippet.go', rust: 'snippet.rs', java: 'Snippet.java',
      css: 'snippet.css', html: 'snippet.html', json: 'snippet.json',
    }
    return extMap[lang] ?? 'snippet.txt'
  }

  const copy = () => {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const doApply = async () => {
    const path = targetPath.trim() || inferPath()
    await applyCodeToFile(path, code)
    setShowApply(false)
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
      {showApply ? (
        <div className="code-apply-bar">
          <FileEdit size={11} />
          <input
            className="code-apply-input"
            value={targetPath}
            placeholder={inferPath()}
            onChange={(e) => setTargetPath(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') doApply(); if (e.key === 'Escape') setShowApply(false) }}
            autoFocus
          />
          <button className="code-action-btn apply" onClick={doApply}>
            <Check size={11} /> Apply
          </button>
          <button className="code-action-btn" onClick={() => setShowApply(false)}>
            <X size={11} />
          </button>
        </div>
      ) : (
        <div className="code-actions">
          <button className="code-action-btn" onClick={copy}>
            {copied ? <Check size={11} /> : <Copy size={11} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button className="code-action-btn apply" onClick={() => { setTargetPath(inferPath()); setShowApply(true) }}>
            <FileEdit size={11} />
            Apply to file
          </button>
        </div>
      )}
    </div>
  )
}
