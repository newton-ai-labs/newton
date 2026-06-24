import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

export interface MemoryEntry {
  id: string
  type: 'decision' | 'task' | 'note' | 'pattern'
  text: string
  createdAt: string
  /** Optional source file this was learned from */
  source?: string
}

export interface TechStackItem {
  name: string
  version?: string
  category: 'language' | 'framework' | 'library' | 'tool' | 'runtime'
}

export interface WorkspaceMemory {
  version: number
  workspaceName: string
  createdAt: string
  lastVisited: string
  visitCount: number

  techStack: TechStackItem[]

  /** User/AI-curated decisions and conventions */
  entries: MemoryEntry[]

  /** TODOs / FIXMEs / HACKs scanned from source */
  openTasks: Array<{ file: string; line: number; tag: string; text: string }>

  /** Files most recently edited (heuristic) */
  recentFiles: Array<{ path: string; lastSeen: string }>

  /** Greeting facts for "welcome back" */
  digest: {
    totalFiles: number
    totalLines: number
    topLanguages: Array<{ lang: string; count: number; pct: number }>
    generatedAt: string
  } | null
}

const MEMORY_VERSION = 1
const MEMORY_DIR = '.newton'
const MEMORY_FILE = 'memory.json'

// ---------- file I/O ----------
function memoryPath(workspace: string): string {
  return path.join(workspace, MEMORY_DIR, MEMORY_FILE)
}

export async function loadMemory(workspace: string): Promise<WorkspaceMemory | null> {
  try {
    const raw = await fs.readFile(memoryPath(workspace), 'utf8')
    return JSON.parse(raw) as WorkspaceMemory
  } catch {
    return null
  }
}

async function saveMemory(workspace: string, mem: WorkspaceMemory): Promise<void> {
  const dir = path.join(workspace, MEMORY_DIR)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(memoryPath(workspace), JSON.stringify(mem, null, 2), 'utf8')
}

// ---------- tech-stack detection ----------
async function detectTechStack(workspace: string): Promise<TechStackItem[]> {
  const stack: TechStackItem[] = []

  const readJson = async (rel: string): Promise<any | null> => {
    try {
      const abs = path.join(workspace, rel)
      if (!existsSync(abs)) return null
      return JSON.parse(await fs.readFile(abs, 'utf8'))
    } catch {
      return null
    }
  }

  // package.json (Node/JS/TS)
  const pkg = await readJson('package.json')
  if (pkg) {
    const runtime = pkg.engines?.node ? `Node ${pkg.engines.node}` : 'Node.js'
    stack.push({ name: runtime, category: 'runtime' })
    if (pkg.devDependencies?.typescript || pkg.dependencies?.typescript) {
      stack.push({ name: 'TypeScript', category: 'language' })
    }
    const allDeps: Record<string, string> = {
      ...(pkg.dependencies ?? {}),
      ...(pkg.devDependencies ?? {}),
    }
    const frameworkMap: Record<string, [string, string]> = {
      react: ['React', 'framework'],
      'next': ['Next.js', 'framework'],
      vue: ['Vue', 'framework'],
      '@angular/core': ['Angular', 'framework'],
      svelte: ['Svelte', 'framework'],
      express: ['Express', 'framework'],
      fastify: ['Fastify', 'framework'],
      '@nestjs/core': ['NestJS', 'framework'],
      vite: ['Vite', 'tool'],
      webpack: ['Webpack', 'tool'],
      jest: ['Jest', 'tool'],
      vitest: ['Vitest', 'tool'],
      tailwindcss: ['Tailwind CSS', 'library'],
      zustand: ['Zustand', 'library'],
      prisma: ['Prisma', 'library'],
    }
    for (const [dep, info] of Object.entries(frameworkMap)) {
      if (allDeps[dep]) {
        stack.push({ name: info[0], version: allDeps[dep], category: info[1] as TechStackItem['category'] })
      }
    }
  }

  // Python
  if (existsSync(path.join(workspace, 'requirements.txt'))) {
    stack.push({ name: 'Python', category: 'language' })
    stack.push({ name: 'pip', category: 'tool' })
    try {
      const reqs = await fs.readFile(path.join(workspace, 'requirements.txt'), 'utf8')
      if (/fastapi/i.test(reqs)) stack.push({ name: 'FastAPI', category: 'framework' })
      if (/flask/i.test(reqs)) stack.push({ name: 'Flask', category: 'framework' })
      if (/django/i.test(reqs)) stack.push({ name: 'Django', category: 'framework' })
      if (/pytest/i.test(reqs)) stack.push({ name: 'pytest', category: 'tool' })
    } catch { /* ignore */ }
  }
  if (existsSync(path.join(workspace, 'pyproject.toml'))) {
    if (!stack.some((s) => s.name === 'Python')) stack.push({ name: 'Python', category: 'language' })
  }

  // Go
  if (existsSync(path.join(workspace, 'go.mod'))) {
    stack.push({ name: 'Go', category: 'language' })
    stack.push({ name: 'Go modules', category: 'tool' })
  }

  // Rust
  if (existsSync(path.join(workspace, 'Cargo.toml'))) {
    stack.push({ name: 'Rust', category: 'language' })
    stack.push({ name: 'Cargo', category: 'tool' })
  }

  // Ruby
  if (existsSync(path.join(workspace, 'Gemfile'))) {
    stack.push({ name: 'Ruby', category: 'language' })
    stack.push({ name: 'Bundler', category: 'tool' })
  }

  // Java
  if (existsSync(path.join(workspace, 'pom.xml'))) {
    stack.push({ name: 'Java', category: 'language' })
    stack.push({ name: 'Maven', category: 'tool' })
  }
  if (existsSync(path.join(workspace, 'build.gradle')) || existsSync(path.join(workspace, 'build.gradle.kts'))) {
    if (!stack.some((s) => s.name === 'Java')) stack.push({ name: 'Java/Kotlin', category: 'language' })
    stack.push({ name: 'Gradle', category: 'tool' })
  }

  // Docker
  if (existsSync(path.join(workspace, 'Dockerfile'))) {
    stack.push({ name: 'Docker', category: 'tool' })
  }

  // Git
  if (existsSync(path.join(workspace, '.git'))) {
    stack.push({ name: 'Git', category: 'tool' })
  }

  return dedupeStack(stack)
}

function dedupeStack(stack: TechStackItem[]): TechStackItem[] {
  const seen = new Set<string>()
  return stack.filter((s) => {
    const key = `${s.name}-${s.category}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// ---------- code scanning for TODOs ----------
const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.go', '.rs', '.rb', '.java', '.kt',
  '.swift', '.c', '.cpp', '.h', '.cs', '.php',
  '.vue', '.svelte', '.lua', '.dart',
])

const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.cache',
  '.newton', 'vendor', '__pycache__', '.venv', 'venv', 'target',
  'coverage', '.vscode', '.idea',
])

async function scanOpenTasks(workspace: string, maxFiles = 200): Promise<WorkspaceMemory['openTasks']> {
  const tasks: WorkspaceMemory['openTasks'] = []
  const todoRegex = /(?:\/\/|#|;|\/\*|<!--|--)\s*(TODO|FIXME|HACK|XXX|BUG)\b[:\s]*(.*)/i

  async function walk(dir: string, relBase: string, count: { n: number }) {
    if (count.n >= maxFiles) return
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (count.n >= maxFiles) return
      if (IGNORED_DIRS.has(entry.name)) continue
      const full = path.join(dir, entry.name)
      const rel = relBase ? `${relBase}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        await walk(full, rel, count)
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase()
        if (!CODE_EXTENSIONS.has(ext)) continue
        count.n++
        try {
          const content = await fs.readFile(full, 'utf8')
          const lines = content.split('\n')
          for (let i = 0; i < lines.length; i++) {
            const m = lines[i].match(todoRegex)
            if (m) {
              tasks.push({
                file: rel,
                line: i + 1,
                tag: m[1].toUpperCase(),
                text: m[2].trim().slice(0, 120),
              })
              if (tasks.length >= 50) return
            }
          }
        } catch { /* ignore */ }
      }
    }
  }

  await walk(workspace, '', { n: 0 })
  return tasks
}

// ---------- language stats ----------
async function computeDigest(workspace: string): Promise<WorkspaceMemory['digest']> {
  const langCounts: Record<string, number> = {}
  let totalFiles = 0
  let totalLines = 0

  async function walk(dir: string, count: { n: number }) {
    if (count.n >= 500) return
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (count.n >= 500) return
      if (IGNORED_DIRS.has(entry.name)) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full, count)
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase()
        const lang = EXT_TO_LANG[ext]
        if (!lang) continue
        count.n++
        totalFiles++
        try {
          const content = await fs.readFile(full, 'utf8')
          totalLines += content.split('\n').length
          langCounts[lang] = (langCounts[lang] ?? 0) + 1
        } catch { /* ignore */ }
      }
    }
  }

  await walk(workspace, { n: 0 })

  const topLanguages = Object.entries(langCounts)
    .map(([lang, count]) => ({
      lang,
      count,
      pct: Math.round((count / Math.max(totalFiles, 1)) * 100),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)

  return {
    totalFiles,
    totalLines,
    topLanguages,
    generatedAt: new Date().toISOString(),
  }
}

const EXT_TO_LANG: Record<string, string> = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript',
  '.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript',
  '.py': 'Python', '.go': 'Go', '.rs': 'Rust', '.rb': 'Ruby',
  '.java': 'Java', '.kt': 'Kotlin', '.swift': 'Swift',
  '.c': 'C', '.cpp': 'C++', '.h': 'C/C++',
  '.cs': 'C#', '.php': 'PHP', '.vue': 'Vue', '.svelte': 'Svelte',
  '.css': 'CSS', '.scss': 'SCSS', '.html': 'HTML',
  '.json': 'JSON', '.md': 'Markdown', '.sql': 'SQL',
}

// ---------- public API ----------
export async function getOrCreateMemory(workspace: string): Promise<WorkspaceMemory> {
  const existing = await loadMemory(workspace)
  if (existing) return existing
  return createInitialMemory(workspace)
}

export async function createInitialMemory(workspace: string): Promise<WorkspaceMemory> {
  const now = new Date().toISOString()
  const workspaceName = path.basename(workspace) || 'workspace'

  const [techStack, openTasks, digest] = await Promise.all([
    detectTechStack(workspace),
    scanOpenTasks(workspace),
    computeDigest(workspace),
  ])

  const mem: WorkspaceMemory = {
    version: MEMORY_VERSION,
    workspaceName,
    createdAt: now,
    lastVisited: now,
    visitCount: 1,
    techStack,
    entries: [],
    openTasks,
    recentFiles: [],
    digest,
  }

  await saveMemory(workspace, mem)
  return mem
}

export async function refreshMemory(workspace: string): Promise<WorkspaceMemory> {
  const existing = await loadMemory(workspace)
  const now = new Date().toISOString()

  // Re-scan tech stack, tasks, and digest (these change as code evolves)
  const [techStack, openTasks, digest] = await Promise.all([
    detectTechStack(workspace),
    scanOpenTasks(workspace),
    computeDigest(workspace),
  ])

  if (!existing) {
    const mem: WorkspaceMemory = {
      version: MEMORY_VERSION,
      workspaceName: path.basename(workspace) || 'workspace',
      createdAt: now,
      lastVisited: now,
      visitCount: 1,
      techStack,
      entries: [],
      openTasks,
      recentFiles: [],
      digest,
    }
    await saveMemory(workspace, mem)
    return mem
  }

  // Preserve user entries + recent files, refresh auto-detected data
  const updated: WorkspaceMemory = {
    ...existing,
    lastVisited: now,
    visitCount: existing.visitCount + 1,
    techStack,
    openTasks,
    digest,
  }
  await saveMemory(workspace, updated)
  return updated
}

export async function addEntry(
  workspace: string,
  type: MemoryEntry['type'],
  text: string,
  source?: string,
): Promise<WorkspaceMemory> {
  const mem = await getOrCreateMemory(workspace)
  const entry: MemoryEntry = {
    id: `entry_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type,
    text,
    createdAt: new Date().toISOString(),
    source,
  }
  mem.entries = [entry, ...mem.entries]
  await saveMemory(workspace, mem)
  return mem
}

export async function removeEntry(workspace: string, id: string): Promise<WorkspaceMemory> {
  const mem = await getOrCreateMemory(workspace)
  mem.entries = mem.entries.filter((e) => e.id !== id)
  await saveMemory(workspace, mem)
  return mem
}

export async function trackRecentFile(workspace: string, filePath: string): Promise<void> {
  const mem = await getOrCreateMemory(workspace)
  const now = new Date().toISOString()
  const filtered = mem.recentFiles.filter((f) => f.path !== filePath)
  mem.recentFiles = [{ path: filePath, lastSeen: now }, ...filtered].slice(0, 10)
  await saveMemory(workspace, mem)
}

/**
 * Generate a natural-language "welcome back" greeting using memory data.
 * In demo mode this is a template; with an LLM provider it would be richer.
 */
export function buildWelcomeDigest(mem: WorkspaceMemory): string {
  const parts: string[] = []
  const timeSince = mem.lastVisited
    ? timeAgo(mem.lastVisited)
    : 'first visit'

  parts.push(`👋 Welcome back to **${mem.workspaceName}**.`)
  parts.push(`Last visit: ${timeSince} · Visit #${mem.visitCount}.`)
  parts.push('')

  // Tech stack summary
  if (mem.techStack.length > 0) {
    const langs = mem.techStack.filter((s) => s.category === 'language' || s.category === 'framework')
    const tools = mem.techStack.filter((s) => s.category === 'tool')
    if (langs.length) parts.push(`📦 **Stack:** ${langs.map((s) => s.name).join(', ')}`)
    if (tools.length) parts.push(`🔧 **Tools:** ${tools.map((s) => s.name).join(', ')}`)
  }

  // Codebase size
  if (mem.digest) {
    parts.push(`📊 **Codebase:** ${mem.digest.totalFiles} files · ${mem.digest.totalLines.toLocaleString()} lines`)
    if (mem.digest.topLanguages.length > 0) {
      parts.push(`   Top: ${mem.digest.topLanguages.map((l) => `${l.lang} (${l.pct}%)`).join(', ')}`)
    }
  }

  // Open tasks
  const todos = mem.openTasks
  if (todos.length > 0) {
    const byTag: Record<string, number> = {}
    for (const t of todos) byTag[t.tag] = (byTag[t.tag] ?? 0) + 1
    const summary = Object.entries(byTag).map(([tag, n]) => `${n} ${tag}`).join(', ')
    parts.push(`⚠️ **Open tasks:** ${todos.length} markers found (${summary})`)
    if (todos[0]) parts.push(`   Next: \`${todos[0].file}:${todos[0].line}\` — ${todos[0].text || todos[0].tag}`)
  }

  // Recent files
  if (mem.recentFiles.length > 0) {
    parts.push(`🕐 **Recent:** ${mem.recentFiles.slice(0, 3).map((f) => `\`${f.path}\``).join(', ')}`)
  }

  // Stored decisions/notes
  const decisions = mem.entries.filter((e) => e.type === 'decision')
  if (decisions.length > 0) {
    parts.push(`💡 **Decisions:** ${decisions.length} recorded`)
  }

  return parts.join('\n')
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

/**
 * Build a compact context string of workspace memory for injection into chat prompts.
 * This gives the AI awareness of the project's stack, conventions, and open work.
 */
export function buildMemoryContext(mem: WorkspaceMemory): string {
  const parts: string[] = []
  parts.push(`Project: ${mem.workspaceName}`)

  if (mem.techStack.length > 0) {
    parts.push(`Tech stack: ${mem.techStack.map((s) => `${s.name}${s.version ? `@${s.version}` : ''}`).join(', ')}`)
  }

  const decisions = mem.entries.filter((e) => e.type === 'decision')
  if (decisions.length > 0) {
    parts.push(`Conventions & decisions:`)
    decisions.slice(0, 10).forEach((d) => parts.push(`  - ${d.text}`))
  }

  const patterns = mem.entries.filter((e) => e.type === 'pattern')
  if (patterns.length > 0) {
    parts.push(`Patterns:`)
    patterns.slice(0, 5).forEach((p) => parts.push(`  - ${p.text}`))
  }

  if (mem.digest?.topLanguages.length) {
    parts.push(`Primary languages: ${mem.digest.topLanguages.map((l) => l.lang).join(', ')}`)
  }

  return parts.join('\n')
}