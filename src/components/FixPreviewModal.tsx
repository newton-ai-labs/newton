import { useState, useMemo, useEffect, useRef } from 'react'
import { useStore } from '../store'
import { Check, X, Sparkles, FileCode, Info } from 'lucide-react'

/**
 * Modal that shows a diff preview of an AI auto-fix.
 * The user can accept (apply) or reject (dismiss) the proposed change.
 */
export default function FixPreviewModal() {
  const preview = useStore((s) => s.fixPreview)
  const applyFix = useStore((s) => s.applyFix)
  const dismissFix = useStore((s) => s.dismissFix)
  const fixBusy = useStore((s) => s.fixBusy)
  const [applying, setApplying] = useState(false)
  const modalRef = useRef<HTMLDivElement>(null)

  const diff = useMemo(() => {
    if (!preview) return []
    const before = preview.originalContent.split('\n')
    const after = preview.fixedContent.split('\n')
    return computeLineDiff(before, after)
  }, [preview])

  // Escape key handler + focus trap (must be before early return)
  useEffect(() => {
    if (!preview) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        dismissFix()
        return
      }
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
    const focusable = modalRef.current?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )
    focusable?.focus()
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [preview, dismissFix])

  if (!preview) return null

  const addedCount = diff.filter((d) => d.type === 'added').length
  const removedCount = diff.filter((d) => d.type === 'removed').length
  const noChanges = !!preview.noChanges || (addedCount === 0 && removedCount === 0)

  const handleApply = async () => {
    setApplying(true)
    try {
      await applyFix()
    } finally {
      setApplying(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={dismissFix}>
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="fix-preview-title"
        className="modal fix-preview-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div className="modal-title" id="fix-preview-title">
            <Sparkles size={16} className="spark" style={{ color: 'var(--blue)' }} />
            <span>{noChanges ? 'No Automatic Fix Available' : 'AI Fix Preview'}</span>
            <span className="fix-preview-file">
              <FileCode size={13} />
              {preview.filePath}
            </span>
          </div>
          <button className="modal-close" onClick={dismissFix} title="Close">
            <X size={16} />
          </button>
        </div>

        <div className="fix-explanation">{preview.explanation}</div>

        {noChanges ? (
          <div className="fix-noop">
            <Info size={18} />
            <span>This diagnostic needs manual review or a more capable provider. No file changes will be applied.</span>
          </div>
        ) : (
          <>
            <div className="fix-diff-stats">
              <span className="diff-stat added">+{addedCount}</span>
              <span className="diff-stat removed">-{removedCount}</span>
            </div>

            <div className="fix-diff-container">
              {diff.map((line, idx) => (
                <div key={idx} className={`diff-line diff-${line.type}`}>
                  <span className="diff-gutter">
                    {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
                  </span>
                  <span className="diff-content">{line.text || ' '}</span>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="modal-footer">
          <button className="btn-secondary" onClick={dismissFix} disabled={applying || fixBusy}>
            {noChanges ? 'Close' : 'Cancel'}
          </button>
          {!noChanges && (
            <button className="btn-primary" onClick={handleApply} disabled={applying || fixBusy}>
              <Check size={14} />
              {applying ? 'Applying…' : 'Apply Fix'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

interface DiffLine {
  type: 'added' | 'removed' | 'unchanged'
  text: string
}

/**
 * Simple LCS-based line diff. Good enough for preview — not a full diff library,
 * but shows what changed clearly for typical small fixes.
 */
function computeLineDiff(before: string[], after: string[]): DiffLine[] {
  const result: DiffLine[] = []
  const m = before.length
  const n = after.length

  // Build LCS table (cap to avoid O(n*m) blowup on huge files)
  const MAX = 500
  if (m > MAX || n > MAX) {
    // Fallback: show entire after as added, before as removed
    before.slice(0, 100).forEach((t) => result.push({ type: 'removed', text: t }))
    after.slice(0, 100).forEach((t) => result.push({ type: 'added', text: t }))
    return result
  }

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (before[i - 1] === after[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  // Backtrack to produce diff
  const lines: DiffLine[] = []
  let i = m
  let j = n
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && before[i - 1] === after[j - 1]) {
      lines.unshift({ type: 'unchanged', text: before[i - 1] })
      i--
      j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      lines.unshift({ type: 'added', text: after[j - 1] })
      j--
    } else {
      lines.unshift({ type: 'removed', text: before[i - 1] })
      i--
    }
  }
  return lines
}
