import { useEffect, useState } from 'react'
import { DiffEditor } from '@monaco-editor/react'
import {
  GitBranch,
  GitCommitHorizontal,
  Plus,
  Minus,
  Check,
  RefreshCw,
  FileEdit,
  FilePlus,
  FileMinus,
  FileDiff,
  ChevronDown,
  ChevronRight,
  Sparkles,
  Brain,
  ShieldCheck,
  X,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useStore, type GitFileChange } from '../store'

const STATUS_META: Record<string, { label: string; color: string; Icon: any }> = {
  M: { label: 'Modified', color: 'var(--yellow)', Icon: FileEdit },
  A: { label: 'Added', color: 'var(--green)', Icon: FilePlus },
  D: { label: 'Deleted', color: 'var(--red)', Icon: FileMinus },
  R: { label: 'Renamed', color: 'var(--blue)', Icon: FileDiff },
  U: { label: 'Untracked', color: 'var(--green)', Icon: FilePlus },
  C: { label: 'Conflict', color: 'var(--red)', Icon: FileEdit },
}

export default function SourceControlPanel() {
  const gitStatus = useStore((s) => s.gitStatus)
  const gitBusy = useStore((s) => s.gitBusy)
  const refreshGit = useStore((s) => s.refreshGit)
  const stageFiles = useStore((s) => s.stageFiles)
  const unstageFiles = useStore((s) => s.unstageFiles)
  const stageAll = useStore((s) => s.stageAll)
  const gitCommit = useStore((s) => s.gitCommit)
  const gitInit = useStore((s) => s.gitInit)
  const viewDiff = useStore((s) => s.viewDiff)
  const diffText = useStore((s) => s.diffText)
  const diffContent = useStore((s) => s.diffContent)
  const diffBusy = useStore((s) => s.diffBusy)
  const clearDiff = useStore((s) => s.clearDiff)
  const openFile = useStore((s) => s.openFile)
  // AI SCM actions
  const aiSuggestCommit = useStore((s) => s.aiSuggestCommit)
  const aiExplainDiff = useStore((s) => s.aiExplainDiff)
  const aiReviewDiff = useStore((s) => s.aiReviewDiff)
  const aiInsight = useStore((s) => s.aiInsight)
  const aiInsightBusy = useStore((s) => s.aiInsightBusy)
  const clearAiInsight = useStore((s) => s.clearAiInsight)

  const [commitMsg, setCommitMsg] = useState('')
  const [stagedOpen, setStagedOpen] = useState(true)
  const [changesOpen, setChangesOpen] = useState(true)

  useEffect(() => {
    if (!gitStatus) refreshGit()
  }, [gitStatus, refreshGit])

  // Not a git repo
  if (gitStatus && !gitStatus.initialized) {
    return (
      <div className="sidebar">
        <div className="sidebar-header">
          <span>Source Control</span>
          <button className="icon-btn" title="Refresh" onClick={() => refreshGit()}>
            <RefreshCw size={14} className={gitBusy ? 'spin' : ''} />
          </button>
        </div>
        <div className="scm-empty">
          <GitBranch size={32} style={{ opacity: 0.3, marginBottom: 12 }} />
          <p>No Git repository found in this workspace.</p>
          <button className="btn btn-primary" onClick={() => gitInit()}>
            Initialize Repository
          </button>
        </div>
      </div>
    )
  }

  const changes = gitStatus?.changes ?? []
  const staged = changes.filter((c) => c.staged)
  const unstaged = changes.filter((c) => !c.staged)

  const handleCommit = async () => {
    if (!commitMsg.trim()) return
    // If nothing staged, stage all first
    if (staged.length === 0 && unstaged.length > 0) {
      await stageAll()
    }
    const ok = await gitCommit(commitMsg)
    if (ok) setCommitMsg('')
  }

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <span>Source Control</span>
        <button
          className="icon-btn"
          title="Refresh (git status)"
          onClick={() => refreshGit()}
          disabled={gitBusy}
        >
          <RefreshCw size={14} className={gitBusy ? 'spin' : ''} />
        </button>
      </div>

      {/* Branch + ahead/behind */}
      {gitStatus?.branch && (
        <div className="scm-branch-bar">
          <GitBranch size={13} />
          <span className="scm-branch-name">{gitStatus.branch}</span>
          {(gitStatus.ahead > 0 || gitStatus.behind > 0) && (
            <span className="scm-ahead-behind">
              {gitStatus.ahead > 0 && <span className="scm-ahead">↑{gitStatus.ahead}</span>}
              {gitStatus.behind > 0 && <span className="scm-behind">↓{gitStatus.behind}</span>}
            </span>
          )}
        </div>
      )}

      {/* Commit box */}
      <div className="scm-commit-area">
        <textarea
          className="scm-commit-input"
          placeholder="Commit message…"
          value={commitMsg}
          onChange={(e) => setCommitMsg(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault()
              handleCommit()
            }
          }}
          rows={2}
        />
        <div className="scm-commit-actions">
          <button
            className="btn btn-primary scm-commit-btn"
            onClick={handleCommit}
            disabled={gitBusy || !commitMsg.trim() || changes.length === 0}
          >
            <GitCommitHorizontal size={14} />
            {staged.length === 0 && unstaged.length > 0 ? 'Stage All & Commit' : 'Commit'}
          </button>
          <button
            className="btn btn-ghost scm-ai-commit-btn"
            title="Generate commit message from staged changes"
            onClick={async () => {
              const msg = await aiSuggestCommit()
              if (msg) setCommitMsg(msg)
            }}
            disabled={gitBusy || changes.length === 0}
          >
            <Sparkles size={14} />
            AI Message
          </button>
        </div>
      </div>

      {/* Changes list */}
      <div className="scm-changes-list">
        {/* Staged */}
        {staged.length > 0 && (
          <div className="scm-section">
            <div className="scm-section-header" onClick={() => setStagedOpen(!stagedOpen)}>
              {stagedOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <span>Staged Changes</span>
              <span className="scm-count">{staged.length}</span>
              <button
                className="scm-stage-all-btn"
                title="Unstage all"
                onClick={(e) => {
                  e.stopPropagation()
                  unstageFiles(staged.map((c) => c.path))
                }}
              >
                <Minus size={13} />
              </button>
            </div>
            {stagedOpen &&
              staged.map((c) => (
                <ChangeRow
                  key={c.path}
                  change={c}
                  onStage={() => stageFiles([c.path])}
                  onUnstage={() => unstageFiles([c.path])}
                  onViewDiff={() => viewDiff(c.path, true)}
                  onOpen={() => openFile(c.path)}
                />
              ))}
          </div>
        )}

        {/* Unstaged / Changes */}
        {unstaged.length > 0 && (
          <div className="scm-section">
            <div className="scm-section-header" onClick={() => setChangesOpen(!changesOpen)}>
              {changesOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              <span>Changes</span>
              <span className="scm-count">{unstaged.length}</span>
              <button
                className="scm-stage-all-btn"
                title="Stage all"
                onClick={(e) => {
                  e.stopPropagation()
                  stageAll()
                }}
              >
                <Plus size={13} />
              </button>
            </div>
            {changesOpen &&
              unstaged.map((c) => (
                <ChangeRow
                  key={c.path}
                  change={c}
                  onStage={() => stageFiles([c.path])}
                  onUnstage={() => unstageFiles([c.path])}
                  onViewDiff={() => viewDiff(c.path, false)}
                  onOpen={() => openFile(c.path)}
                />
              ))}
          </div>
        )}

        {/* Empty state */}
        {changes.length === 0 && !gitBusy && (
          <div className="scm-empty">
            <Check size={28} style={{ opacity: 0.3, marginBottom: 8 }} />
            <p>No changes. Working tree is clean.</p>
          </div>
        )}
      </div>

      {/* HEAD commit info */}
      {gitStatus?.head && (
        <div className="scm-head-info">
          <span className="scm-head-hash">{gitStatus.head.hash}</span>
          <span className="scm-head-msg">{gitStatus.head.message}</span>
        </div>
      )}

      {/* Diff viewer modal */}
      {diffText !== null && (
        <div className="scm-diff-modal" onClick={() => clearDiff()}>
          <div className="scm-diff-content" onClick={(e) => e.stopPropagation()}>
            <div className="scm-diff-header">
              <div className="scm-diff-header-left">
                <span>Diff</span>
                <div className="scm-diff-ai-actions">
                  <button
                    className="btn btn-ghost btn-xs"
                    title="Explain this diff with AI"
                    onClick={() => aiExplainDiff(diffText)}
                    disabled={aiInsightBusy}
                  >
                    <Brain size={13} /> Explain
                  </button>
                  <button
                    className="btn btn-ghost btn-xs"
                    title="AI code review for this diff"
                    onClick={() =>
                      aiReviewDiff(
                        diffText,
                        staged.map((c) => c.path),
                      )
                    }
                    disabled={aiInsightBusy}
                  >
                    <ShieldCheck size={13} /> Review
                  </button>
                </div>
              </div>
              <button className="icon-btn" onClick={() => clearDiff()}>
                ✕
              </button>
            </div>

            {aiInsight && (
              <div
                className={`scm-ai-insight ${aiInsight.kind === 'review' ? 'is-review' : 'is-explain'}`}
              >
                <div className="scm-ai-insight-head">
                  <span className="scm-ai-insight-title">
                    {aiInsight.kind === 'review' ? (
                      <>
                        <ShieldCheck size={13} /> AI Code Review
                      </>
                    ) : (
                      <>
                        <Brain size={13} /> AI Explanation
                      </>
                    )}
                  </span>
                  <button className="icon-btn" onClick={() => clearAiInsight()}>
                    <X size={13} />
                  </button>
                </div>
                <div className="scm-ai-insight-body">
                  {aiInsightBusy ? (
                    <div className="scm-insight-loading">
                      <Sparkles size={14} className="spin-slow" /> Analyzing…
                    </div>
                  ) : (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {aiInsight.text}
                    </ReactMarkdown>
                  )}
                </div>
              </div>
            )}

            {diffBusy && (
              <div className="scm-diff-loading">Loading diff…</div>
            )}
            {diffContent ? (
              <div className="scm-diff-monaco">
                <DiffEditor
                  height="60vh"
                  theme="vs-dark"
                  original={diffContent.original}
                  modified={diffContent.modified}
                  language={diffContent.language}
                  options={{
                    readOnly: true,
                    renderSideBySide: true,
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    fontSize: 13,
                    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
                    scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 },
                  }}
                />
              </div>
            ) : (
              <pre className="scm-diff-text">
                {diffText.split('\n').map((line, i) => {
                  let cls = 'diff-line'
                  if (line.startsWith('+') && !line.startsWith('+++')) cls += ' diff-add'
                  else if (line.startsWith('-') && !line.startsWith('---')) cls += ' diff-del'
                  else if (line.startsWith('@@')) cls += ' diff-hunk'
                  else if (line.startsWith('diff ') || line.startsWith('index ')) cls += ' diff-meta'
                  return (
                    <div key={i} className={cls}>
                      {line || ' '}
                    </div>
                  )
                })}
              </pre>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function ChangeRow({
  change,
  onStage,
  onUnstage,
  onViewDiff,
  onOpen,
}: {
  change: GitFileChange
  onStage: () => void
  onUnstage: () => void
  onViewDiff: () => void
  onOpen: () => void
}) {
  const meta = STATUS_META[change.status] ?? STATUS_META.M
  const { Icon } = meta
  const fileName = change.path.split('/').pop() ?? change.path
  const dir = change.path.includes('/') ? change.path.slice(0, change.path.lastIndexOf('/')) : ''

  return (
    <div className="scm-change-row" title={change.path}>
      <div className="scm-change-info" onClick={onViewDiff}>
        <Icon size={13} style={{ color: meta.color, flexShrink: 0 }} />
        <span className="scm-file-name">{fileName}</span>
        {dir && <span className="scm-file-dir">{dir}</span>}
        <span className="scm-status-letter" style={{ color: meta.color }}>
          {change.status}
        </span>
      </div>
      <div className="scm-change-actions">
        <button className="icon-btn-sm" title="Open file" onClick={onOpen}>
          <FileEdit size={12} />
        </button>
        {change.staged ? (
          <button className="icon-btn-sm" title="Unstage" onClick={onUnstage}>
            <Minus size={13} />
          </button>
        ) : (
          <button className="icon-btn-sm" title="Stage" onClick={onStage}>
            <Plus size={13} />
          </button>
        )}
      </div>
    </div>
  )
}