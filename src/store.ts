import { create } from 'zustand'
import { nanoid } from 'nanoid'
import {
  DEFAULT_SETTINGS,
  type FileNode,
  type Settings,
  type ChatMessage,
  type Provider,
} from '../shared/types'

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
  activeView: 'explorer' | 'search' | 'settings'
  settings: Settings
  toasts: Toast[]

  // actions
  refreshTree: () => Promise<void>
  openFile: (path: string) => Promise<void>
  closeTab: (id: string) => void
  setActiveTab: (id: string) => void
  updateTabContent: (id: string, content: string) => void
  saveTab: (id: string) => Promise<void>
  saveActiveTab: () => Promise<void>
  createFile: (path: string, type: 'file' | 'directory') => Promise<void>
  deleteNode: (path: string) => Promise<void>
  toggleDir: (path: string) => void

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

  // NL shell terminal
  terminalOpen: boolean
  setTerminalOpen: (v: boolean) => void
  translateNlsh: (prompt: string) => Promise<string>
  execCommand: (command: string) => Promise<{ stdout: string; stderr: string; code: number }>

  // test generation
  genTestsBusy: boolean
  generateTests: () => Promise<void>

  setSettingsOpen: (v: boolean) => void
  setPaletteOpen: (v: boolean) => void
  setSidebarVisible: (v: boolean) => void
  setChatVisible: (v: boolean) => void
  setActiveView: (v: 'explorer' | 'search' | 'settings') => void
  toast: (text: string) => void
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

function providerConfig(s: Settings) {
  switch (s.provider) {
    case 'openai':
      return {
        provider: 'openai' as Provider,
        model: s.openaiModel,
        apiKey: s.openaiApiKey,
        baseUrl: s.openaiBaseUrl,
      }
    case 'anthropic':
      return {
        provider: 'anthropic' as Provider,
        model: s.anthropicModel,
        apiKey: s.anthropicApiKey,
      }
    case 'ollama':
      return {
        provider: 'ollama' as Provider,
        model: s.ollamaModel,
        baseUrl: s.ollamaBaseUrl,
      }
    default:
      return { provider: 'demo' as Provider, model: 'demo' }
  }
}

let abortCtrl: AbortController | null = null

// ---------- store ----------
export const useStore = create<NewtonState>((set, get) => ({
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

  refreshTree: async () => {
    set({ treeLoading: true })
    try {
      const r = await fetch('/api/files')
      const data = await r.json()
      // expand root by default
      const expanded = { ...get().expandedDirs }
      if (data.tree) expanded[data.tree.path] = true
      set({ tree: data.tree, treeLoading: false, expandedDirs: expanded })
    } catch {
      set({ treeLoading: false })
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
      set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }))
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
      // close tabs under this path
      set((s) => ({
        tabs: s.tabs.filter((t) => !t.path.startsWith(path)),
      }))
      await get().refreshTree()
      get().toast(`Deleted ${path}`)
    } catch {
      get().toast('Delete failed')
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

    set((s) => ({
      messages: [...s.messages, userMsg, assistantMsg],
      chatBusy: true,
    }))

    abortCtrl = new AbortController()
    const cfg = providerConfig(get().settings)

    try {
      const r = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [...history, { role: 'user', content: trimmed }],
          provider: cfg,
          activeFile,
        }),
        signal: abortCtrl.signal,
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
      }))
      abortCtrl = null
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
      if (data.tests) {
        const testPath = guessTestPath(tab.path)
        await get().createFile(testPath, 'file')
        await fetch('/api/file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: testPath, content: data.tests }),
        })
        await get().openFile(testPath)
        get().toast(`Generated tests → ${testPath}`)
      }
    } catch (e) {
      get().toast(`Test gen failed: ${(e as Error).message}`)
    } finally {
      set({ genTestsBusy: false })
    }
  },

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
    }, 2600)
  },
}))

// ---------- settings persistence ----------
function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem('newton-settings')
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
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