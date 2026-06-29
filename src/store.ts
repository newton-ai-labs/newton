import { create } from 'zustand'
import { nanoid } from 'nanoid'
import {
  DEFAULT_SETTINGS,
  migrateSettings,
  type FileNode,
  type Settings,
  type ChatMessage,
  type ProviderConfig,
  type WorkspaceMemory,
  type MemoryEntryType,
  type Mission,
} from '../shared/types'

// ---------- constants ----------
const TOAST_DURATION_MS = 2600

// ---------- SEARCH/REPLACE patch parsing (Aider-style) ----------
/**
 * Parse Aider-style SEARCH/REPLACE blocks out of a code chunk.
 *
 * Expected per-block shape (newlines required as shown):
 *   <relative/path>
 *   <<<<<<< SEARCH
 *   <text to find — must match file exactly>
 *   =======
 *   <text to replace with>
 *   >>>>>>> REPLACE
 *
 * Multiple blocks can be concatenated. Returns [] if none are found.
 */
export interface PatchBlock { path: string; find: string; replace: string }
export function parsePatchBlocks(code: string): PatchBlock[] {
  const blocks: PatchBlock[] = []
  // Use a regex spanning the whole pattern. The path is the line immediately
  // before `<<<<<<< SEARCH`. SEARCH/REPLACE bodies are everything between the
  // markers, exclusive of leading/trailing newlines added by the format.
  const re = /(^|\n)([^\n]+)\n<{7} SEARCH\n([\s\S]*?)\n={7}\n([\s\S]*?)\n>{7} REPLACE/g
  let m: RegExpExecArray | null
  while ((m = re.exec(code)) !== null) {
    const path = m[2].trim()
    if (!path) continue
    blocks.push({ path, find: m[3], replace: m[4] })
  }
  return blocks
}
export function codeHasPatchBlocks(code: string): boolean {
  return /\n<{7} SEARCH\n/.test('\n' + code)
}

// ---------- types ----------
export interface EditorTab {
  id: string
  path: string
  name: string
  content: string
  savedContent: string
  language: string
}

export interface ChatMsg extends ChatMessage {
  id: string
  streaming?: boolean
}

interface Toast {
  id: string
  text: string
}

interface NewtonState {
  // workspace
  workspacePath: string | null

  // files
  tree: FileNode | null
  treeLoading: boolean
  expandedDirs: Record<string, boolean>

  // editor
  tabs: EditorTab[]
  activeTabId: string | null

  // chat
  messages: ChatMsg[]
  chatBusy: boolean

  // ui
  settingsOpen: boolean
  paletteOpen: boolean
  sidebarVisible: boolean
  chatVisible: boolean
  activeView: 'explorer' | 'search' | 'scm' | 'graph' | 'memory' | 'mission' | 'problems' | 'outline'
  settings: Settings
  toasts: Toast[]

  // git / source control
  gitStatus: GitStatusData | null
  gitBusy: boolean
  diffText: string | null
  diffBusy: boolean
  /** Side-by-side diff content for the Monaco DiffEditor (original vs modified). */
  diffContent: { original: string; modified: string; language: string; path: string } | null
  /** AI-generated explanation or review of a diff (shown in modal) */
  aiInsight: { kind: 'explain' | 'review'; text: string } | null
  aiInsightBusy: boolean

  // codebase search / @-mentions
  searchResults: SearchHit[]
  searchBusy: boolean
  searchQuery: string
  attachedContext: AttachedFile[]
  indexStats: { totalFiles: number; totalChunks: number; indexing: boolean } | null

  // actions
  refreshTree: () => Promise<void>
  openFolder: (folderPath: string) => Promise<void>
  uploadFiles: (files: Array<{ path: string; content: string }>) => Promise<void>
  createFromTemplate: (templateId: string, projectName: string) => Promise<void>
  openFile: (path: string) => Promise<void>
  closeTab: (id: string) => void
  setActiveTab: (id: string) => void
  updateTabContent: (id: string, content: string) => void
  saveTab: (id: string) => Promise<void>
  saveActiveTab: () => Promise<void>
  createFile: (path: string, type: 'file' | 'directory') => Promise<void>
  deleteNode: (path: string) => Promise<void>
  toggleDir: (path: string) => void

  // apply-from-chat: write code to a specific file (create or overwrite)
  applyCodeToFile: (path: string, content: string) => Promise<void>

  setSettings: (s: Partial<Settings>) => void
  sendMessage: (text: string) => Promise<void>
  stopGeneration: () => void
  clearChat: () => void

  /** Run an inline AI edit (⌘K); returns edited code or null on failure */
  runInlineEdit: (
    code: string,
    instruction: string,
    language: string,
    filePath?: string,
  ) => Promise<{ code: string; note?: string } | null>
  inlineEditBusy: boolean

  // voice coding
  voiceOpen: boolean
  setVoiceOpen: (v: boolean) => void

  // composer (multi-file AI editing)
  composerOpen: boolean
  setComposerOpen: (v: boolean) => void

  // NL shell terminal
  terminalOpen: boolean
  setTerminalOpen: (v: boolean) => void
  translateNlsh: (prompt: string) => Promise<string>
  execCommand: (command: string) => Promise<{ stdout: string; stderr: string; code: number }>

  // test generation
  genTestsBusy: boolean
  generateTests: () => Promise<void>

  // ---------- AI auto-fix for diagnostics ----------
  /** Current fix preview: shows a diff modal for user to accept/reject */
  fixPreview: {
    filePath: string
    originalContent: string
    fixedContent: string
    explanation: string
    changed?: boolean
    kind?: 'code-change' | 'manual-review' | 'unavailable'
    noChanges?: boolean
  } | null
  fixBusy: boolean
  /** Request an AI fix for a diagnostic. Reads file content, calls backend, opens preview. */
  fixDiagnostic: (diagnostic: {
    filePath: string
    line: number
    column: number
    severity: string
    message: string
    code?: string
    source: string
  }) => Promise<void>
  /** Apply the current fix preview to the file on disk + editor tab */
  applyFix: () => Promise<void>
  /** Dismiss the fix preview without applying */
  dismissFix: () => void

  setSettingsOpen: (v: boolean) => void
  setPaletteOpen: (v: boolean) => void
  setSidebarVisible: (v: boolean) => void
  setChatVisible: (v: boolean) => void
  setActiveView: (v: 'explorer' | 'search' | 'scm' | 'graph' | 'memory' | 'mission' | 'problems' | 'outline') => void
  toast: (text: string) => void

  // git / source control
  refreshGit: () => Promise<void>
  stageFiles: (paths: string[]) => Promise<void>
  unstageFiles: (paths: string[]) => Promise<void>
  stageAll: () => Promise<void>
  gitCommit: (message: string) => Promise<boolean>
  gitInit: () => Promise<void>
  viewDiff: (path: string, staged: boolean) => Promise<void>
  clearDiff: () => void

  // ---------- AI SCM ----------
  /** Generate a commit message from the current staged diff. Returns the message or null. */
  aiSuggestCommit: () => Promise<string | null>
  /** Ask the AI to explain a diff (shows result in the insight panel). */
  aiExplainDiff: (diff: string, path?: string) => Promise<void>
  /** Ask the AI to review a diff for bugs/security/perf (shows result in the insight panel). */
  aiReviewDiff: (diff: string, files: string[]) => Promise<void>
  clearAiInsight: () => void

  // ---------- repository graph ----------
  graphData: RepoGraphData | null
  graphLoading: boolean
  impactData: { file: string; impacted: { id: string; path: string; language?: string }[]; directDeps: string[] } | null
  impactLoading: boolean
  loadGraph: (force?: boolean) => Promise<void>
  loadImpact: (file: string) => Promise<void>
  clearImpact: () => void

  // codebase search / @-mentions
  searchCode: (query: string) => Promise<void>
  setSearchQuery: (q: string) => void
  clearSearch: () => void
  attachFile: (path: string) => Promise<void>
  detachFile: (path: string) => void
  clearAttached: () => void
  refreshIndexStats: () => Promise<void>
  rebuildIndex: () => Promise<void>

  // ---------- workspace memory ----------
  memory: WorkspaceMemory | null
  memoryBusy: boolean
  welcomeDigest: string | null
  loadMemory: () => Promise<void>
  refreshMemory: () => Promise<void>
  addMemoryEntry: (type: MemoryEntryType, text: string) => Promise<void>
  removeMemoryEntry: (id: string) => Promise<void>

  // ---------- mission control ----------
  missions: Mission[]
  activeMission: Mission | null
  missionBusy: boolean
  loadMissions: () => Promise<void>
  startMission: (goal: string, contextFiles?: string[]) => Promise<Mission | null>
  executeMission: (id: string) => Promise<void>
  refreshMission: (id: string) => Promise<void>
  patchMission: (id: string, patch: Partial<Mission>) => Promise<void>
  removeMission: (id: string) => Promise<void>
  verifyMission: (id: string) => Promise<void>
  setActiveMission: (m: Mission | null) => void
}

export interface SearchHit {
  filePath: string
  startLine: number
  endLine: number
  symbol?: string
  kind: string
  language: string
  score: number
  snippet: string
}

export interface AttachedFile {
  path: string
  content: string
}

// ---------- repo graph types ----------
export interface RepoGraphData {
  nodes: Record<
    string,
    {
      id: string
      path: string
      language: string
      lineCount: number
      symbolCount: number
      imports: string[]
      externalDeps: string[]
    }
  >
  edges: Array<{ source: string; target: string }>
  buildStats: { parsed: number; cached: number; total: number }
}

// ---------- git types ----------
export interface GitFileChange {
  path: string
  status: 'M' | 'A' | 'D' | 'R' | 'U' | 'C'
  staged: boolean
  oldPath?: string
}

export interface GitStatusData {
  initialized: boolean
  branch: string | null
  ahead: number
  behind: number
  changes: GitFileChange[]
  head: { hash: string; message: string; author: string; date: string } | null
}

// ---------- helpers ----------
export function langFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    json: 'json',
    md: 'markdown',
    markdown: 'markdown',
    css: 'css',
    scss: 'scss',
    html: 'html',
    py: 'python',
    go: 'go',
    rs: 'rust',
    rb: 'ruby',
    java: 'java',
    c: 'c',
    cpp: 'cpp',
    h: 'cpp',
    sh: 'shell',
    yml: 'yaml',
    yaml: 'yaml',
    toml: 'ini',
    sql: 'sql',
    vue: 'html',
    svelte: 'html',
    php: 'php',
    swift: 'swift',
    kt: 'kotlin',
    dart: 'dart',
    lua: 'lua',
  }
  return map[ext] ?? 'plaintext'
}

function guessTestPath(filePath: string): string {
  const parts = filePath.split('/')
  const name = parts.pop() ?? filePath
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : ''
  const base = ext ? name.slice(0, -ext.length) : name
  return [...parts, `${base}.test${ext || '.ts'}`].join('/')
}

/**
 * Build a ProviderConfig from the new registry-driven Settings.
 * Reads the per-provider config map (providerConfigs) for the active provider.
 */
export function providerConfig(s: Settings): ProviderConfig {
  if (s.provider === 'demo') return { provider: 'demo', model: 'demo' }
  const pc = s.providerConfigs[s.provider]
  return {
    provider: s.provider,
    model: pc?.model || 'demo',
    apiKey: pc?.apiKey || undefined,
    baseUrl: pc?.baseUrl || undefined,
  }
}

let abortCtrl: AbortController | null = null

// ---------- store ----------
export const useStore = create<NewtonState>((set, get) => ({
  workspacePath: null,

  tree: null,
  treeLoading: false,
  expandedDirs: {},

  tabs: [],
  activeTabId: null,

  messages: [],
  chatBusy: false,

  settingsOpen: false,
  paletteOpen: false,
  sidebarVisible: true,
  chatVisible: true,
  activeView: 'explorer',
  settings: loadSettings(),
  toasts: [],

  searchResults: [],
  searchBusy: false,
  searchQuery: '',
  attachedContext: [],
  indexStats: null,

  // git / source control
  gitStatus: null,
  gitBusy: false,
  diffText: null,
  diffBusy: false,
  diffContent: null,
  aiInsight: null,
  aiInsightBusy: false,

  // repository graph
  graphData: null,
  graphLoading: false,
  impactData: null,
  impactLoading: false,

  refreshTree: async () => {
    set({ treeLoading: true })
    try {
      const r = await fetch('/api/files')
      const data = await r.json()
      // expand root by default
      const expanded = { ...get().expandedDirs }
      if (data.tree) expanded[data.tree.path] = true
      set({ tree: data.tree, treeLoading: false, expandedDirs: expanded, workspacePath: data.root })
    } catch {
      set({ treeLoading: false })
    }
  },

  openFolder: async (folderPath: string) => {
    set({ treeLoading: true })
    try {
      const r = await fetch('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: folderPath }),
      })
      if (!r.ok) {
        const err = await r.json()
        throw new Error(err.error || 'Failed to open folder')
      }
      const data = await r.json()
      set({ workspacePath: data.path, tabs: [], activeTabId: null, expandedDirs: {} })
      // Refresh the file tree for the new workspace
      await get().refreshTree()
      get().toast(`Opened ${data.path}`)
    } catch (e) {
      set({ treeLoading: false })
      get().toast((e as Error).message)
    }
  },

  uploadFiles: async (files) => {
    try {
      const r = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ files }),
      })
      if (!r.ok) throw new Error('Upload failed')
      const data = await r.json()
      const successes = data.results.filter((r: { success: boolean }) => r.success).length
      const failures = data.results.filter((r: { success: boolean }) => !r.success).length
      await get().refreshTree()
      if (failures > 0) {
        get().toast(`Uploaded ${successes} files, ${failures} failed`)
      } else {
        get().toast(`Uploaded ${successes} files`)
      }
    } catch (e) {
      get().toast((e as Error).message)
    }
  },

  createFromTemplate: async (templateId, projectName) => {
    set({ treeLoading: true })
    try {
      const r = await fetch('/api/templates/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId, projectName }),
      })
      if (!r.ok) {
        const err = await r.json()
        throw new Error(err.error || 'Failed to create project')
      }
      const data = await r.json()
      set({ workspacePath: data.path, tabs: [], activeTabId: null, expandedDirs: {} })
      await get().refreshTree()
      get().toast(`Created project: ${projectName}`)
    } catch (e) {
      set({ treeLoading: false })
      get().toast((e as Error).message)
    }
  },

  openFile: async (path) => {
    const existing = get().tabs.find((t) => t.path === path)
    if (existing) {
      set({ activeTabId: existing.id })
      return
    }
    try {
      const r = await fetch(`/api/file?path=${encodeURIComponent(path)}`)
      if (!r.ok) throw new Error('fetch failed')
      const data = await r.json()
      const tab: EditorTab = {
        id: nanoid(),
        path,
        name: path.split('/').pop() ?? path,
        content: data.content ?? '',
        savedContent: data.content ?? '',
        language: langFromPath(path),
      }
      // Dedupe inside the updater: a concurrent openFile() for the same path
      // (e.g. double-click, or two awaited calls) would both pass the
      // pre-fetch `existing` check and otherwise create duplicate tabs.
      set((s) => {
        const dup = s.tabs.find((t) => t.path === path)
        if (dup) return { activeTabId: dup.id }
        return { tabs: [...s.tabs, tab], activeTabId: tab.id }
      })
    } catch {
      get().toast(`Could not open ${path}`)
    }
  },

  closeTab: (id) => {
    const { tabs, activeTabId } = get()
    const idx = tabs.findIndex((t) => t.id === id)
    const next = tabs.filter((t) => t.id !== id)
    let newActive = activeTabId
    if (activeTabId === id) {
      newActive = next[Math.min(idx, next.length - 1)]?.id ?? null
    }
    set({ tabs: next, activeTabId: newActive })
  },

  setActiveTab: (id) => set({ activeTabId: id }),

  updateTabContent: (id, content) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === id ? { ...t, content } : t)),
    })),

  saveTab: async (id) => {
    const tab = get().tabs.find((t) => t.id === id)
    if (!tab) return
    try {
      await fetch('/api/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: tab.path, content: tab.content }),
      })
      set((s) => ({
        tabs: s.tabs.map((t) =>
          t.id === id ? { ...t, savedContent: t.content } : t,
        ),
      }))
    } catch {
      get().toast('Save failed')
    }
  },

  saveActiveTab: async () => {
    const id = get().activeTabId
    if (id) await get().saveTab(id)
  },

  createFile: async (path, type) => {
    try {
      await fetch('/api/file/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path, type }),
      })
      await get().refreshTree()
      if (type === 'file') await get().openFile(path)
    } catch {
      get().toast('Create failed')
    }
  },

  deleteNode: async (path) => {
    try {
      await fetch(`/api/file?path=${encodeURIComponent(path)}`, {
        method: 'DELETE',
      })
      // close tabs under this path (exact match or nested under the dir).
      // A path boundary is required so deleting `src/util` does NOT close
      // unrelated siblings like `src/utils.ts` / `src/util-tests.ts` — a bare
      // `startsWith(path)` would match those and silently discard unsaved edits.
      const prefix = path.endsWith('/') ? path : path + '/'
      set((s) => ({
        tabs: s.tabs.filter((t) => t.path !== path && !t.path.startsWith(prefix)),
      }))
      await get().refreshTree()
      get().toast(`Deleted ${path}`)
    } catch {
      get().toast('Delete failed')
    }
  },

  applyCodeToFile: async (path, content) => {
    const cleanPath = path.trim()
    if (!cleanPath && !codeHasPatchBlocks(content)) {
      get().toast('No file path')
      return
    }
    try {
      // SEARCH/REPLACE patch path: detect Aider-style blocks in the code and
      // apply each surgically. Path comes from each block, so `cleanPath` is
      // ignored when blocks are present.
      const blocks = parsePatchBlocks(content)
      if (blocks.length > 0) {
        let applied = 0
        const failures: string[] = []
        for (const b of blocks) {
          try {
            const existingRes = await fetch(`/api/file?path=${encodeURIComponent(b.path)}`)
            if (!existingRes.ok) {
              failures.push(`${b.path}: file not found`)
              continue
            }
            const { content: existing } = (await existingRes.json()) as { content: string }
            // Count exact matches of the SEARCH text.
            let count = 0, from = 0, idx: number
            while ((idx = existing.indexOf(b.find, from)) !== -1) {
              count++; from = idx + b.find.length
              if (count > 1) break
            }
            if (count === 0) {
              failures.push(`${b.path}: SEARCH block not found in file`)
              continue
            }
            if (count > 1) {
              failures.push(`${b.path}: SEARCH block matches ${count}+ places — add more context to make it unique`)
              continue
            }
            const updated = existing.replace(b.find, () => b.replace)
            await fetch('/api/file', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ path: b.path, content: updated }),
            })
            applied++
            // Update open-tab content if applicable
            const tab = get().tabs.find((t) => t.path === b.path)
            if (tab) {
              set((s) => ({
                tabs: s.tabs.map((t) =>
                  t.id === tab.id ? { ...t, content: updated, savedContent: updated } : t,
                ),
              }))
            }
          } catch (e) {
            failures.push(`${b.path}: ${(e as Error).message}`)
          }
        }
        await get().refreshTree()
        if (failures.length === 0) {
          get().toast(`Applied ${applied} patch${applied === 1 ? '' : 'es'}`)
        } else {
          get().toast(`Applied ${applied}/${blocks.length}; failed: ${failures.join('; ')}`)
        }
        return
      }

      // Full-file path (legacy): guard against snippet-clobber.
      try {
        const existingRes = await fetch(`/api/file?path=${encodeURIComponent(cleanPath)}`)
        if (existingRes.ok) {
          const { content: existing } = (await existingRes.json()) as { content: string }
          if (existing && existing.length > 200) {
            const ratio = content.length / existing.length
            if (ratio < 0.25) {
              const proceed = typeof window !== 'undefined' && window.confirm(
                `Apply would replace ${cleanPath} (${existing.length} chars) with much smaller ` +
                `content (${content.length} chars, ratio ${ratio.toFixed(2)}).\n\n` +
                `The AI likely emitted a snippet, not the full file. Overwrite anyway?`,
              )
              if (!proceed) {
                get().toast(`Apply cancelled: snippet would clobber ${cleanPath}`)
                return
              }
            }
          }
        }
      } catch { /* file probably doesn't exist yet — fall through to write */ }

      // Write to disk (creates or overwrites)
      await fetch('/api/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: cleanPath, content }),
      })
      await get().refreshTree()
      // If the file is open in a tab, update its content + mark saved
      const existingTab = get().tabs.find((t) => t.path === cleanPath)
      if (existingTab) {
        set((s) => ({
          tabs: s.tabs.map((t) =>
            t.id === existingTab.id
              ? { ...t, content, savedContent: content }
              : t,
          ),
          activeTabId: existingTab.id,
        }))
      } else {
        // Open it in a new tab so the user sees the result
        await get().openFile(cleanPath)
      }
      get().toast(`Applied → ${cleanPath}`)
    } catch (e) {
      get().toast(`Apply failed: ${(e as Error).message}`)
    }
  },

  toggleDir: (path) =>
    set((s) => ({
      expandedDirs: { ...s.expandedDirs, [path]: !s.expandedDirs[path] },
    })),

  setSettings: (partial) => {
    const next = { ...get().settings, ...partial }
    set({ settings: next })
    saveSettings(next)
  },

  sendMessage: async (text) => {
    const trimmed = text.trim()
    if (!trimmed || get().chatBusy) return

    const userMsg: ChatMsg = { id: nanoid(), role: 'user', content: trimmed }
    const assistantId = nanoid()
    const assistantMsg: ChatMsg = {
      id: assistantId,
      role: 'assistant',
      content: '',
      streaming: true,
    }

    const history = get().messages
      .filter((m) => m.content.length > 0)
      .map((m) => ({ role: m.role, content: m.content }))

    // active file context
    const activeTab = get().tabs.find((t) => t.id === get().activeTabId)
    const activeFile = activeTab
      ? { path: activeTab.path, content: activeTab.content }
      : null

    // @-mentioned attached files
    const attached = get().attachedContext.map((f) => ({
      path: f.path,
      content: f.content,
    }))

    set((s) => ({
      messages: [...s.messages, userMsg, assistantMsg],
      chatBusy: true,
    }))

    const myCtrl = new AbortController()
    abortCtrl = myCtrl
    const cfg = providerConfig(get().settings)

    try {
      const r = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [...history, { role: 'user', content: trimmed }],
          provider: cfg,
          activeFile,
          attachedFiles: attached,
        }),
        signal: myCtrl.signal,
      })
      if (!r.ok || !r.body) throw new Error(`HTTP ${r.status}`)

      const reader = r.body.getReader()
      const decoder = new TextDecoder()
      let acc = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        acc += decoder.decode(value, { stream: true })
        set((s) => ({
          messages: s.messages.map((m) =>
            m.id === assistantId ? { ...m, content: acc } : m,
          ),
        }))
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') {
        // keep partial
      } else {
        set((s) => ({
          messages: s.messages.map((m) =>
            m.id === assistantId
              ? { ...m, content: `⚠️ ${(e as Error).message}` }
              : m,
          ),
        }))
      }
    } finally {
      set((s) => ({
        chatBusy: false,
        messages: s.messages.map((m) =>
          m.id === assistantId ? { ...m, streaming: false } : m,
        ),
        attachedContext: [],
      }))
      // Only clear the module reference if it still points to *this* controller.
      // A newer sendMessage() may have already replaced it; clobbering it would make that request unstoppable.
      if (abortCtrl === myCtrl) abortCtrl = null
    }
  },

  stopGeneration: () => {
    abortCtrl?.abort()
  },

  clearChat: () => set({ messages: [] }),

  inlineEditBusy: false,

  runInlineEdit: async (code, instruction, language, filePath) => {
    if (!instruction.trim() || get().inlineEditBusy) return null
    set({ inlineEditBusy: true })
    try {
      const cfg = providerConfig(get().settings)
      const r = await fetch('/api/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          instruction,
          language,
          path: filePath,
          provider: cfg,
        }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return (await r.json()) as { code: string; note?: string }
    } catch (e) {
      get().toast(`Edit failed: ${(e as Error).message}`)
      return null
    } finally {
      set({ inlineEditBusy: false })
    }
  },

  // voice coding
  voiceOpen: false,
  setVoiceOpen: (v) => set({ voiceOpen: v }),

  composerOpen: false,
  setComposerOpen: (v) => set({ composerOpen: v }),

  // NL shell terminal
  terminalOpen: false,
  setTerminalOpen: (v) => set({ terminalOpen: v }),

  translateNlsh: async (prompt) => {
    try {
      const cfg = providerConfig(get().settings)
      const r = await fetch('/api/nlsh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, provider: cfg }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = await r.json()
      return data.command ?? ''
    } catch (e) {
      get().toast(`Translate failed: ${(e as Error).message}`)
      return ''
    }
  },

  execCommand: async (command) => {
    try {
      const r = await fetch('/api/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return (await r.json()) as { stdout: string; stderr: string; code: number }
    } catch (e) {
      return { stdout: '', stderr: (e as Error).message, code: 1 }
    }
  },

  // test generation
  genTestsBusy: false,

  generateTests: async () => {
    const tab = get().tabs.find((t) => t.id === get().activeTabId)
    if (!tab) {
      get().toast('Open a file first')
      return
    }
    set({ genTestsBusy: true })
    try {
      const cfg = providerConfig(get().settings)
      const r = await fetch('/api/gen-tests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: tab.content,
          path: tab.path,
          language: tab.language,
          provider: cfg,
        }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = await r.json()
      const tests: string | undefined = data.tests
      if (!tests || !tests.trim()) {
        throw new Error(data.error || data.note || 'AI returned no tests')
      }
      const testPath = guessTestPath(tab.path)
      // Write the test file in one shot (creates dirs + file), then refresh + open
      const writeRes = await fetch('/api/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: testPath, content: tests }),
      })
      if (!writeRes.ok) throw new Error(`Failed to write test file: HTTP ${writeRes.status}`)
      await get().refreshTree()
      await get().openFile(testPath)
      get().toast(`Generated tests → ${testPath}`)
    } catch (e) {
      get().toast(`Test gen failed: ${(e as Error).message}`)
    } finally {
      set({ genTestsBusy: false })
    }
  },

  // ---------- AI auto-fix for diagnostics ----------
  fixPreview: null,
  fixBusy: false,

  fixDiagnostic: async (diagnostic) => {
    set({ fixBusy: true })
    try {
      // Read the file content
      const fr = await fetch(`/api/file?path=${encodeURIComponent(diagnostic.filePath)}`)
      if (!fr.ok) throw new Error('Could not read file')
      const fdata = await fr.json()
      const content = fdata.content ?? ''

      const cfg = providerConfig(get().settings)
      const r = await fetch('/api/diagnostics/fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ diagnostic, content, provider: cfg }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = await r.json()
      const fixedContent = data.fixedContent ?? content
      const changed = typeof data.changed === 'boolean' ? data.changed : fixedContent !== content

      set({
        fixPreview: {
          filePath: diagnostic.filePath,
          originalContent: content,
          fixedContent,
          explanation:
            !changed
              ? data.explanation ?? 'No automatic fix is available for this diagnostic.'
              : data.explanation ?? 'Fix applied.',
          changed,
          kind: data.kind,
          noChanges: !changed,
        },
      })
    } catch (e) {
      get().toast(`Fix failed: ${(e as Error).message}`)
    } finally {
      set({ fixBusy: false })
    }
  },

  applyFix: async () => {
    const preview = get().fixPreview
    if (!preview) return
    try {
      await fetch('/api/file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: preview.filePath, content: preview.fixedContent }),
      })
      // Update the tab if open
      const tab = get().tabs.find((t) => t.path === preview.filePath)
      if (tab) {
        set((s) => ({
          tabs: s.tabs.map((t) =>
            t.id === tab.id
              ? { ...t, content: preview.fixedContent, savedContent: preview.fixedContent }
              : t,
          ),
          activeTabId: tab.id,
        }))
      } else {
        await get().openFile(preview.filePath)
      }
      get().toast(`Fix applied → ${preview.filePath}`)
      set({ fixPreview: null })
      window.dispatchEvent(new CustomEvent('newton:diagnostics-refresh'))
    } catch (e) {
      get().toast(`Apply fix failed: ${(e as Error).message}`)
    }
  },

  dismissFix: () => set({ fixPreview: null }),

  setSettingsOpen: (v) => set({ settingsOpen: v }),
  setPaletteOpen: (v) => set({ paletteOpen: v }),
  setSidebarVisible: (v) => set({ sidebarVisible: v }),
  setChatVisible: (v) => set({ chatVisible: v }),
  setActiveView: (v) => set({ activeView: v }),

  toast: (text) => {
    const id = nanoid()
    set((s) => ({ toasts: [...s.toasts, { id, text }] }))
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
    }, TOAST_DURATION_MS)
  },

  // ---------- codebase search / @-mentions ----------
  searchCode: async (query) => {
    const q = query.trim()
    set({ searchQuery: q, searchBusy: true })
    if (!q) {
      set({ searchResults: [], searchBusy: false })
      return
    }
    try {
      const r = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=20`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = await r.json()
      set({ searchResults: data.hits ?? [], searchBusy: false })
    } catch {
      set({ searchResults: [], searchBusy: false })
    }
  },

  setSearchQuery: (q) => set({ searchQuery: q }),

  clearSearch: () => set({ searchResults: [], searchQuery: '', searchBusy: false }),

  attachFile: async (path) => {
    // Don't attach twice
    if (get().attachedContext.some((f) => f.path === path)) return
    try {
      const r = await fetch(`/api/file?path=${encodeURIComponent(path)}`)
      if (!r.ok) throw new Error('fetch failed')
      const data = await r.json()
      set((s) => ({
        attachedContext: [
          ...s.attachedContext,
          { path, content: data.content ?? '' },
        ],
      }))
    } catch {
      get().toast(`Could not read ${path}`)
    }
  },

  detachFile: (path) =>
    set((s) => ({
      attachedContext: s.attachedContext.filter((f) => f.path !== path),
    })),

  clearAttached: () => set({ attachedContext: [] }),

  refreshIndexStats: async () => {
    try {
      const r = await fetch('/api/index/stats')
      if (!r.ok) return
      const data = await r.json()
      set({
        indexStats: {
          totalFiles: data.totalFiles,
          totalChunks: data.totalChunks,
          indexing: data.indexing,
        },
      })
    } catch {
      /* ignore */
    }
  },

  rebuildIndex: async () => {
    set({ indexStats: { totalFiles: 0, totalChunks: 0, indexing: true } })
    try {
      const r = await fetch('/api/index/rebuild', { method: 'POST' })
      if (!r.ok) return
      const data = await r.json()
      set({
        indexStats: {
          totalFiles: data.totalFiles,
          totalChunks: data.totalChunks,
          indexing: false,
        },
      })
      get().toast(`Index rebuilt: ${data.totalFiles} files, ${data.totalChunks} chunks`)
    } catch {
      get().toast('Index rebuild failed')
    }
  },

  // ---------- git / source control ----------
  refreshGit: async () => {
    set({ gitBusy: true })
    try {
      const r = await fetch('/api/git/status')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = (await r.json()) as GitStatusData
      set({ gitStatus: data })
    } finally {
      set({ gitBusy: false })
    }
  },

  stageFiles: async (paths) => {
    if (!paths.length) return
    set({ gitBusy: true })
    try {
      await fetch('/api/git/stage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths }),
      })
      await get().refreshGit()
    } catch {
      get().toast('Stage failed')
    } finally {
      set({ gitBusy: false })
    }
  },

  unstageFiles: async (paths) => {
    if (!paths.length) return
    set({ gitBusy: true })
    try {
      await fetch('/api/git/unstage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ paths }),
      })
      await get().refreshGit()
    } catch {
      get().toast('Unstage failed')
    } finally {
      set({ gitBusy: false })
    }
  },

  stageAll: async () => {
    const all = (get().gitStatus?.changes ?? []).map((c) => c.path)
    if (all.length === 0) return
    await get().stageFiles(all)
  },

  gitCommit: async (message) => {
    if (!message.trim()) {
      get().toast('Commit message required')
      return false
    }
    set({ gitBusy: true })
    try {
      const r = await fetch('/api/git/commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      })
      if (!r.ok) {
        const e = await r.json().catch(() => ({}))
        throw new Error(e.error ?? `HTTP ${r.status}`)
      }
      await get().refreshGit()
      get().toast('Committed ✓')
      return true
    } catch (e) {
      get().toast(`Commit failed: ${(e as Error).message}`)
      return false
    } finally {
      set({ gitBusy: false })
    }
  },

  gitInit: async () => {
    set({ gitBusy: true })
    try {
      await fetch('/api/git/init', { method: 'POST' })
      await get().refreshGit()
      get().toast('Git repository initialized')
    } catch {
      get().toast('Git init failed')
    } finally {
      set({ gitBusy: false })
    }
  },

  viewDiff: async (path, staged) => {
    set({ diffBusy: true })
    try {
      const r = await fetch(
        `/api/git/diff?path=${encodeURIComponent(path)}&staged=${staged}`,
      )
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = await r.json()
      set({ diffText: data.diff || '(no changes)', diffBusy: false })
      // Fetch side-by-side content for the Monaco DiffEditor (best-effort)
      try {
        const cr = await fetch(
          `/api/git/diff-content?path=${encodeURIComponent(path)}&staged=${staged}`,
        )
        if (cr.ok) {
          const cdata = await cr.json()
          set({
            diffContent: {
              original: cdata.original ?? '',
              modified: cdata.modified ?? '',
              language: cdata.language ?? 'plaintext',
              path: cdata.path ?? path,
            },
          })
        }
      } catch {
        /* unified diff still available via diffText */
      }
    } catch {
      set({ diffText: '(could not load diff)', diffBusy: false })
    }
  },

  clearDiff: () => set({ diffText: null, diffContent: null }),

  // ---------- AI SCM ----------
  aiSuggestCommit: async () => {
    set({ gitBusy: true })
    try {
      // Fetch the staged diff to analyze
      const r = await fetch('/api/git/status')
      if (!r.ok) throw new Error('git status failed')
      const status = (await r.json()) as GitStatusData
      const staged = status.changes.filter((c) => c.staged)
      let diff = ''
      if (staged.length > 0) {
        const dr = await fetch('/api/git/diff?staged=true')
        const dd = await dr.json()
        diff = dd.diff ?? ''
      }
      if (!diff.trim()) {
        get().toast('Stage some changes first')
        return null
      }
      const cfg = providerConfig(get().settings)
      const sr = await fetch('/api/git/suggest-commit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ diff, provider: cfg }),
      })
      if (!sr.ok) throw new Error(`HTTP ${sr.status}`)
      const data = await sr.json()
      return data.message ?? 'chore: update files'
    } catch (e) {
      get().toast(`Commit suggestion failed: ${(e as Error).message}`)
      return null
    } finally {
      set({ gitBusy: false })
    }
  },

  aiExplainDiff: async (diff, filePath) => {
    set({ aiInsightBusy: true, aiInsight: null })
    try {
      const cfg = providerConfig(get().settings)
      const r = await fetch('/api/git/explain-diff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ diff, path: filePath, provider: cfg }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = await r.json()
      set({ aiInsight: { kind: 'explain', text: data.explanation ?? '(no explanation)' } })
    } catch (e) {
      set({ aiInsight: { kind: 'explain', text: `⚠️ ${(e as Error).message}` } })
    } finally {
      set({ aiInsightBusy: false })
    }
  },

  aiReviewDiff: async (diff, files) => {
    set({ aiInsightBusy: true, aiInsight: null })
    try {
      const cfg = providerConfig(get().settings)
      const r = await fetch('/api/git/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ diff, files, provider: cfg }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = await r.json()
      const findings = (data.findings ?? []) as Array<{
        severity: string
        category: string
        message: string
      }>
      const parts: string[] = []
      parts.push(`**Code Review** — Score: ${data.score ?? 'N/A'}/100`)
      parts.push('')
      parts.push(data.summary ?? '')
      parts.push('')
      const sevOrder = ['critical', 'warning', 'info', 'praise']
      const sevEmoji: Record<string, string> = {
        critical: '🔴',
        warning: '🟡',
        info: '🔵',
        praise: '🟢',
      }
      findings
        .sort((a, b) => sevOrder.indexOf(a.severity) - sevOrder.indexOf(b.severity))
        .forEach((f) => {
          parts.push(
            `${sevEmoji[f.severity] ?? '•'} **${f.severity.toUpperCase()}** (${f.category}): ${f.message}`,
          )
        })
      set({ aiInsight: { kind: 'review', text: parts.join('\n') } })
    } catch (e) {
      set({ aiInsight: { kind: 'review', text: `⚠️ ${(e as Error).message}` } })
    } finally {
      set({ aiInsightBusy: false })
    }
  },

  clearAiInsight: () => set({ aiInsight: null }),

  // ---------- repository graph ----------
  loadGraph: async (force) => {
    set({ graphLoading: true })
    try {
      const r = await fetch(`/api/graph${force ? '?force=true' : ''}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = (await r.json()) as RepoGraphData
      set({ graphData: data, graphLoading: false })
    } catch (e) {
      set({ graphLoading: false })
      get().toast(`Graph failed: ${(e as Error).message}`)
    }
  },

  loadImpact: async (file) => {
    set({ impactLoading: true })
    try {
      const r = await fetch(`/api/graph/impact?file=${encodeURIComponent(file)}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const data = await r.json()
      set({ impactData: data, impactLoading: false })
    } catch (e) {
      set({ impactLoading: false })
      get().toast(`Impact analysis failed: ${(e as Error).message}`)
    }
  },

  clearImpact: () => set({ impactData: null }),

  // ---------- workspace memory ----------
  memory: null,
  memoryBusy: false,
  welcomeDigest: null,

  loadMemory: async () => {
    set({ memoryBusy: true })
    try {
      const r = await fetch('/api/memory')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const mem = await r.json()
      // also fetch welcome digest
      let digest: string | null = null
      try {
        const wr = await fetch('/api/memory/welcome')
        const wd = await wr.json()
        digest = wd.digest ?? null
      } catch {
        /* optional */
      }
      set({ memory: mem, welcomeDigest: digest, memoryBusy: false })
    } catch {
      set({ memoryBusy: false })
    }
  },

  refreshMemory: async () => {
    set({ memoryBusy: true })
    try {
      const r = await fetch('/api/memory/refresh', { method: 'POST' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const mem = await r.json()
      let digest: string | null = null
      try {
        const wr = await fetch('/api/memory/welcome')
        const wd = await wr.json()
        digest = wd.digest ?? null
      } catch {
        /* optional */
      }
      set({ memory: mem, welcomeDigest: digest, memoryBusy: false })
      get().toast(`Memory refreshed — ${mem.techStack?.length ?? 0} technologies detected`)
    } catch (e) {
      set({ memoryBusy: false })
      get().toast(`Memory refresh failed: ${(e as Error).message}`)
    }
  },

  addMemoryEntry: async (type, text) => {
    if (!text.trim()) return
    try {
      const r = await fetch('/api/memory/entry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, text, source: 'manual' }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const mem = await r.json()
      set({ memory: mem })
    } catch (e) {
      get().toast(`Add entry failed: ${(e as Error).message}`)
    }
  },

  removeMemoryEntry: async (id) => {
    try {
      const r = await fetch(`/api/memory/entry/${id}`, { method: 'DELETE' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const mem = await r.json()
      set({ memory: mem })
    } catch (e) {
      get().toast(`Remove entry failed: ${(e as Error).message}`)
    }
  },

  // ---------- mission control ----------
  missions: [],
  activeMission: null,
  missionBusy: false,

  loadMissions: async () => {
    try {
      const r = await fetch('/api/missions')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const list = (await r.json()) as Mission[]
      set({ missions: list })
    } catch {
      /* ignore */
    }
  },

  startMission: async (goal, contextFiles = []) => {
    const trimmed = goal.trim()
    if (!trimmed) return null
    set({ missionBusy: true })
    try {
      const cfg = providerConfig(get().settings)
      const r = await fetch('/api/missions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal: trimmed, contextFiles, provider: cfg }),
      })
      if (!r.ok) {
        // Try to surface the server's actual error reason instead of a bare HTTP code.
        const reason = await r.json().then((j: any) => j?.error).catch(() => null)
        throw new Error(reason ? `HTTP ${r.status}: ${reason}` : `HTTP ${r.status}`)
      }
      const mission = (await r.json()) as Mission
      set((s) => ({
        missions: [mission, ...s.missions.filter((m) => m.id !== mission.id)],
        activeMission: mission,
        missionBusy: false,
      }))
      get().toast(`Mission started: ${mission.steps.length} steps planned`)
      return mission
    } catch (e) {
      set({ missionBusy: false })
      get().toast(`Mission start failed: ${(e as Error).message}`)
      return null
    }
  },

  executeMission: async (id) => {
    set({ missionBusy: true })
    get().toast('Executing mission...')
    try {
      const cfg = providerConfig(get().settings)
      const r = await fetch(`/api/missions/${id}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: cfg }),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)

      // Read SSE stream for progress updates
      const reader = r.body?.getReader()
      if (!reader) throw new Error('No response body')

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6))
              if (data.type === 'step') {
                if (data.status === 'error' && data.note) {
                  get().toast(`Step ${data.index + 1} error: ${String(data.note).slice(0, 200)}`)
                } else {
                  get().toast(`Step ${data.index + 1}: ${data.status}`)
                }
              } else if (data.type === 'agent_step' && data.status === 'done') {
                get().toast(`${data.action} ${data.path}`)
              } else if (data.type === 'agent_step' && data.status === 'error' && data.note) {
                get().toast(`${data.action ?? 'action'} ${data.path ?? ''} failed: ${String(data.note).slice(0, 200)}`)
              } else if (data.type === 'complete' && data.mission) {
                set((s) => ({
                  missions: s.missions.map((m) => (m.id === id ? data.mission : m)),
                  activeMission: s.activeMission?.id === id ? data.mission : s.activeMission,
                }))
              }
            } catch {
              /* ignore parse errors */
            }
          }
        }
      }

      // Refresh the mission state
      await get().refreshMission(id)
      set({ missionBusy: false })
      get().toast('Mission execution complete')
    } catch (e) {
      set({ missionBusy: false })
      get().toast(`Execute failed: ${(e as Error).message}`)
    }
  },

  refreshMission: async (id) => {
    try {
      const r = await fetch(`/api/missions/${id}`)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const mission = (await r.json()) as Mission
      set((s) => ({
        missions: s.missions.map((m) => (m.id === id ? mission : m)),
        activeMission: s.activeMission?.id === id ? mission : s.activeMission,
      }))
    } catch {
      /* ignore */
    }
  },

  patchMission: async (id, patch) => {
    set({ missionBusy: true })
    try {
      const r = await fetch(`/api/missions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const mission = (await r.json()) as Mission
      set((s) => ({
        missions: s.missions.map((m) => (m.id === id ? mission : m)),
        activeMission: s.activeMission?.id === id ? mission : s.activeMission,
        missionBusy: false,
      }))
    } catch (e) {
      set({ missionBusy: false })
      get().toast(`Mission update failed: ${(e as Error).message}`)
    }
  },

  removeMission: async (id) => {
    try {
      const r = await fetch(`/api/missions/${id}`, { method: 'DELETE' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      set((s) => ({
        missions: s.missions.filter((m) => m.id !== id),
        activeMission: s.activeMission?.id === id ? null : s.activeMission,
      }))
      get().toast('Mission deleted')
    } catch (e) {
      get().toast(`Delete failed: ${(e as Error).message}`)
    }
  },

  verifyMission: async (id) => {
    set({ missionBusy: true })
    try {
      const r = await fetch(`/api/missions/${id}/verify`, { method: 'POST' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const mission = (await r.json()) as Mission
      set((s) => ({
        missions: s.missions.map((m) => (m.id === id ? mission : m)),
        activeMission: s.activeMission?.id === id ? mission : s.activeMission,
        missionBusy: false,
      }))
      const passed = mission.outcomes.every((o) => o.passed)
      get().toast(passed ? 'Mission verified ✓ — all outcomes passed' : 'Verification complete — some outcomes failed')
    } catch (e) {
      set({ missionBusy: false })
      get().toast(`Verify failed: ${(e as Error).message}`)
    }
  },

  setActiveMission: (m) => set({ activeMission: m }),
}))

// ---------- settings persistence ----------
function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem('newton-settings')
    if (raw) return migrateSettings(JSON.parse(raw))
  } catch {
    /* ignore */
  }
  return DEFAULT_SETTINGS
}
function saveSettings(s: Settings) {
  try {
    localStorage.setItem('newton-settings', JSON.stringify(s))
  } catch {
    /* ignore */
  }
}
