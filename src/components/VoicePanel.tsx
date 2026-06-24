import { useEffect, useRef, useState } from 'react'
import { Mic, MicOff, X, Keyboard, MessageSquare, Wand2 } from 'lucide-react'
import { useStore } from '../store'

// TypeScript doesn't include webkitSpeechRecognition types
type AnyRecognition = any

export default function VoicePanel() {
  const voiceOpen = useStore((s) => s.voiceOpen)
  const setVoiceOpen = useStore((s) => s.setVoiceOpen)
  const sendMessage = useStore((s) => s.sendMessage)
  const updateTabContent = useStore((s) => s.updateTabContent)
  const activeTabId = useStore((s) => s.activeTabId)
  const tabs = useStore((s) => s.tabs)
  const activeTab = tabs.find((t) => t.id === activeTabId)

  const [listening, setListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [interim, setInterim] = useState('')
  const [mode, setMode] = useState<'chat' | 'insert' | 'command'>('chat')
  const [supported, setSupported] = useState(true)
  const [error, setError] = useState('')
  const recogRef = useRef<AnyRecognition>(null)

  useEffect(() => {
    const SR =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) {
      setSupported(false)
      return
    }
    const r = new SR()
    r.continuous = true
    r.interimResults = true
    r.lang = 'en-US'

    r.onresult = (event: any) => {
      let finalText = ''
      let interimText = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript
        if (event.results[i].isFinal) finalText += t
        else interimText += t
      }
      if (finalText) {
        setTranscript((prev) => prev + finalText)
      }
      setInterim(interimText)
    }

    r.onerror = (e: any) => {
      setError(e.error === 'not-allowed' ? 'Microphone permission denied.' : `Error: ${e.error}`)
      setListening(false)
    }

    r.onend = () => {
      setListening(false)
    }

    recogRef.current = r
    return () => {
      try {
        r.abort()
      } catch {
        /* ignore */
      }
    }
  }, [])

  if (!voiceOpen) return null

  const toggleListen = () => {
    setError('')
    if (!recogRef.current) return
    if (listening) {
      recogRef.current.stop()
      setListening(false)
    } else {
      setTranscript('')
      setInterim('')
      try {
        recogRef.current.start()
        setListening(true)
      } catch (e) {
        setError('Could not start microphone.')
      }
    }
  }

  const handleSend = () => {
    const text = transcript.trim()
    if (!text) return
    if (mode === 'chat') {
      sendMessage(text)
      setTranscript('')
    } else if (mode === 'insert' && activeTab) {
      updateTabContent(activeTab.id, activeTab.content + '\n' + text)
      setTranscript('')
      setVoiceOpen(false)
    } else if (mode === 'command') {
      // route to chat with a prefix so agent picks it up
      sendMessage(text)
      setTranscript('')
    }
  }

  const modes = [
    { id: 'chat' as const, label: 'Chat', icon: MessageSquare },
    { id: 'insert' as const, label: 'Insert', icon: Keyboard },
    { id: 'command' as const, label: 'Agent', icon: Wand2 },
  ]

  return (
    <div className="voice-overlay" onClick={() => setVoiceOpen(false)}>
      <div className="voice-panel" onClick={(e) => e.stopPropagation()}>
        <div className="voice-header">
          <span className="voice-title">
            <Mic size={14} /> Voice Coding
          </span>
          <button className="voice-close" onClick={() => setVoiceOpen(false)}>
            <X size={16} />
          </button>
        </div>

        {!supported && (
          <div className="voice-unsupported">
            Voice recognition requires Chrome or Edge. Try opening in one of those browsers.
          </div>
        )}

        {supported && (
          <>
            <div className="voice-modes">
              {modes.map((m) => (
                <button
                  key={m.id}
                  className={`voice-mode-btn ${mode === m.id ? 'active' : ''}`}
                  onClick={() => setMode(m.id)}
                >
                  <m.icon size={13} /> {m.label}
                </button>
              ))}
            </div>

            <div className={`voice-visualizer ${listening ? 'listening' : ''}`}>
              <button
                className="mic-button"
                onClick={toggleListen}
                disabled={!supported}
                title={listening ? 'Stop' : 'Start'}
              >
                {listening ? <MicOff size={32} /> : <Mic size={32} />}
              </button>
              {listening && (
                <div className="voice-rings">
                  <span />
                  <span />
                  <span />
                </div>
              )}
            </div>

            <div className="voice-status">
              {listening ? (
                <span className="voice-pulse">● Listening…</span>
              ) : (
                <span>Click mic to start</span>
              )}
            </div>

            {(transcript || interim) && (
              <div className="voice-transcript">
                <span className="voice-final">{transcript}</span>
                <span className="voice-interim">{interim}</span>
              </div>
            )}

            {error && <div className="voice-error">{error}</div>}

            <button
              className="voice-send-btn"
              disabled={!transcript.trim()}
              onClick={handleSend}
            >
              {mode === 'insert' ? 'Insert at cursor' : mode === 'command' ? 'Send to Agent' : 'Send to Chat'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}