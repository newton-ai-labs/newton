import { useState, useEffect, useCallback, useMemo } from 'react'

// ---- types ----
interface Diagnostic {
  filePath: string
  line: number
  column: number
  severity: 'error' | 'warning'
  message: string
  code?: string
  source: string
}

interface DiagnosticsResult {
  diagnostics: Diagnostic[]
  errorCount: number
  warningCount: number
  available: boolean
}

// ---- icon helpers ----
const ErrorIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="8" r="7" fill="var(--error, #f14c4c)" />
    <path d="M5 5L11 11M11 5L5 11" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
)
const WarningIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
    <path d="M8 1L15 14H1L8 1Z" fill="var(--warning, #cca700)" />
    <path d="M8 6V9M8 11.5V12" stroke="#1e1e1e" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
)
const ChevronIcon = ({ open }: { open: boolean }) => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 16 16"
    fill="none"
    style={{
      transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
      transition: 'transform 0.15s ease',
    }}
  >
    <path d="M6 4L10 8L6 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)
const RefreshIcon = ({ spinning }: { spinning: boolean }) => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 16 16"
    fill="none"
    style={{ animation: spinning ? 'spin 0.8s linear infinite' : undefined }}
  >
    <path
      d="M2 8a6 6 0 0110.5-3.5M14 8A6 6 0 013.5 11.5M14 2v3h-3M2 14v-3h3"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
)
const FilterIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
    <path
      d="M1.5 2.5h13l-5 6v5l-3-1.5v-3.5l-5-6z"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinejoin="round"
    />
  </svg>
)

// ---- component ----
export function ProblemsPanel({ onOpenFile }: { onOpenFile?: (path: string, line?: number, col?: number) => void }) {
  const [result, setResult] = useState<DiagnosticsResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'errors' | 'warnings'>('all')
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set())
  const [autoRefresh, setAutoRefresh] = useState(true)

  const fetchDiagnostics = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/diagnostics/refresh', { method: 'POST' })
      if (r.ok) {
        const data: DiagnosticsResult = await r.json()
        setResult(data)
      }
    } catch {
      // ignore — keep last result
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial fetch + auto-refresh interval
  useEffect(() => {
    fetchDiagnostics()
    if (!autoRefresh) return
    const interval = setInterval(fetchDiagnostics, 30000) // refresh every 30s
    return () => clearInterval(interval)
  }, [fetchDiagnostics, autoRefresh])

  // Group diagnostics by file
  const grouped = useMemo(() => {
    if (!result?.diagnostics) return [] as Array<{ filePath: string; diags: Diagnostic[] }>
    const filtered =
      filter === 'errors'
        ? result.diagnostics.filter((d) => d.severity === 'error')
        : filter === 'warnings'
          ? result.diagnostics.filter((d) => d.severity === 'warning')
          : result.diagnostics

    const map = new Map<string, Diagnostic[]>()
    for (const d of filtered) {
      if (!map.has(d.filePath)) map.set(d.filePath, [])
      map.get(d.filePath)!.push(d)
    }
    // Sort: files with errors first, then by name
    return Array.from(map.entries())
      .map(([filePath, diags]) => ({ filePath, diags }))
      .sort((a, b) => {
        const aHasErr = a.diags.some((d) => d.severity === 'error')
        const bHasErr = b.diags.some((d) => d.severity === 'error')
        if (aHasErr !== bHasErr) return aHasErr ? -1 : 1
        return a.filePath.localeCompare(b.filePath)
      })
  }, [result, filter])

  const toggleFile = (filePath: string) => {
    setCollapsedFiles((prev) => {
      const next = new Set(prev)
      if (next.has(filePath)) next.delete(filePath)
      else next.add(filePath)
      return next
    })
  }

  const handleClick = (diag: Diagnostic) => {
    onOpenFile?.(diag.filePath, diag.line, diag.column)
  }

  const errors = result?.errorCount ?? 0
  const warnings = result?.warningCount ?? 0
  const totalShown = grouped.reduce((sum, g) => sum + g.diags.length, 0)

  return (
    <div className="problems-panel">
      <div className="problems-header">
        <div className="problems-title">
          <span className="problems-count-badge" style={{ color: errors > 0 ? 'var(--error, #f14c4c)' : undefined }}>
            <ErrorIcon /> {errors}
          </span>
          <span className="problems-count-badge" style={{ color: warnings > 0 ? 'var(--warning, #cca700)' : undefined }}>
            <WarningIcon /> {warnings}
          </span>
        </div>
        <div className="problems-toolbar">
          <button
            className={`problems-filter-btn ${filter === 'errors' ? 'active' : ''}`}
            title="Show only errors"
            onClick={() => setFilter('errors')}
          >
            <ErrorIcon />
          </button>
          <button
            className={`problems-filter-btn ${filter === 'warnings' ? 'active' : ''}`}
            title="Show only warnings"
            onClick={() => setFilter('warnings')}
          >
            <WarningIcon />
          </button>
          <button
            className={`problems-filter-btn ${filter === 'all' ? 'active' : ''}`}
            title="Show all"
            onClick={() => setFilter('all')}
          >
            <FilterIcon />
          </button>
          <button
            className="problems-refresh-btn"
            title="Refresh diagnostics"
            onClick={fetchDiagnostics}
            disabled={loading}
          >
            <RefreshIcon spinning={loading} />
          </button>
        </div>
      </div>

      <div className="problems-list">
        {loading && !result && (
          <div className="problems-empty">
            <div className="problems-empty-icon">⏳</div>
            <p>Analyzing workspace…</p>
            <p className="problems-empty-sub">Running TypeScript checker and linters</p>
          </div>
        )}

        {!loading && totalShown === 0 && (
          <div className="problems-empty">
            <div className="problems-empty-icon">✅</div>
            <p>No problems detected</p>
            <p className="problems-empty-sub">
              {result?.available
                ? 'Your code is clean!'
                : 'No TypeScript or ESLint configured — showing heuristic checks'}
            </p>
          </div>
        )}

        {grouped.map(({ filePath, diags }) => {
          const isOpen = !collapsedFiles.has(filePath)
          const fileName = filePath.split('/').pop() ?? filePath
          const dirPath = filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/')) : ''
          const fileErrors = diags.filter((d) => d.severity === 'error').length
          const fileWarnings = diags.filter((d) => d.severity === 'warning').length

          return (
            <div key={filePath} className="problems-file-group">
              <div
                className="problems-file-header"
                onClick={() => toggleFile(filePath)}
                role="button"
                tabIndex={0}
              >
                <ChevronIcon open={isOpen} />
                <span className="file-icon" aria-hidden>
                  📄
                </span>
                <span className="problems-file-name">{fileName}</span>
                {dirPath && <span className="problems-file-dir">{dirPath}</span>}
                <span className="problems-file-counts">
                  {fileErrors > 0 && (
                    <span className="problems-count-mini problems-count-error">
                      <ErrorIcon /> {fileErrors}
                    </span>
                  )}
                  {fileWarnings > 0 && (
                    <span className="problems-count-mini problems-count-warning">
                      <WarningIcon /> {fileWarnings}
                    </span>
                  )}
                </span>
              </div>
              {isOpen &&
                diags.map((diag, idx) => (
                  <div
                    key={`${filePath}-${idx}`}
                    className="problems-diag-row"
                    onClick={() => handleClick(diag)}
                    role="button"
                    tabIndex={0}
                  >
                    <span className="problems-diag-icon">
                      {diag.severity === 'error' ? <ErrorIcon /> : <WarningIcon />}
                    </span>
                    <span className="problems-diag-position">
                      {diag.line}:{diag.column}
                    </span>
                    <span className="problems-diag-message">{diag.message}</span>
                    <span className="problems-diag-source">
                      {diag.code ? `${diag.source}(${diag.code})` : diag.source}
                    </span>
                  </div>
                ))}
            </div>
          )
        })}
      </div>

      <div className="problems-footer">
        <label className="problems-autorefresh">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
          />
          Auto-refresh (30s)
        </label>
        <span className="problems-footer-count">
          {totalShown} {totalShown === 1 ? 'problem' : 'problems'}
        </span>
      </div>
    </div>
  )
}