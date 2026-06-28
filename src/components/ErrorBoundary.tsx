import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}
interface State {
  hasError: boolean
  error: Error | null
}

/**
 * Root error boundary — prevents an uncaught error in any panel from
 * white-screening the entire app. Renders a recoverable fallback UI.
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Log to console for debugging; a production app might forward to a service.
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null })
  }

  handleHardReload = () => {
    window.location.reload()
  }

  render() {
    if (!this.state.hasError) return this.props.children
    const msg = this.state.error?.message ?? 'Unknown error'
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg, #0d0d12)',
          color: 'var(--text, #e6e6ef)',
          fontFamily: 'system-ui, sans-serif',
          padding: 24,
          zIndex: 9999,
        }}
      >
        <div style={{ maxWidth: 480, textAlign: 'center' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>⚠️</div>
          <h1 style={{ fontSize: 20, margin: '0 0 8px' }}>Something went wrong</h1>
          <p style={{ opacity: 0.7, marginBottom: 20 }}>
            Newton hit an unexpected error in one of its panels. You can try to recover without losing
            your work, or reload the editor.
          </p>
          <pre
            style={{
              background: 'rgba(255,255,255,0.06)',
              padding: 12,
              borderRadius: 8,
              fontSize: 12,
              textAlign: 'left',
              overflow: 'auto',
              maxHeight: 160,
              marginBottom: 20,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {msg}
          </pre>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button
              onClick={this.handleReload}
              style={{
                padding: '8px 16px',
                borderRadius: 6,
                border: '1px solid rgba(255,255,255,0.15)',
                background: 'transparent',
                color: 'inherit',
                cursor: 'pointer',
              }}
            >
              Try to recover
            </button>
            <button
              onClick={this.handleHardReload}
              style={{
                padding: '8px 16px',
                borderRadius: 6,
                border: 'none',
                background: 'var(--accent, #7c5cff)',
                color: '#fff',
                cursor: 'pointer',
              }}
            >
              Reload editor
            </button>
          </div>
        </div>
      </div>
    )
  }
}