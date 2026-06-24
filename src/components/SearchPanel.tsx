import { useEffect, useRef, useState } from 'react'
import {
  Search,
  CaseSensitive,
  Regex,
  WholeWord,
  ChevronRight,
  ChevronDown,
  X,
  Loader2,
  Sparkles,
} from 'lucide-react'
import { useStore } from '../store'
import { fileIcon, fileColor } from './fileIcons'

interface SearchResult {
  filePath: string
  line: number
  column: number
  preview: string
  matchLength: number
}

export default function SearchPanel() {
  const searchCode = useStore((s) => s.searchCode)
  const clearSearch = useStore((s) => s.clearSearch)
  const openFile = useStore((s) => s.openFile)
  const toast = useStore((s) => s.toast)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [busy, setBusy] = useState(false)
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [useRegex, setUseRegex] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [error, setError] = useState('')
  const [semanticMode, setSemanticMode] = useState(false)
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set())
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Debounced search
  useEffect(() => {
    const q = query.trim()
    if (!q) {
      setResults([])
      setBusy(false)
      setError('')
      return
    }

    setBusy(true)
    setError('')

    // For semantic mode, use the backend search API
    if (semanticMode) {
      const timer = setTimeout(async () => {
        await searchCode(q)
        setBusy(false)
      }, 300)
      return () => clearTimeout(timer)
    }

    // For literal/regex mode, search client-side via a backend grep endpoint
    const timer = setTimeout(async () => {
      try {
        let pattern: RegExp
        if (useRegex) {
          pattern = new RegExp(q, caseSensitive ? 'g' : 'gi')
        } else if (wholeWord) {
          pattern = new RegExp(`\\b${escapeRegex(q)}\\b`, caseSensitive ? 'g' : 'gi')
        } else {
          pattern = new RegExp(escapeRegex(q), caseSensitive ? 'g' : 'gi')
        }

        const params = new URLSearchParams({
          pattern: q,
          caseSensitive: String(caseSensitive),
          regex: String(useRegex),
          wholeWord: String(wholeWord),
          limit: '500',
        })
        const r = await fetch(`/api/grep?${params}`)
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const data = await r.json()
        setResults(data.results ?? [])
        setBusy(false)
      } catch (e) {
        setResults([])
        setBusy(false)
        setError(useRegex ? `Invalid regex: ${(e as Error).message}` : '')
      }
    }, 250)

    return () => clearTimeout(timer)
  }, [query, caseSensitive, useRegex, wholeWord, semanticMode]) // eslint-disable-line react-hooks/exhaustive-deps

  // Sync semantic results from store
  const searchResults = useStore((s) => s.searchResults)
  const searchStoreBusy = useStore((s) => s.searchBusy)
  useEffect(() => {
    if (semanticMode && searchResults) {
      const mapped: SearchResult[] = searchResults.map((hit) => ({
        filePath: hit.filePath,
        line: hit.startLine,
        column: 1,
        preview: hit.snippet,
        matchLength: 0,
      }))
      setResults(mapped)
    }
  }, [semanticMode, searchResults])

  useEffect(() => {
    if (semanticMode) setBusy(searchStoreBusy)
  }, [semanticMode, searchStoreBusy])

  // Group results by file
  const grouped = groupByFile(results)
  const totalFiles = Object.keys(grouped).length
  const totalMatches = results.length

  function toggleFile(path: string) {
    setCollapsedFiles((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  async function openResult(result: SearchResult) {
    await openFile(result.filePath)
    // Note: line navigation would require a ref to the editor; for now we open the file
    toast(`${result.filePath}:${result.line}`)
  }

  function clearAll() {
    setQuery('')
    setResults([])
    clearSearch()
    inputRef.current?.focus()
  }

  return (
    <div className="search-panel">
      <div className="search-input-area">
        <div className="search-input-row">
          <div className="search-input-wrap">
            {semanticMode ? (
              <Sparkles size={14} className="search-mode-icon semantic" />
            ) : (
              <Search size={14} className="search-mode-icon" />
            )}
            <input
              ref={inputRef}
              className="search-input"
              placeholder={semanticMode ? 'Semantic search… (find by meaning)' : 'Search in files… (⌘⇧F)'}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') clearAll()
              }}
            />
            {busy && <Loader2 size={13} className="search-spin" />}
            {query && !busy && (
              <button className="search-clear" onClick={clearAll} title="Clear (Esc)">
                <X size={13} />
              </button>
            )}
          </div>
        </div>

        <div className="search-toggles">
          <button
            className={`search-toggle ${caseSensitive && !semanticMode ? 'active' : ''}`}
            onClick={() => { setCaseSensitive(!caseSensitive); setSemanticMode(false) }}
            title="Match Case"
            disabled={semanticMode}
          >
            <CaseSensitive size={15} />
          </button>
          <button
            className={`search-toggle ${wholeWord && !semanticMode ? 'active' : ''}`}
            onClick={() => { setWholeWord(!wholeWord); setSemanticMode(false) }}
            title="Whole Word"
            disabled={semanticMode}
          >
            <WholeWord size={15} />
          </button>
          <button
            className={`search-toggle ${useRegex && !semanticMode ? 'active' : ''}`}
            onClick={() => { setUseRegex(!useRegex); setSemanticMode(false) }}
            title="Use Regular Expression"
            disabled={semanticMode}
          >
            <Regex size={15} />
          </button>
          <div className="search-toggle-divider" />
          <button
            className={`search-toggle ${semanticMode ? 'active semantic' : ''}`}
            onClick={() => setSemanticMode(!semanticMode)}
            title="AI Semantic Search"
          >
            <Sparkles size={13} />
            <span className="toggle-label">AI</span>
          </button>
        </div>
      </div>

      {error && <div className="search-error">{error}</div>}

      <div className="search-summary">
        {!query.trim() ? (
          <span className="search-hint-text">Type to search across all files in the workspace.</span>
        ) : busy ? (
          <span className="search-hint-text">Searching…</span>
        ) : totalMatches === 0 ? (
          <span className="search-hint-text">No results found.</span>
        ) : (
          <span>
            <strong>{totalMatches}</strong> result{totalMatches !== 1 ? 's' : ''} in{' '}
            <strong>{totalFiles}</strong> file{totalFiles !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      <div className="search-results-list">
        {Object.entries(grouped).map(([filePath, matches]) => {
          const fileName = filePath.split('/').pop() ?? filePath
          const fileDir = filePath.includes('/')
            ? filePath.slice(0, filePath.lastIndexOf('/'))
            : ''
          const Icon = fileIcon(fileName)
          const color = fileColor(fileName)
          const collapsed = collapsedFiles.has(filePath)
          return (
            <div key={filePath} className="search-file-group">
              <div
                className="search-file-header"
                onClick={() => toggleFile(filePath)}
              >
                {collapsed ? (
                  <ChevronRight size={14} className="search-chevron" />
                ) : (
                  <ChevronDown size={14} className="search-chevron" />
                )}
                <span style={{ color }} className="search-file-icon">
                  <Icon size={14} />
                </span>
                <span className="search-file-name">{fileName}</span>
                {fileDir && <span className="search-file-dir">{fileDir}</span>}
                <span className="search-file-count">{matches.length}</span>
              </div>
              {!collapsed && (
                <div className="search-match-list">
                  {matches.map((m, i) => (
                    <div
                      key={i}
                      className="search-match-row"
                      onClick={() => openResult(m)}
                    >
                      <span className="search-line-num">{m.line}</span>
                      <span className="search-line-preview" dangerouslySetInnerHTML={{ __html: highlight(m.preview, query, useRegex, caseSensitive) }} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// --- helpers ---
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function groupByFile(results: SearchResult[]): Record<string, SearchResult[]> {
  const groups: Record<string, SearchResult[]> = {}
  for (const r of results) {
    if (!groups[r.filePath]) groups[r.filePath] = []
    groups[r.filePath].push(r)
  }
  return groups
}

function highlight(text: string, query: string, isRegex: boolean, caseSensitive: boolean): string {
  if (!query) return escapeHtml(text)
  let pattern: RegExp
  try {
    if (isRegex) {
      pattern = new RegExp(`(${query})`, caseSensitive ? 'g' : 'gi')
    } else {
      pattern = new RegExp(`(${escapeRegex(query)})`, caseSensitive ? 'g' : 'gi')
    }
  } catch {
    return escapeHtml(text)
  }
  return escapeHtml(text).replace(
    new RegExp(`(${isRegex ? query : escapeRegex(query)})`, caseSensitive ? 'g' : 'gi'),
    '<mark>$1</mark>',
  )
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&#38;')
    .replace(/</g, '&#60;')
    .replace(/>/g, '&#62;')
    .replace(/"/g, '&#34;')
}
