import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import path from 'node:path'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import rateLimit from 'express-rate-limit'
import type { ChatRequest, EditRequest, EditResponse, FileNode, ProviderConfig, AgentRequest } from '../shared/types.js'
import { getProtocol, getProviderDef } from '../shared/types.js'
import { demoAnswer, streamDemo, demoEdit } from './demoAi.js'
import { demoPlan, executeStep, llmPlan } from './agent.js'
import { getIndex, resetIndex, type SearchHit } from './indexing.js'
import { getGraphBuilder } from './repoGraph.js'
import { getImpactIndex } from './impact.js'
import {
  getOrCreateMemory,
  refreshMemory,
  loadMemory,
  addEntry as memAddEntry,
  removeEntry as memRemoveEntry,
  trackRecentFile,
  buildWelcomeDigest,
  buildMemoryContext,
  type WorkspaceMemory,
  type MemoryEntry,
} from './memory.js'
import { assessPlan } from './consequence.js'
import {
  createMission,
  getMission,
  listMissions,
  updateMission,
  deleteMission,
  demoMissionPlan,
  llmMissionPlan,
  verifyOutcome,
} from './mission.js'
import { safeResolve, assertSafeDelete } from './safePath.js'

// ---------- constants ----------
const GIT_TIMEOUT_MS = 15000
const CONTEXT_SLICE_ACTIVE_FILE = 12000
const CONTEXT_SLICE_ATTACHED = 8000
const DIFF_SLICE_COMMIT_MSG = 8000
const DIFF_SLICE_EXPLAIN = 10000
const DIFF_SLICE_REVIEW = 12000

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const PORT = Number(process.env.NEWTON_PORT) || 8787

// Resolve workspace root: NEWTON_WORKSPACE -> cwd -> (if running from dist) parent
function resolveWorkspace(): string {
  if (process.env.NEWTON_WORKSPACE) return path.resolve(process.env.NEWTON_WORKSPACE)
  const cwd = process.cwd()
  return cwd
}

// Mutable workspace - can be changed at runtime via /api/workspace
let WORKSPACE = resolveWorkspace()

export function getWorkspace(): string {
  return WORKSPACE
}

const app = express()

// Restrict CORS to localhost origins (dev) and same-origin (prod). This
// prevents arbitrary websites from making requests to the local Newton server.
const localhostOriginCheck = (
  origin: string | undefined,
  callback: (err: Error | null, ok?: boolean) => void,
) => {
  // Allow same-origin requests (no Origin header) and non-browser tools (curl).
  if (!origin) return callback(null, true)
  try {
    const url = new URL(origin)
    const host = url.hostname
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') {
      return callback(null, true)
    }
    return callback(null, false)
  } catch {
    return callback(null, false)
  }
}

app.use(
  cors({
    origin: localhostOriginCheck,
    credentials: false,
  }),
)
app.use(express.json({ limit: '10mb' }))

// Rate limiter for sensitive endpoints (exec, chat, nlsh, file writes).
const sensitiveLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down.' },
})

// General limiter for all other routes.
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
})
app.use(generalLimiter)

// Completion limiter — higher limit since tab-completion fires frequently.
const completionLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
})

// ---------- safety helpers ----------
/** Resolve a workspace-relative path using the shared, hardened containment check. */
function safeJoin(rel: string): string {
  return safeResolve(WORKSPACE, rel)
}

const IGNORED = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.cache',
  '.DS_Store',
])

// ---------- file routes ----------
app.get('/api/files', async (_req, res) => {
  try {
    const tree = await buildTree(WORKSPACE, '')
    res.json({ root: WORKSPACE, tree })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

async function buildTree(absDir: string, relDir: string): Promise<FileNode> {
  const name = relDir === '' ? path.basename(WORKSPACE) || WORKSPACE : path.basename(relDir)
  const node: FileNode = { name, path: relDir || '.', type: 'directory', children: [] }
  const entries = await fs.readdir(absDir, { withFileTypes: true })
  // directories first, then files; both alphabetical, case-insensitive
  const sorted = entries
    .filter((e) => !IGNORED.has(e.name))
    .sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    })
  for (const e of sorted) {
    const childRel = relDir ? `${relDir}/${e.name}` : e.name
    if (e.isDirectory()) {
      node.children!.push(await buildTree(path.join(absDir, e.name), childRel))
    } else {
      node.children!.push({ name: e.name, path: childRel, type: 'file' })
    }
  }
  return node
}

// ---------- workspace management ----------
app.get('/api/workspace', (_req, res) => {
  res.json({ path: WORKSPACE })
})

app.post('/api/workspace', async (req, res) => {
  const { path: newPath } = req.body
  if (!newPath || typeof newPath !== 'string') {
    return res.status(400).json({ error: 'path is required' })
  }

  const resolved = path.resolve(newPath)

  // Verify the directory exists
  try {
    const stats = await fs.stat(resolved)
    if (!stats.isDirectory()) {
      return res.status(400).json({ error: 'Path is not a directory' })
    }
  } catch {
    return res.status(400).json({ error: 'Directory does not exist' })
  }

  WORKSPACE = resolved

  // Clear caches for the old workspace
  resetIndex()

  console.log(`  Workspace changed to: ${WORKSPACE}`)
  res.json({ path: WORKSPACE })
})

// ---------- file upload ----------
app.post('/api/upload', async (req, res) => {
  try {
    const { files } = req.body as { files: Array<{ path: string; content: string }> }

    if (!files || !Array.isArray(files)) {
      return res.status(400).json({ error: 'files array is required' })
    }

    const results: Array<{ path: string; success: boolean; error?: string }> = []

    for (const file of files) {
      try {
        const abs = safeJoin(file.path)
        // Ensure parent directory exists
        await fs.mkdir(path.dirname(abs), { recursive: true })
        await fs.writeFile(abs, file.content, 'utf8')
        results.push({ path: file.path, success: true })
      } catch (e) {
        results.push({ path: file.path, success: false, error: (e as Error).message })
      }
    }

    res.json({ results })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

// ---------- project templates ----------
const TEMPLATES: Record<string, { name: string; desc: string; files: Record<string, string> }> = {
  empty: {
    name: 'Empty Project',
    desc: 'A blank slate',
    files: {
      'README.md': '# My Project\n\nA new project created with Newton.\n',
    },
  },
  'react-ts': {
    name: 'React + TypeScript',
    desc: 'Vite-powered React with TypeScript',
    files: {
      'package.json': JSON.stringify({
        name: 'my-react-app',
        private: true,
        version: '0.0.0',
        type: 'module',
        scripts: {
          dev: 'vite',
          build: 'tsc && vite build',
          preview: 'vite preview',
        },
        dependencies: {
          react: '^18.2.0',
          'react-dom': '^18.2.0',
        },
        devDependencies: {
          '@types/react': '^18.2.0',
          '@types/react-dom': '^18.2.0',
          '@vitejs/plugin-react': '^4.0.0',
          typescript: '^5.0.0',
          vite: '^5.0.0',
        },
      }, null, 2),
      'tsconfig.json': JSON.stringify({
        compilerOptions: {
          target: 'ES2020',
          useDefineForClassFields: true,
          lib: ['ES2020', 'DOM', 'DOM.Iterable'],
          module: 'ESNext',
          skipLibCheck: true,
          moduleResolution: 'bundler',
          allowImportingTsExtensions: true,
          resolveJsonModule: true,
          isolatedModules: true,
          noEmit: true,
          jsx: 'react-jsx',
          strict: true,
        },
        include: ['src'],
      }, null, 2),
      'vite.config.ts': `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
})
`,
      'index.html': `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>React App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
      'src/main.tsx': `import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
`,
      'src/App.tsx': `function App() {
  return (
    <div>
      <h1>Hello, React!</h1>
      <p>Edit src/App.tsx to get started.</p>
    </div>
  )
}

export default App
`,
      'src/index.css': `* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: system-ui, sans-serif;
  padding: 2rem;
}
`,
    },
  },
  'node-ts': {
    name: 'Node.js + TypeScript',
    desc: 'Node.js with TypeScript and tsx',
    files: {
      'package.json': JSON.stringify({
        name: 'my-node-app',
        version: '1.0.0',
        type: 'module',
        scripts: {
          dev: 'tsx watch src/index.ts',
          build: 'tsc',
          start: 'node dist/index.js',
        },
        devDependencies: {
          '@types/node': '^20.0.0',
          tsx: '^4.0.0',
          typescript: '^5.0.0',
        },
      }, null, 2),
      'tsconfig.json': JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'bundler',
          outDir: 'dist',
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
        },
        include: ['src'],
      }, null, 2),
      'src/index.ts': `console.log('Hello from Node.js!')

// Your code here
`,
    },
  },
  'express-api': {
    name: 'Express API',
    desc: 'REST API with Express and TypeScript',
    files: {
      'package.json': JSON.stringify({
        name: 'my-api',
        version: '1.0.0',
        type: 'module',
        scripts: {
          dev: 'tsx watch src/index.ts',
          build: 'tsc',
          start: 'node dist/index.js',
        },
        dependencies: {
          express: '^4.18.0',
          cors: '^2.8.0',
        },
        devDependencies: {
          '@types/express': '^4.17.0',
          '@types/cors': '^2.8.0',
          '@types/node': '^20.0.0',
          tsx: '^4.0.0',
          typescript: '^5.0.0',
        },
      }, null, 2),
      'tsconfig.json': JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'bundler',
          outDir: 'dist',
          strict: true,
          esModuleInterop: true,
          skipLibCheck: true,
        },
        include: ['src'],
      }, null, 2),
      'src/index.ts': `import express from 'express'
import cors from 'cors'

const app = express()
app.use(cors())
app.use(express.json())

app.get('/api/hello', (req, res) => {
  res.json({ message: 'Hello, World!' })
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log(\`Server running on http://localhost:\${PORT}\`)
})
`,
    },
  },
  html: {
    name: 'HTML/CSS/JS',
    desc: 'Simple static website',
    files: {
      'index.html': `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>My Website</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <h1>Hello, World!</h1>
  <p>Edit index.html to get started.</p>
  <script src="script.js"></script>
</body>
</html>
`,
      'style.css': `* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: system-ui, sans-serif;
  padding: 2rem;
}

h1 {
  margin-bottom: 1rem;
}
`,
      'script.js': `// Your JavaScript code here
console.log('Hello from JavaScript!')
`,
    },
  },
}

app.get('/api/templates', (_req, res) => {
  const list = Object.entries(TEMPLATES).map(([id, t]) => ({
    id,
    name: t.name,
    desc: t.desc,
  }))
  res.json({ templates: list })
})

app.post('/api/templates/create', async (req, res) => {
  const { templateId, projectName } = req.body
  if (!templateId || !TEMPLATES[templateId]) {
    return res.status(400).json({ error: 'Invalid template' })
  }
  if (!projectName || typeof projectName !== 'string') {
    return res.status(400).json({ error: 'Project name required' })
  }
  // Reject any path-like project name. Project names are expected to be a
  // single safe directory segment, not a path. This blocks traversal
  // (`../evil`), absolute paths, and accidental nesting.
  if (/[\\/]/.test(projectName) || projectName.startsWith('.') || projectName.trim() !== projectName) {
    return res.status(400).json({ error: 'Project name must be a simple directory name (no slashes, leading dots, or surrounding whitespace)' })
  }

  const template = TEMPLATES[templateId]
  // Defense-in-depth: resolve through safeJoin so even if the heuristic above
  // missed something, traversal still fails.
  let projectDir: string
  try {
    projectDir = safeJoin(projectName)
  } catch (e) {
    return res.status(400).json({ error: (e as Error).message })
  }

  try {
    // Create project directory
    await fs.mkdir(projectDir, { recursive: true })

    // Write template files. Template paths come from the server-controlled
    // TEMPLATES dict, but we still join under projectDir defensively.
    for (const [filePath, content] of Object.entries(template.files)) {
      const abs = path.join(projectDir, filePath)
      await fs.mkdir(path.dirname(abs), { recursive: true })
      await fs.writeFile(abs, content, 'utf8')
    }

    res.json({ success: true, path: projectName })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

app.get('/api/file', async (req, res) => {
  try {
    const rel = String(req.query.path ?? '')
    const abs = safeJoin(rel)
    const stat = await fs.stat(abs)
    if (!stat.isFile()) return res.status(400).json({ error: 'Not a file' })
    const content = await fs.readFile(abs, 'utf8')
    // Track recent file in workspace memory (fire-and-forget)
    trackRecentFile(WORKSPACE, rel).catch(() => {})
    res.json({ path: rel, content })
  } catch (e) {
    res.status(404).json({ error: (e as Error).message })
  }
})

app.post('/api/file', async (req, res) => {
  try {
    const { path: rel, content } = req.body as { path: string; content: string }
    if (!rel) return res.status(400).json({ error: 'path required' })
    const abs = safeJoin(rel)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, content, 'utf8')
    // Background reindex — fire and forget so save stays fast
    index.index().catch(() => {})
    res.json({ ok: true, path: rel })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

app.post('/api/file/rename', async (req, res) => {
  try {
    const { from, to } = req.body as { from: string; to: string }
    await fs.rename(safeJoin(from), safeJoin(to))
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

app.delete('/api/file', async (req, res) => {
  try {
    const rel = String(req.query.path ?? '')
    // Refuse to delete protected paths (.git, workspace root, etc.) BEFORE
    // resolving — assertSafeDelete operates on the user-supplied string so
    // it can catch e.g. ".git" before any FS call.
    assertSafeDelete(rel)
    const abs = safeJoin(rel)
    const stat = await fs.stat(abs)
    if (stat.isDirectory()) await fs.rm(abs, { recursive: true })
    else await fs.unlink(abs)
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

app.post('/api/file/create', async (req, res) => {
  try {
    const { path: rel, type } = req.body as { path: string; type: 'file' | 'directory' }
    const abs = safeJoin(rel)
    if (type === 'directory') await fs.mkdir(abs, { recursive: true })
    else {
      await fs.mkdir(path.dirname(abs), { recursive: true })
      await fs.writeFile(abs, '', 'utf8')
    }
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

// ---------- codebase index ----------
const index = getIndex(WORKSPACE)

// Load persisted index on startup (non-blocking)
index.load().then((loaded) => {
  if (loaded) {
    // eslint-disable-next-line no-console
    console.log(`  Codebase index loaded from cache (${index.getStats().totalChunks} chunks)`)
  }
  // Always do a fresh index in the background to pick up changes
  index.index().catch(() => {})
})

// ---------- semantic search endpoints ----------
app.get('/api/search', async (req, res) => {
  try {
    const q = String(req.query.q ?? '')
    const limit = Math.min(Number(req.query.limit) || 8, 30)
    if (!q.trim()) return res.json({ hits: [] })
    const hits = index.search(q, limit)
    res.json({
      hits: hits.map((h) => ({
        filePath: h.chunk.filePath,
        startLine: h.chunk.startLine,
        endLine: h.chunk.endLine,
        symbol: h.chunk.symbol,
        kind: h.chunk.kind,
        language: h.chunk.language,
        score: h.score,
        snippet: h.chunk.content.slice(0, 500),
      })),
    })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

app.get('/api/index/stats', (_req, res) => {
  res.json(index.getStats())
})

app.post('/api/index/rebuild', async (_req, res) => {
  try {
    await index.index()
    res.json({ ok: true, ...index.getStats() })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

// ---------- literal / regex grep across workspace ----------
interface GrepResult {
  filePath: string
  line: number
  column: number
  preview: string
  matchLength: number
}

app.get('/api/grep', async (req, res) => {
  try {
    const patternStr = String(req.query.pattern ?? '')
    const caseSensitive = req.query.caseSensitive === 'true'
    const useRegex = req.query.regex === 'true'
    const wholeWord = req.query.wholeWord === 'true'
    const limit = Math.min(Number(req.query.limit) || 500, 2000)

    if (!patternStr.trim()) return res.json({ results: [] })

    // Build regex
    const flags = caseSensitive ? 'g' : 'gi'
    let pattern: RegExp
    try {
      const src = useRegex
        ? patternStr
        : wholeWord
          ? `\\b${patternStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`
          : patternStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      pattern = new RegExp(src, flags)
    } catch (e) {
      return res.status(400).json({ error: `Invalid regex: ${(e as Error).message}` })
    }

    const results: GrepResult[] = []
    await walkAndGrep(WORKSPACE, '', pattern, results, limit)

    res.json({ results, truncated: results.length >= limit })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

/** Recursively walk the workspace, reading files and running the pattern. */
async function walkAndGrep(
  absDir: string,
  relDir: string,
  pattern: RegExp,
  results: GrepResult[],
  limit: number,
): Promise<void> {
  if (results.length >= limit) return
  const entries = await fs.readdir(absDir, { withFileTypes: true })
  for (const entry of entries) {
    if (results.length >= limit) return
    if (IGNORED.has(entry.name)) continue
    const childRel = relDir ? `${relDir}/${entry.name}` : entry.name
    const childAbs = path.join(absDir, entry.name)
    if (entry.isDirectory()) {
      await walkAndGrep(childAbs, childRel, pattern, results, limit)
    } else if (entry.isFile()) {
      // Skip binary/large files
      if (isSkippableFile(entry.name)) continue
      try {
        const content = await fs.readFile(childAbs, 'utf8')
        const lines = content.split('\n')
        for (let i = 0; i < lines.length; i++) {
          if (results.length >= limit) return
          pattern.lastIndex = 0
          const m = pattern.exec(lines[i])
          if (m) {
            results.push({
              filePath: childRel,
              line: i + 1,
              column: m.index + 1,
              preview: lines[i].slice(0, 300),
              matchLength: m[0].length,
            })
          }
        }
      } catch {
        /* skip unreadable files */
      }
    }
  }
}

function isSkippableFile(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  // Skip images, fonts, archives, binaries
  const binaryExts = new Set([
    'png', 'jpg', 'jpeg', 'gif', 'svg', 'ico', 'webp', 'bmp', 'tiff',
    'woff', 'woff2', 'ttf', 'otf', 'eot',
    'zip', 'gz', 'tar', 'rar', '7z', 'bz2',
    'pdf', 'doc', 'docx', 'xls', 'xlsx',
    'mp3', 'mp4', 'avi', 'mov', 'wav', 'flv',
    'exe', 'dll', 'so', 'dylib', 'bin',
    'lock', 'map',
  ])
  // Skip files > 1MB (rough heuristic)
  return binaryExts.has(ext)
}

// ---------- chat / AI proxy (streaming) ----------
async function buildSystemPrompt(req: ChatRequest): Promise<string> {
  const base =
    'You are Newton, an elite AI pair-programmer embedded in a code editor. ' +
    'Be concise, correct, and practical. Use Markdown. Use fenced code blocks with language tags. ' +
    'When the user references "this file" or "my code", use the active file context. ' +
    'When the user asks about the codebase, use the relevant code context provided below. ' +
    '\n\nIMPORTANT — Apply-from-chat formats:' +
    '\n\nFOR MODIFICATIONS to existing files, STRONGLY PREFER the SEARCH/REPLACE block format. ' +
    'Emit one fenced code block per change, with this exact structure inside the fence:' +
    '\n  <relative/path/to/file>\n  <<<<<<< SEARCH\n  <exact existing text to find>\n  =======\n  <new text to replace with>\n  >>>>>>> REPLACE' +
    '\nRules for SEARCH/REPLACE:' +
    '\n  • The SEARCH block MUST match the file EXACTLY ONCE, character-for-character including whitespace.' +
    '\n  • Include 1-3 lines of context above/below the changed lines so the SEARCH block is unique.' +
    '\n  • Keep blocks small — one logical change per block. Multiple blocks (same or different files) ' +
    'can appear in one response, each in its own code fence.' +
    '\n  • Do NOT include `// filepath:` when using SEARCH/REPLACE — the path goes on its own line right before SEARCH.' +
    '\n\nFOR COMPLETE NEW FILES (or rare full-file rewrites), use the file-annotation format: ' +
    'prepend a comment annotation on the FIRST line of the code block with the target file path, using the syntax the target language uses for comments: ' +
    'e.g. `// filepath: src/utils/debounce.ts` for JS/TS, `# filepath: main.py` for Python, `<!-- filepath: index.html -->` for HTML/XML, etc. ' +
    'Only use this for complete, ready-to-write files — never for partial changes to an existing file. ' +
    'Prefer relative paths from the project root.'

  let context = base

  // Inject workspace memory (tech stack, decisions, conventions)
  try {
    const mem = await loadMemory(WORKSPACE)
    if (mem) {
      const memCtx = buildMemoryContext(mem)
      if (memCtx) {
        context +=
          `\n\n--- WORKSPACE MEMORY (project context) ---\n${memCtx}\n--- END MEMORY ---\n` +
          'Follow the project conventions and decisions listed above when writing code.'
      }
    }
  } catch {
    /* memory is optional — ignore failures */
  }

  // Inject active file context
  if (req.activeFile?.content) {
    context +=
      `\n\nThe user currently has \`${req.activeFile.path}\` open:\n\`\`\`\n${req.activeFile.content.slice(0, CONTEXT_SLICE_ACTIVE_FILE)}\n\`\`\``
  }

  // Inject @-mentioned attached files
  if (req.attachedFiles && req.attachedFiles.length > 0) {
    context +=
      '\n\n--- @-MENTIONED FILES (explicitly attached by the user) ---'
    for (const f of req.attachedFiles) {
      context += `\nFile: \`${f.path}\`\n\`\`\`\n${f.content.slice(0, CONTEXT_SLICE_ATTACHED)}\n\`\`\`\n`
    }
    context += '--- END @-MENTIONED FILES ---'
  }

  // Inject semantic codebase context: search for relevant code using the last user message
  const lastUserMsg = [...req.messages].reverse().find((m) => m.role === 'user')
  if (lastUserMsg) {
    const codebaseCtx = index.getContextForQuery(lastUserMsg.content, 6000)
    if (codebaseCtx) {
      context +=
        `\n\n--- RELEVANT CODEBASE CONTEXT (from semantic search) ---\n${codebaseCtx}\n--- END CONTEXT ---\n` +
        'Use this context to ground your answers. If the user asks "where is X" or "find Y", ' +
        'reference these files with their paths and line numbers.'
    }
  }

  return context
}

app.post('/api/chat', sensitiveLimiter, async (req, res) => {
  const body = req.body as ChatRequest
  const ac = new AbortController()
  // Listen on res, not req: in modern Node, req 'close' fires when the request
  // body finishes uploading, not when the client disconnects. res 'close' fires
  // on actual disconnect.
  res.on('close', () => ac.abort())

  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders?.()

  const send = (chunk: string) => {
    res.write(chunk)
  }
  const done = () => res.end()

  try {
    const provider: ProviderConfig = body.provider ?? { provider: 'demo', model: 'demo' }

    // DEMO mode (or no key for real provider -> gracefully fall back)
    if (provider.provider === 'demo' || body.forceDemo) {
      const text = demoAnswer(body.messages, body.activeFile ?? null)
      await streamDemo(text, send, ac.signal)
      return done()
    }

    // Protocol-based dispatch — works for any provider in the registry.
    const def = getProviderDef(provider.provider)
    const proto = getProtocol(provider.provider)

    if (def?.needsKey && !provider.apiKey) {
      return fallbackNoKey(send, done, def.name)
    }

    if (proto === 'anthropic') {
      await streamAnthropic(body, provider, send, ac.signal)
      return done()
    }
    if (proto === 'ollama') {
      await streamOllama(body, provider, send, ac.signal)
      return done()
    }
    // default: openai-compat (covers OpenAI, Groq, Mistral, DeepSeek, OpenRouter, Together, xAI, Gemini, …)
    await streamOpenAiCompat(body, provider, send, ac.signal)
    done()
  } catch (e) {
    const msg = (e as Error).message || String(e)
    try {
      send(`\n\n> ⚠️ Error contacting provider: ${msg}`)
      if (msg.toLowerCase().includes('api key') || msg.includes('401')) {
        send('\n> Switch to **Demo** mode or add a valid key in Settings.')
      }
    } catch {
      /* ignore */
    }
    done()
  }
})

async function fallbackNoKey(send: (c: string) => void, done: () => void, name: string) {
  await streamDemo(
    `You selected **${name}** but didn't provide an API key. ` +
      'Open **Settings** (gear icon) and paste your key, or switch back to **Demo** mode. ' +
      'In the meantime, here is the demo assistant:\n\n' +
      demoAnswer([], null),
    send,
  )
  done()
}

// ----- OpenAI-compatible streaming (covers OpenAI, Groq, Mistral, DeepSeek,
// OpenRouter, Together, xAI, Gemini, and any other openai-compat endpoint) -----
async function streamOpenAiCompat(
  body: ChatRequest,
  provider: ProviderConfig,
  send: (c: string) => void,
  signal: AbortSignal,
) {
  const def = getProviderDef(provider.provider)
  const baseUrl = (provider.baseUrl || def?.defaultBaseUrl || 'https://api.openai.com/v1').replace(/\/$/, '')
  const messages = [{ role: 'system', content: await buildSystemPrompt(body) }, ...body.messages]
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${provider.apiKey}`,
  }
  // OpenRouter recommends these for analytics + routing
  if (provider.provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://github.com/newton-editor'
    headers['X-Title'] = 'Newton Editor'
  }
  const r = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: provider.model,
      messages,
      stream: true,
      temperature: 0.3,
    }),
    signal,
  })
  if (!r.ok || !r.body) {
    const txt = await r.text().catch(() => '')
    throw new Error(`${def?.name ?? provider.provider} ${r.status}: ${txt.slice(0, 300)}`)
  }
  await readSSE(r.body, (line) => {
    if (line === '[DONE]') return
    try {
      const json = JSON.parse(line)
      const delta = json.choices?.[0]?.delta?.content
      if (delta) send(delta)
    } catch {
      /* ignore partial */
    }
  })
}

// ----- Anthropic streaming -----
async function streamAnthropic(
  body: ChatRequest,
  provider: ProviderConfig,
  send: (c: string) => void,
  signal: AbortSignal,
) {
  const sys = await buildSystemPrompt(body)
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': provider.apiKey!,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: provider.model,
      max_tokens: 2048,
      system: sys,
      messages: body.messages.map((m) => ({ role: m.role, content: m.content })),
      stream: true,
    }),
    signal,
  })
  if (!r.ok || !r.body) {
    const txt = await r.text().catch(() => '')
    throw new Error(`Anthropic ${r.status}: ${txt.slice(0, 300)}`)
  }
  await readSSE(r.body, (line) => {
    try {
      const json = JSON.parse(line)
      if (json.type === 'content_block_delta' && json.delta?.text) {
        send(json.delta.text)
      }
    } catch {
      /* ignore */
    }
  })
}

// ----- Ollama streaming -----
async function streamOllama(
  body: ChatRequest,
  provider: ProviderConfig,
  send: (c: string) => void,
  signal: AbortSignal,
) {
  const baseUrl = (provider.baseUrl || 'http://localhost:11434').replace(/\/$/, '')
  const r = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: provider.model,
      messages: [{ role: 'system', content: await buildSystemPrompt(body) }, ...body.messages],
      stream: true,
    }),
    signal,
  })
  if (!r.ok || !r.body) {
    const txt = await r.text().catch(() => '')
    throw new Error(
      `Ollama ${r.status}: ${txt.slice(0, 300)}. Is Ollama running at ${baseUrl}?`,
    )
  }
  await readSSE(r.body, (line) => {
    try {
      const json = JSON.parse(line)
      if (json.message?.content) send(json.message.content)
    } catch {
      /* ignore */
    }
  })
}

// Generic SSE/NDJSON line reader
async function readSSE(
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => void,
) {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let idx
    while ((idx = buffer.indexOf('\n')) >= 0) {
      let line = buffer.slice(0, idx).trim()
      buffer = buffer.slice(idx + 1)
      if (line.startsWith('data:')) line = line.slice(5).trim()
      if (line === '') continue
      onLine(line)
    }
  }
}

// ---------- inline edit endpoint (⌘K) ----------
app.post('/api/edit', sensitiveLimiter, async (req, res) => {
  try {
    const body = req.body as EditRequest
    const provider = body.provider ?? { provider: 'demo', model: 'demo' }

    // Demo mode
    if (provider.provider === 'demo' || body.forceDemo) {
      const r = demoEdit(body.code, body.instruction, body.language)
      return res.json(r satisfies EditResponse)
    }

    // Real provider: ask the LLM to return ONLY code
    const sys =
      'You are an inline code-editing assistant. The user selected code and gave an instruction. ' +
      'Apply the instruction and return ONLY the edited code — no explanation, no markdown fences, ' +
      'no commentary. Preserve indentation and surrounding context. Output raw code only.'
    const userMsg =
      `File: ${body.path ?? '(untitled)'}\nLanguage: ${body.language}\n` +
      `Instruction: ${body.instruction}\n\nCode:\n${body.code}`

    let code = await llmComplete(provider, sys, userMsg)

    // strip accidental markdown fences
    code = code.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim()
    res.json({ code, note: 'Edited with ' + provider.provider + '.' } satisfies EditResponse)
  } catch (e) {
    res.status(500).json({ code: req.body?.code ?? '', note: 'Error: ' + (e as Error).message })
  }
})

/**
 * Non-streaming LLM completion helper — fully protocol-driven.
 * Determines URL, headers, body shape, and response extraction automatically
 * from the provider registry. Works for any provider.
 */
/** Detect "max_tokens too high" errors so we can retry with a lower cap. */
function isMaxTokensError(msg: string): boolean {
  const m = msg.toLowerCase()
  return (
    m.includes('max_tokens') ||
    m.includes('max tokens') ||
    m.includes('output token') ||
    m.includes('output length')
  )
}

async function llmComplete(
  provider: ProviderConfig,
  system: string,
  user: string,
  opts: { maxTokens?: number; jsonMode?: boolean } = {},
): Promise<string> {
  // If a high cap is requested, attempt it but step down on provider rejection.
  // Many models cap at 4096 or 8192; we don't have a per-model table, so adapt
  // by retrying with progressively lower values until the provider accepts.
  const requested = opts.maxTokens ?? 4096
  const ladder = requested > 4096
    ? Array.from(new Set([requested, 8192, 4096])).filter((n) => n <= requested)
    : [requested]
  let lastErr: Error | null = null
  for (const cap of ladder) {
    try {
      return await llmCompleteOnce(provider, system, user, cap, opts.jsonMode ?? false)
    } catch (e) {
      lastErr = e as Error
      if (cap > 4096 && isMaxTokensError(lastErr.message)) {
        // Provider rejected this cap — try the next one down.
        continue
      }
      throw e
    }
  }
  throw lastErr ?? new Error('llmComplete failed with no error captured')
}

async function llmCompleteOnce(
  provider: ProviderConfig,
  system: string,
  user: string,
  maxTokens: number,
  jsonMode: boolean,
): Promise<string> {
  const def = getProviderDef(provider.provider)
  const proto = getProtocol(provider.provider)
  const baseUrl = (provider.baseUrl || def?.defaultBaseUrl || 'https://api.openai.com/v1').replace(/\/$/, '')

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  let url: string
  let bodyObj: any

  if (proto === 'anthropic') {
    url = `${baseUrl}/v1/messages`
    headers['x-api-key'] = provider.apiKey!
    headers['anthropic-version'] = '2023-06-01'
    bodyObj = { model: provider.model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }], stream: false }
  } else if (proto === 'ollama') {
    url = `${baseUrl}/api/chat`
    // Ollama defaults num_ctx to 2048 tokens — far too small for any real
    // planning prompt (system + workspace files + attached file contents +
    // output budget). Size num_ctx to fit prompt + output with headroom,
    // floored at 16384 so chat/completion calls don't force a context-window
    // change and trigger a model reload between calls. ~4 chars/token.
    const approxInputTokens = Math.ceil((system.length + user.length) / 4)
    const needed = approxInputTokens + maxTokens + 1024
    const ladder = [16384, 32768, 65536, 131072]
    const num_ctx = ladder.find((n) => n >= needed) ?? 131072
    const ollamaBody: any = {
      model: provider.model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      stream: false,
      options: { num_predict: maxTokens, num_ctx },
    }
    // JSON-mode: forces the model to emit valid JSON. Only set when the
    // caller is asking for structured output — for chat/completion calls
    // it would mangle prose responses.
    if (jsonMode) ollamaBody.format = 'json'
    bodyObj = ollamaBody
  } else {
    // openai-compat (OpenAI, Groq, Mistral, DeepSeek, OpenRouter, Together, xAI, Gemini, …)
    url = `${baseUrl}/chat/completions`
    headers.Authorization = `Bearer ${provider.apiKey}`
    if (provider.provider === 'openrouter') {
      headers['HTTP-Referer'] = 'https://github.com/newton-editor'
      headers['X-Title'] = 'Newton Editor'
    }
    bodyObj = {
      model: provider.model,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      stream: false,
      temperature: 0.2,
      max_tokens: maxTokens,
    }
    if (jsonMode) bodyObj.response_format = { type: 'json_object' }
  }

  const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(bodyObj) })
  if (!r.ok) {
    const txt = await r.text().catch(() => '')
    throw new Error(`${def?.name ?? provider.provider} ${r.status}: ${txt.slice(0, 200)}`)
  }

  const text = await r.text()
  try {
    const j = JSON.parse(text)
    if (proto === 'anthropic') return (j.content ?? []).map((b: any) => b.text ?? '').join('')
    if (proto === 'ollama') return j.message?.content ?? ''
    return j.choices?.[0]?.message?.content ?? ''
  } catch {
    return text
  }
}

// ---------- AI code completion (tab completion / FIM) ----------
app.post('/api/complete', completionLimiter, async (req, res) => {
  try {
    const { prompt, suffix, language, path, provider: rawProvider } = req.body as {
      prompt: string
      suffix?: string
      language?: string
      path?: string
      provider?: ProviderConfig
    }

    const provider = rawProvider ?? { provider: 'demo', model: 'demo' }

    // Demo mode: return empty — the heuristic engine handles it client-side
    if (provider.provider === 'demo') {
      return res.json({ completion: '' })
    }

    const lang = language || 'plaintext'
    const fileName = path ? path.split('/').pop() : 'untitled'

    // Use a fill-in-the-middle style prompt for best context awareness
    const sys =
      'You are a fast code completion engine. Complete the code at the cursor position. ' +
      'Return ONLY the completion text — no explanation, no markdown, no backticks. ' +
      'The completion should be the text that goes BETWEEN the prefix and suffix. ' +
      'Keep it concise (1-10 lines). Match the surrounding style, indentation, and conventions.'

    const user =
      `File: ${fileName}\nLanguage: ${lang}\n\n` +
      `=== CODE BEFORE CURSOR ===\n${prompt.slice(-4000)}\n\n` +
      `=== CODE AFTER CURSOR ===\n${(suffix || '').slice(0, 2000)}\n\n` +
      `=== COMPLETE AT CURSOR (output only the insertion) ===`

    let completion = await llmComplete(provider, sys, user)

    // Clean up: remove markdown fences, trim leading newlines
    completion = completion.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '')
    // Don't return empty whitespace-only completions
    if (!completion.trim()) completion = ''

    res.json({ completion })
  } catch (e) {
    res.status(500).json({ completion: '', error: (e as Error).message })
  }
})

// ---------- agent endpoints ----------
app.post('/api/agent/plan', sensitiveLimiter, async (req, res) => {
  try {
    const body = req.body as AgentRequest
    const provider = body.provider ?? { provider: 'demo', model: 'demo' }

    if (provider.provider === 'demo' || body.forceDemo) {
      return res.json(demoPlan(body))
    }

    // Real provider: ask the model for a JSON plan
    const complete = (sys: string, user: string) => llmComplete(provider, sys, user)

    try {
      const plan = await llmPlan(body, complete)
      return res.json(plan)
    } catch (e) {
      // fall back to demo plan so the user still gets value
      const plan = demoPlan(body)
      return res.json({ ...plan, summary: plan.summary + ` (LLM planning failed: ${(e as Error).message}; using heuristic fallback.)` })
    }
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

/** Execute one step on disk. */
app.post('/api/agent/step', async (req, res) => {
  try {
    const step = req.body as import('../shared/types.js').AgentStep
    const result = await executeStep(step)
    res.json(result)
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

// ---------- Composer (multi-file AI editing) ----------
app.post('/api/composer', async (req, res) => {
  try {
    const body = req.body as import('../shared/types.js').ComposerRequest
    const provider = body.provider ?? { provider: 'demo', model: 'demo' }

    // --- Demo mode: heuristic multi-file edits ---
    if (provider.provider === 'demo' || body.forceDemo) {
      const changes = demoComposer(body)
      return res.json({ changes, summary: `Demo composer: ${changes.length} file change(s) proposed.` })
    }

    // --- Real provider: ask the LLM for a structured response ---
    const sys =
      'You are an expert multi-file code editor. Given an instruction and multiple files, ' +
      'you produce the EXACT final content for each file that needs changes. ' +
      'Return a JSON array of objects with {path, content, description}. ' +
      'Each "content" must be the COMPLETE file content (not a diff). ' +
      'Only include files that need changes. Return ONLY the JSON array — no markdown, no explanation.'

    const filesBlock = body.files
      .map((f) => `--- FILE: ${f.path} ---\n${f.content}`)
      .join('\n\n')

    const user = `Instruction: ${body.instruction}\n\nFiles:\n${filesBlock}\n\nReturn the JSON array of changed files now.`

    let raw = await llmComplete(provider, sys, user)
    // Strip markdown fences
    raw = raw.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim()

    let parsed: any[]
    try {
      parsed = JSON.parse(raw)
    } catch {
      // Try to extract JSON array from response
      const m = raw.match(/\[[\s\S]*\]/)
      if (m) {
        parsed = JSON.parse(m[0])
      } else {
        throw new Error('LLM did not return valid JSON')
      }
    }

    const beforeMap = new Map(body.files.map((f) => [f.path, f.content]))
    const changes = (parsed as any[]).map((entry) => ({
      path: String(entry.path),
      before: beforeMap.get(String(entry.path)) ?? '',
      after: String(entry.content),
      description: String(entry.description ?? 'Updated'),
      status: 'pending' as const,
    }))

    res.json({
      changes,
      summary: `${changes.length} file change(s) proposed by ${provider.provider}.`,
    })
  } catch (e) {
    // Fall back to demo
    const changes = demoComposer(req.body)
    res.json({
      changes,
      summary: `LLM failed (${(e as Error).message}); demo heuristic applied: ${changes.length} change(s).`,
    })
  }
})

/** Demo heuristic multi-file composer. */
function demoComposer(body: import('../shared/types.js').ComposerRequest): import('../shared/types.js').ComposerFileChange[] {
  const changes: import('../shared/types.js').ComposerFileChange[] = []
  const q = body.instruction.toLowerCase()

  for (const file of body.files) {
    let modified = file.content
    let desc = ''

    // "add comment" / "document"
    if (/\b(add|document|comment)\b/.test(q) && file.content.trim()) {
      if (!file.content.startsWith('/**')) {
        const fileName = file.path.split('/').pop() || file.path
        modified = `/**\n * ${fileName}\n * ${body.instruction}\n */\n${file.content}`
        desc = 'Added documentation header'
      }
    }
    // "remove console.log"
    else if (/remove.*console\.log|clean.*console/.test(q)) {
      const cleaned = file.content
        .split('\n')
        .filter((l) => !l.trim().startsWith('console.log('))
        .join('\n')
      if (cleaned !== file.content) {
        modified = cleaned
        desc = 'Removed console.log statements'
      }
    }
    // "add typescript" / "add types"
    else if (/add.*type|typescript|annotate/.test(q) && file.path.endsWith('.js')) {
      modified = file.content
      desc = 'No structural changes needed (try with a real LLM for type annotations)'
    }
    // "format" / "prettier"
    else if (/format|prettier|indent/.test(q)) {
      modified = file.content
        .split('\n')
        .map((l) => l.replace(/\s+$/, ''))
        .join('\n')
      desc = 'Trimmed trailing whitespace'
    }

    if (desc) {
      changes.push({
        path: file.path,
        before: file.content,
        after: modified,
        description: desc,
        status: 'pending',
      })
    }
  }

  return changes
}

// ---------- natural-language shell (NL → command) ----------
app.post('/api/nlsh', sensitiveLimiter, async (req, res) => {
  try {
    const { prompt, cwd, provider } = req.body as {
      prompt: string
      cwd?: string
      provider?: ProviderConfig
    }
    const p = provider ?? { provider: 'demo', model: 'demo' }

    // Demo mode: heuristic translation of common English → shell
    if (p.provider === 'demo') {
      return res.json({ command: demoNlsh(prompt), note: 'Demo heuristic translation.' })
    }

    // Real provider
    const sys =
      'You translate a natural-language request into a SINGLE shell command. ' +
      'Return ONLY the raw command — no markdown, no explanation, no backticks. ' +
      'Prefer cross-platform commands. If the request is ambiguous, pick the most common interpretation.'
    const user = `Request: ${prompt}\nWorking directory: ${WORKSPACE}\nReturn the shell command only:`
    let cmd = await llmComplete(p, sys, user)
    cmd = cmd.replace(/```[\w]*\n?/g, '').replace(/```/g, '').trim()
    // take only first line if model added explanation
    cmd = cmd.split('\n')[0].trim()
    res.json({ command: cmd, note: `Translated with ${p.provider}.` })
  } catch (e) {
    res.status(500).json({ command: '', error: (e as Error).message })
  }
})

/** Heuristic NL→shell translator for demo mode. */
function demoNlsh(prompt: string): string {
  const q = prompt.toLowerCase().trim()
  // list files
  if (/\b(list|show|ls|dir)\b.*\b(files?|dir)/.test(q) || q === 'ls' || q === 'list files') return 'ls -la'
  if (/tree/.test(q)) return 'find . -not -path "*/node_modules/*" | head -50'
  // git
  if (/git status/.test(q)) return 'git status'
  if (/git log/.test(q)) return 'git log --oneline -10'
  if (/\b(commit|save changes)\b/.test(q) && /git/.test(q)) return 'git add -A && git commit -m "update"'
  if (/\bpush\b/.test(q) && /git/.test(q)) return 'git push'
  if (/\bpull\b/.test(q) && /git/.test(q)) return 'git pull'
  if (/git.*init/.test(q)) return 'git init'
  // npm
  if (/\b(npm|yarn|pnpm)\b.*\b(install|add|i)\b/.test(q)) {
    if (/dev/.test(q)) return 'npm install -D'
    return 'npm install'
  }
  if (/run dev/.test(q)) return 'npm run dev'
  if (/build/.test(q)) return 'npm run build'
  if (/\btest\b/.test(q)) return 'npm test'
  // find
  if (/\b(find|search|grep)\b.*\b(file|name)\b/.test(q)) {
    const m = prompt.match(/(?:called|named|for)\s+["']?([\w.-]+)/i)
    return m ? `find . -name "${m[1]}" -not -path "*/node_modules/*"` : 'grep -r "pattern" .'
  }
  // disk
  if (/disk|space|du\b/.test(q)) return 'du -sh *'
  // process
  if (/process|running|ps\b/.test(q)) return 'ps aux | head -20'
  // cat / read
  if (/\b(cat|read|show|view)\b.*\b(file|content)\b/.test(q)) {
    const m = prompt.match(/["']([\w./-]+)["']/)
    return m ? `cat ${m[1]}` : 'cat filename'
  }
  // echo
  if (/echo/.test(q)) return 'echo "hello"'
  // fallback: just return the prompt as-is (user can edit before running)
  return `# Could not translate — type a command manually\n${prompt}`
}

// ---------- execute shell command ----------
app.post('/api/exec', sensitiveLimiter, async (req, res) => {
  try {
    const { command } = req.body as { command: string }
    if (!command || !command.trim()) return res.json({ stdout: '', stderr: '', code: 0 })

    const { exec } = await import('node:child_process')
    exec(
      command,
      { cwd: WORKSPACE, timeout: 30000, maxBuffer: 1024 * 1024 },
      (err, stdout, stderr) => {
        res.json({
          stdout: stdout.toString(),
          stderr: stderr.toString() + (err ? `\n${err.message}` : ''),
          code: err ? (err as any).code ?? 1 : 0,
        })
      },
    )
  } catch (e) {
    res.status(500).json({ stdout: '', stderr: (e as Error).message, code: 1 })
  }
})

// ---------- AI test generation ----------
app.post('/api/gen-tests', async (req, res) => {
  try {
    const { code, path, language, provider } = req.body as {
      code: string
      path: string
      language: string
      provider?: ProviderConfig
    }
    const p = provider ?? { provider: 'demo', model: 'demo' }

    if (p.provider === 'demo') {
      return res.json({ tests: demoTests(code, path, language), note: 'Demo test scaffold.' })
    }

    const sys =
      'You are an expert test writer. Generate comprehensive unit tests for the given code. ' +
      'Return ONLY the test file code — no explanation. Use the most common testing framework ' +
      'for the language (Jest/Vitest for JS/TS, pytest for Python, etc).'
    const user = `File: ${path}\nLanguage: ${language}\n\nSource code:\n\`\`\`\n${code}\n\`\`\`\n\nGenerate tests:`
    let tests = await llmComplete(p, sys, user)
    tests = tests.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim()
    res.json({ tests, note: `Generated with ${p.provider}.` })
  } catch (e) {
    res.status(500).json({ tests: '', error: (e as Error).message })
  }
})

/** Demo-mode test scaffold generator — produces meaningful, runnable test scaffolds. */
function demoTests(code: string, filePath: string, language: string): string {
  const base = path.basename(filePath, path.extname(filePath))
  const ext = path.extname(filePath)

  // ---- Python ----
  if (language === 'python') {
    // Extract function names + params
    const funcs = [...code.matchAll(/def\s+(\w+)\s*\(([^)]*)\)/g)].map((m) => ({
      name: m[1],
      params: (m[2] || '')
        .split(',')
        .map((p) => p.trim().split(':')[0].split('=')[0].trim())
        .filter((p) => p && p !== 'self'),
    }))

    const hasClass = /^\s*class\s+\w+/m.test(code)
    const className = hasClass ? (code.match(/class\s+(\w+)/)?.[1] ?? 'Subject') : null

    if (funcs.length === 0) {
      return `import pytest\nfrom ${base} import *\n\ndef test_module_imports():\n    """Verify the module loads without errors."""\n    import ${base}\n    assert ${base} is not None\n`
    }

    const testFns = funcs
      .filter((f) => !f.name.startsWith('_'))
      .map((f) => {
        const args = f.params.length > 0 ? '\n        # TODO: provide realistic arguments\n        ' + f.params.map((p) => `${p}=${guessDefaultPython(p)}`).join(', ') : ''
        return `def test_${f.name}():\n    """Test ${f.name} runs and returns a value."""\n    result = ${className ? `${className}().` : ''}${f.name}(${args.trim()})\n    assert result is not None  # TODO: assert expected value`
      })
      .join('\n\n\n')

    return `import pytest\nfrom ${base} import ${className ? className + ', ' : ''}${funcs.map((f) => f.name).join(', ')}\n\n\n${testFns}\n`
  }

  // ---- JS/TS ----
  const isTs = ext === '.ts' || ext === '.tsx'
  const isJsx = ext === '.tsx' || ext === '.jsx'
  const hasDefaultExport = /export\s+default\s+/.test(code)

  // Extract exported functions with their params
  const exportedFns: { name: string; params: string[]; isAsync: boolean; isArrow: boolean }[] = []
  for (const m of code.matchAll(/export\s+(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/g)) {
    exportedFns.push({
      name: m[1],
      params: parseParams(m[2] || ''),
      isAsync: /async/.test(m[0]),
      isArrow: false,
    })
  }
  for (const m of code.matchAll(/export\s+const\s+(\w+)\s*=\s*(?:async\s*)?\(?\s*([^)=]*)\)?\s*=>/g)) {
    exportedFns.push({
      name: m[1],
      params: parseParams(m[2] || ''),
      isAsync: /async/.test(m[0]),
      isArrow: true,
    })
  }

  // Extract exported consts (non-function values)
  const exportedConsts: { name: string; value: string }[] = []
  for (const m of code.matchAll(/export\s+const\s+(\w+)\s*=\s*([^;\n]+)/g)) {
    const name = m[1]
    const value = m[2].trim()
    // Skip if it's a function/arrow (already captured above)
    if (/=>|\bfunction\b/.test(value)) continue
    if (/^[A-Z]\w*/.test(name) && isJsx) continue // React component, handle below
    exportedConsts.push({ name, value })
  }

  // Detect React components (PascalCase exports in tsx/jsx)
  const components: { name: string; props: string[] }[] = []
  if (isJsx) {
    for (const m of code.matchAll(/(?:export\s+(?:default\s+)?(?:function|const)\s+([A-Z]\w*)\s*(?:\(\s*\{([^}]*)\}\s*\)|\(([^)]*)\))?)/g)) {
      const name = m[1]
      const propsRaw = m[2] || m[3] || ''
      components.push({ name, props: parseParams(propsRaw) })
    }
  }

  const allNames = [
    ...exportedFns.map((f) => f.name),
    ...exportedConsts.map((c) => c.name),
    ...components.map((c) => c.name),
  ]

  // Build imports
  let importLine: string
  const importNames = allNames.length > 0 ? allNames.join(', ') : ''
  if (hasDefaultExport) {
    const defaultName = 'DefaultExport'
    importLine = isTs
      ? `import ${defaultName}${importNames ? `, { ${importNames} }` : ''} from './${base}'`
      : `const ${defaultName}${importNames ? `, { ${importNames} }` : ''} = require('./${base}')`
  } else if (importNames) {
    importLine = isTs
      ? `import { ${importNames} } from './${base}'`
      : `const { ${importNames} } = require('./${base}')`
  } else {
    importLine = isTs
      ? `import * as ${base.replace(/[^a-zA-Z0-9]/g, '_')} from './${base}'`
      : `const mod = require('./${base}')`
  }

  // Build test cases
  const testCases: string[] = []

  // Module import test (always first — catches syntax errors)
  testCases.push(`  it('module exports are defined', () => {
${allNames.length > 0
      ? allNames.map((n) => `    expect(${n}).toBeDefined()`).join('\n')
      : `    // Module has no named exports, but should still load\n    expect(true).toBe(true)`}
  })`)

  // Function tests
  for (const fn of exportedFns) {
    if (fn.name.startsWith('_')) continue
    const callArgs = fn.params.map((p) => guessDefaultJS(p, code)).join(', ')
    const awaitKw = fn.isAsync ? 'await ' : ''
    const returnType = inferReturnType(code, fn.name)
    testCases.push(`  it('${fn.name} ${fn.isAsync ? 'resolves' : 'returns'} expected ${returnType || 'value'}', async () => {
    const result = ${awaitKw}${fn.name}(${callArgs})
    ${returnType === 'array' ? 'expect(Array.isArray(result)).toBe(true)' : returnType === 'number' ? 'expect(typeof result).toBe(\'number\')' : returnType === 'string' ? 'expect(typeof result).toBe(\'string\')' : returnType === 'boolean' ? 'expect(typeof result).toBe(\'boolean\')' : returnType === 'object' ? 'expect(result).toEqual(expect.any(Object))' : 'expect(result).toBeDefined() // TODO: assert expected value'}
  })`)
  }

  // Const value tests
  for (const c of exportedConsts) {
    if (c.name.startsWith('_')) continue
    const valType = guessValueType(c.value)
    testCases.push(`  it('${c.name} has correct value type', () => {
    expect(${c.name}).${valType.assertion}
  })`)
  }

  // React component tests
  for (const comp of components) {
    testCases.push(`  it('${comp.name} renders without crashing', () => {
    ${isJsx ? `// Requires @testing-library/react in your devDependencies
    // import { render } from '@testing-library/react'
    // render(<${comp.name} ${comp.props.map((p) => `${p}={${guessDefaultJS(p, code)}}`).join(' ')} />)
    expect(typeof ${comp.name}).toBe('function')` : `expect(typeof ${comp.name}).toBe('function')`}
  })`)
  }

  return `${importLine}

describe('${base}', () => {
${testCases.join('\n\n')}
})
`

  // ---- helpers (IIFE-scoped) ----
  function parseParams(raw: string): string[] {
    return raw
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => {
        // Handle TypeScript type annotations: "name: type" or destructured "{ a, b }"
        if (p.startsWith('{')) return p // destructured — keep as-is
        return p.split(':')[0].split('=')[0].split('?')[0].trim()
      })
      .filter((p) => p && p !== 'this' && p !== 'self')
  }

  function guessDefaultJS(paramName: string, source: string): string {
    const p = paramName.replace(/[{}]/g, '').trim()
    if (!p) return 'undefined'
    if (/^(id|idx|index|count|num|n|len|length|size)$/i.test(p)) return '0'
    if (/^(name|title|label|text|str|string|key|path|url|href|email|message|msg)$/i.test(p)) return "'sample'"
    if (/^(is|has|can|should|enabled|active|visible|checked|open)/i.test(p)) return 'false'
    if (/^(items|list|arr|array|data|values|rows|entries)$/i.test(p)) return '[]'
    if (/^(options|config|props|settings|params|obj|item|user|model)/i.test(p)) return '{}'
    if (/^(callback|cb|fn|handler|onClick|onChange|onSubmit)$/i.test(p)) return 'jest.fn()'
    if (/^(event|e)$/i.test(p)) return '{} as any // mock event'
    return 'undefined'
  }

  function guessDefaultPython(paramName: string): string {
    const p = paramName.trim()
    if (!p) return 'None'
    if (/^(id|idx|index|count|num|n|len|length|size)$/i.test(p)) return '0'
    if (/^(name|title|label|text|str|string|key|path|url|email|message)$/i.test(p)) return "'sample'"
    if (/^(is|has|can|should|enabled|active)/i.test(p)) return 'False'
    if (/^(items|list|arr|array|data|values|rows)$/i.test(p)) return '[]'
    if (/^(options|config|props|settings|params|obj)/i.test(p)) return '{}'
    return 'None'
  }

  function inferReturnType(source: string, fnName: string): string {
    // Look for explicit return type annotation: function foo(): Type
    const typeMatch = source.match(new RegExp(`function\\s+${fnName}\\s*\\([^)]*\\)\\s*:\\s*(\\w+)`))
    if (typeMatch) return typeMatch[1].toLowerCase()
    // Look for arrow with return type
    const arrowMatch = source.match(new RegExp(`${fnName}\\s*=\\s*(?:async\\s*)?\\([^)]*\\)\\s*:\\s*(\\w+)`))
    if (arrowMatch) return arrowMatch[1].toLowerCase()
    return ''
  }

  function guessValueType(value: string): { assertion: string } {
    const v = value.trim()
    if (/^['"`]/.test(v)) return { assertion: 'toEqual(expect.any(String))' }
    if (/^-?\d+(\.\d+)?$/.test(v)) return { assertion: 'toEqual(expect.any(Number))' }
    if (v === 'true' || v === 'false') return { assertion: 'toEqual(expect.any(Boolean))' }
    if (/^\[/.test(v)) return { assertion: 'toEqual(expect.any(Array))' }
    if (/^\{/.test(v)) return { assertion: 'toEqual(expect.any(Object))' }
    return { assertion: 'toBeDefined()' }
  }
}

// ---------- diagnostics (TypeScript / lint problems) ----------
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

// Cache the last diagnostics result so repeated calls are fast
let lastDiag: DiagnosticsResult | null = null
let diagBusy = false

app.get('/api/diagnostics', async (_req, res) => {
  try {
    // Return cached result if available (or if a check is in-flight)
    if (lastDiag) {
      res.json(lastDiag)
      return
    }
    if (diagBusy) {
      res.json({ diagnostics: [], errorCount: 0, warningCount: 0, available: false })
      return
    }
    diagBusy = true

    const result = await runDiagnostics()
    lastDiag = result
    diagBusy = false
    res.json(result)
  } catch (e) {
    diagBusy = false
    res.status(500).json({ error: (e as Error).message })
  }
})

app.post('/api/diagnostics/refresh', async (_req, res) => {
  try {
    // Force a fresh check
    lastDiag = null
    if (diagBusy) {
      res.json({ diagnostics: [], errorCount: 0, warningCount: 0, available: false })
      return
    }
    diagBusy = true
    const result = await runDiagnostics()
    lastDiag = result
    diagBusy = false
    res.json(result)
  } catch (e) {
    diagBusy = false
    res.status(500).json({ error: (e as Error).message })
  }
})

async function runDiagnostics(): Promise<DiagnosticsResult> {
  const diagnostics: Diagnostic[] = []

  // Check for TypeScript project
  const tsconfigExists = existsSync(path.join(WORKSPACE, 'tsconfig.json'))
  const hasTypeScript = tsconfigExists ||
    (await fs.readdir(WORKSPACE).catch(() => [])).some((f) => f.endsWith('.ts') || f.endsWith('.tsx'))

  // Try TypeScript diagnostics
  if (hasTypeScript) {
    try {
      const tscResult = await runCommand(
        'npx tsc --noEmit --pretty false 2>&1',
        { cwd: WORKSPACE, timeout: 45000 },
      )
      const lines = tscResult.split('\n').filter((l) => l.trim() && l.includes('('))
      for (const line of lines) {
        const diag = parseTscLine(line)
        if (diag) diagnostics.push(diag)
      }
    } catch {
      // tsc not available — try checking for common issues heuristically
    }
  }

  // Run ESLint if available
  try {
    const hasEslint = existsSync(path.join(WORKSPACE, '.eslintrc.js')) ||
      existsSync(path.join(WORKSPACE, '.eslintrc.json')) ||
      existsSync(path.join(WORKSPACE, '.eslintrc.cjs')) ||
      existsSync(path.join(WORKSPACE, 'eslint.config.js')) ||
      existsSync(path.join(WORKSPACE, 'eslint.config.mjs'))

    if (hasEslint) {
      const eslintResult = await runCommand(
        'npx eslint --format json . 2>/dev/null',
        { cwd: WORKSPACE, timeout: 30000 },
      )
      try {
        const eslintData = JSON.parse(eslintResult) as Array<{
          filePath: string
          messages: Array<{
            line: number
            column: number
            severity: number
            message: string
            ruleId?: string
          }>
        }>
        for (const file of eslintData) {
          const relPath = path.relative(WORKSPACE, file.filePath)
          for (const msg of file.messages) {
            diagnostics.push({
              filePath: relPath,
              line: msg.line,
              column: msg.column,
              severity: msg.severity === 2 ? 'error' : 'warning',
              message: msg.message,
              code: msg.ruleId,
              source: 'eslint',
            })
          }
        }
      } catch {
        // JSON parse failed — ignore
      }
    }
  } catch {
    // ESLint not available
  }

  // If no linters available, run heuristic checks for common issues
  if (diagnostics.length === 0) {
    const heuristic = await runHeuristicDiagnostics()
    diagnostics.push(...heuristic)
  }

  const errorCount = diagnostics.filter((d) => d.severity === 'error').length
  const warningCount = diagnostics.filter((d) => d.severity === 'warning').length
  const available = hasTypeScript || diagnostics.length > 0

  return { diagnostics, errorCount, warningCount, available }
}

/** Parse a single tsc output line into a Diagnostic. */
function parseTscLine(line: string): Diagnostic | null {
  // Format: path/to/file.ts(line,col): error TS1234: message
  const match = line.match(/^(.+?)\((\d+),(\d+)\):\s*(error|warning)\s*(TS\d+):\s*(.+)$/)
  if (!match) return null
  return {
    filePath: match[1],
    line: parseInt(match[2], 10),
    column: parseInt(match[3], 10),
    severity: match[4] === 'error' ? 'error' : 'warning',
    message: match[6],
    code: match[5],
    source: 'tsc',
  }
}

/** Run a shell command and return stdout+stderr combined. */
function runCommand(command: string, opts: { cwd: string; timeout: number }): Promise<string> {
  return new Promise((resolve, reject) => {
    import('node:child_process').then(({ exec }) => {
      exec(command, opts, (err, stdout, stderr) => {
        // tsc exits with code 1 on errors — that's expected, not a real failure
        const combined = stdout.toString() + stderr.toString()
        resolve(combined)
      })
    }).catch(reject)
  })
}

/** Heuristic checks for common code issues when no compiler/linter diagnostics are available. */
async function runHeuristicDiagnostics(): Promise<Diagnostic[]> {
  const diagnostics: Diagnostic[] = []
  const codeExts = new Set(['ts', 'tsx', 'js', 'jsx', 'py', 'go', 'rs', 'java', 'c', 'cpp', 'rb', 'php', 'swift', 'kt'])

  async function checkDir(absDir: string, relDir: string) {
    const entries = await fs.readdir(absDir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (IGNORED.has(entry.name)) continue
      const childRel = relDir ? `${relDir}/${entry.name}` : entry.name
      const childAbs = path.join(absDir, entry.name)
      if (entry.isDirectory()) {
        await checkDir(childAbs, childRel)
      } else if (entry.isFile() && codeExts.has(entry.name.split('.').pop()?.toLowerCase() ?? '')) {
        try {
          const ext = entry.name.split('.').pop()?.toLowerCase() ?? ''
          const content = await fs.readFile(childAbs, 'utf8')
          const lines = content.split('\n')
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i]
            const marker = extractTaskMarker(line, ext)
            if (marker) {
              diagnostics.push({
                filePath: childRel,
                line: i + 1,
                column: marker.column,
                severity: 'warning',
                message: marker.message,
                code: marker.code,
                source: 'heuristic',
              })
              continue
            }

            const trailing = line.match(/[ \t]+$/)
            if (trailing) {
              diagnostics.push({
                filePath: childRel,
                line: i + 1,
                column: line.length - trailing[0].length + 1,
                severity: 'warning',
                message: 'Trailing whitespace',
                code: 'no-trailing-spaces',
                source: 'heuristic',
              })
            }
          }
        } catch {
          /* skip */
        }
      }
    }
  }

  await checkDir(WORKSPACE, '')
  // Limit heuristic results to avoid overwhelming
  return diagnostics.slice(0, 200)
}

function extractTaskMarker(
  line: string,
  ext: string,
): { column: number; message: string; code: string } | null {
  const comment = findCommentText(line, ext)
  if (!comment) return null

  const match = comment.text.match(/\b(TODO|FIXME|HACK|XXX)\b(?::|\s+-|\s+|$)(.*)$/i)
  if (!match || match.index === undefined) return null

  const raw = comment.text.slice(match.index).trim()
  const normalized = raw.replace(/\s+/g, ' ')

  // Ignore comments that describe marker syntax rather than an actionable task.
  if (/^(TODO|FIXME|HACK|XXX)(\s*[\/|,]\s*(TODO|FIXME|HACK|XXX))*\s*$/i.test(normalized)) {
    return null
  }
  if (/^(TODO|FIXME|HACK|XXX)\b\s*(marker|markers|diagnostic|diagnostics|rule|rules)\b/i.test(normalized)) {
    return null
  }

  return {
    column: comment.column + match.index,
    message: normalized || 'Task marker',
    code: match[1].toUpperCase(),
  }
}

function findCommentText(line: string, ext: string): { column: number; text: string } | null {
  const trimmedStart = line.trimStart()
  const leadingWhitespace = line.length - trimmedStart.length

  if (trimmedStart.startsWith('*')) {
    return { column: leadingWhitespace + 2, text: trimmedStart.slice(1).trimStart() }
  }

  const tokens = ['//', '/*']
  if (['py', 'rb'].includes(ext)) tokens.push('#')
  if (ext === 'sql') tokens.push('--')

  const found = findFirstCommentToken(line, tokens)
  if (!found) return null

  return {
    column: found.index + found.token.length + 1,
    text: line.slice(found.index + found.token.length).trimStart(),
  }
}

function findFirstCommentToken(line: string, tokens: string[]): { index: number; token: string } | null {
  let quote: '"' | "'" | '`' | null = null
  let escaped = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]

    if (quote) {
      if (escaped) {
        escaped = false
      } else if (ch === '\\') {
        escaped = true
      } else if (ch === quote) {
        quote = null
      }
      continue
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
      continue
    }

    for (const token of tokens) {
      if (line.startsWith(token, i)) return { index: i, token }
    }
  }
  return null
}

// ---------- AI auto-fix for diagnostics ----------
app.post('/api/diagnostics/fix', async (req, res) => {
  try {
    const { diagnostic, content, provider } = req.body as {
      diagnostic: {
        filePath: string
        line: number
        column: number
        severity: string
        message: string
        code?: string
        source: string
      }
      content: string
      provider?: ProviderConfig
    }
    const p = provider ?? { provider: 'demo', model: 'demo' }

    // Extract context: ~20 lines around the diagnostic line
    const lines = content.split('\n')
    const center = Math.max(0, Math.min(diagnostic.line - 1, lines.length - 1))
    const start = Math.max(0, center - 10)
    const end = Math.min(lines.length, center + 11)
    const snippet = lines.slice(start, end).join('\n')
    const marker = `[Line ${diagnostic.line - start + start}] ← here`

    // Demo mode: heuristic fixes for common issues
    if (p.provider === 'demo') {
      const fix = demoFix(diagnostic, content)
      return res.json(fix)
    }

    // Real provider: ask the LLM for a targeted fix
    const sys =
      'You are an expert code linter fixer. The user has a diagnostic error/warning in their code. ' +
      'Fix ONLY the issue described. Return ONLY the COMPLETE corrected file content — ' +
      'no markdown fences, no explanation, no commentary. ' +
      'Preserve all other code exactly. Make the minimal change needed to resolve the issue.'

    const user =
      `File: ${diagnostic.filePath}\n` +
      `Language: ${diagnostic.source === 'eslint' ? 'JavaScript/TypeScript' : 'TypeScript'}\n` +
      `Diagnostic (${diagnostic.source}${diagnostic.code ? ` ${diagnostic.code}` : ''}): ${diagnostic.severity.toUpperCase()} at line ${diagnostic.line}, col ${diagnostic.column}\n` +
      `Message: ${diagnostic.message}\n\n` +
      `Code around line ${diagnostic.line}:\n\`\`\`\n${snippet}\n\`\`\`\n${marker}\n\n` +
      `FULL FILE CONTENT:\n\`\`\`\n${content}\n\`\`\`\n\n` +
      `Return the complete corrected file:`

    let fixed = await llmComplete(p, sys, user)
    fixed = fixed.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim()
    const changed = fixed !== content

    res.json({
      fixedContent: fixed,
      explanation: changed
        ? `Fixed ${diagnostic.code ?? diagnostic.source} issue: ${diagnostic.message}`
        : 'No automatic fix is available for this diagnostic.',
      changed,
      kind: changed ? 'code-change' : 'unavailable',
    })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

type DiagnosticFixKind = 'code-change' | 'manual-review' | 'unavailable'

interface DiagnosticFixResponse {
  fixedContent: string
  explanation: string
  changed: boolean
  kind: DiagnosticFixKind
}

/** Demo heuristic fixes for common diagnostic issues. */
function demoFix(
  diagnostic: { filePath: string; line: number; message: string; code?: string; source: string },
  content: string,
): DiagnosticFixResponse {
  const lines = content.split('\n')
  const lineIdx = diagnostic.line - 1
  if (lineIdx < 0 || lineIdx >= lines.length) {
    return {
      fixedContent: content,
      explanation: 'Could not locate the problematic line.',
      changed: false,
      kind: 'unavailable',
    }
  }
  const line = lines[lineIdx]
  const msg = diagnostic.message.toLowerCase()

  // Fix: 'X' is declared but never read → prefix with _
  if (msg.includes('declared but never read') || msg.includes('is declared but its value')) {
    const m = line.match(/(const|let|var)\s+(\w+)/)
    if (m) {
      lines[lineIdx] = line.replace(`${m[1]} ${m[2]}`, `${m[1]} _${m[2]}`)
      return codeChange(lines.join('\n'), `Renamed unused variable to _${m[2]}`)
    }
  }

  // Undefined names need user intent; do not create placeholder code.
  if (msg.includes('cannot find name')) {
    const m = line.match(/'(\w+)'/)
    if (m) {
      return {
        fixedContent: content,
        explanation: `No automatic fix is available for undefined '${m[1]}'. Define or import it manually.`,
        changed: false,
        kind: 'manual-review',
      }
    }
  }

  // Fix: missing semicolon (eslint semi)
  if (msg.includes('missing semicolon') || diagnostic.code === 'semi') {
    if (!line.trimEnd().endsWith(';') && !line.trim().endsWith('{') && !line.trim().endsWith('}')) {
      lines[lineIdx] = line.replace(/(\s*)$/, ';$1')
      return codeChange(lines.join('\n'), 'Added missing semicolon')
    }
  }

  // Fix: expected ',' but got → try inserting comma
  if (msg.includes("expected ','") || msg.includes('missing comma')) {
    const trimmed = line.trimEnd()
    if (!trimmed.endsWith(',')) {
      lines[lineIdx] = line.replace(/(\s*)$/, ',$1')
      return codeChange(lines.join('\n'), 'Added missing comma')
    }
  }

  // Fix: replace single quotes with double (quotes rule)
  if (diagnostic.code === 'quotes' || msg.includes('use double quotes')) {
    lines[lineIdx] = line.replace(/'([^']*)'/g, '"$1"')
    return codeChange(lines.join('\n'), 'Converted single quotes to double quotes')
  }

  // Fix: trailing whitespace
  if (msg.includes('trailing whitespace') || diagnostic.code === 'no-trailing-spaces') {
    lines[lineIdx] = line.replace(/\s+$/, '')
    return codeChange(lines.join('\n'), 'Removed trailing whitespace')
  }

  // Fix: task markers cannot be resolved automatically, so acknowledge them.
  if (diagnostic.source === 'heuristic' && /\b(TODO|FIXME|HACK|XXX)\b/i.test(msg)) {
    return {
      fixedContent: content,
      explanation: 'This task marker needs manual review. No code change was generated.',
      changed: false,
      kind: 'manual-review',
    }
  }

  return {
    fixedContent: content,
    explanation: 'No automatic fix is available for this diagnostic.',
    changed: false,
    kind: 'unavailable',
  }
}

function codeChange(fixedContent: string, explanation: string): DiagnosticFixResponse {
  return { fixedContent, explanation, changed: true, kind: 'code-change' }
}

// ---------- Git / source control ----------
interface GitFileChange {
  path: string
  /** M = modified, A = added, D = deleted, R = renamed, U = untracked, C = conflict */
  status: 'M' | 'A' | 'D' | 'R' | 'U' | 'C'
  /** true if staged in the index */
  staged: boolean
  /** old path for renames */
  oldPath?: string
}

interface GitStatus {
  initialized: boolean
  branch: string | null
  ahead: number
  behind: number
  changes: GitFileChange[]
  head: { hash: string; message: string; author: string; date: string } | null
}

/**
 * Run a git command and return trimmed stdout. Returns empty string on failure
 * (e.g. not a git repo).
 */
async function git(args: string[]): Promise<string> {
  const { execFile } = await import('node:child_process')
  return new Promise((resolve) => {
    execFile(
      'git',
      args,
      { cwd: WORKSPACE, maxBuffer: 5 * 1024 * 1024, timeout: GIT_TIMEOUT_MS },
      (err, stdout) => {
        if (err) resolve('')
        else resolve(stdout.toString().trim())
      },
    )
  })
}

/** Map a file path to a Monaco/monaco-editor language id for the diff view. */
function inferLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    py: 'python',
    go: 'go',
    rs: 'rust',
    rb: 'ruby',
    php: 'php',
    java: 'java',
    kt: 'kotlin',
    c: 'c',
    h: 'c',
    cpp: 'cpp',
    cc: 'cpp',
    hpp: 'cpp',
    cs: 'csharp',
    swift: 'swift',
    json: 'json',
    yml: 'yaml',
    yaml: 'yaml',
    toml: 'ini',
    ini: 'ini',
    md: 'markdown',
    markdown: 'markdown',
    html: 'html',
    htm: 'html',
    css: 'css',
    scss: 'scss',
    less: 'less',
    sh: 'shell',
    bash: 'shell',
    zsh: 'shell',
    sql: 'sql',
    xml: 'xml',
    svg: 'xml',
    dockerfile: 'dockerfile',
  }
  // Handle extensionless files like "Dockerfile" or "Makefile"
  const base = filePath.split('/').pop() ?? ''
  if (base.toLowerCase() === 'dockerfile') return 'dockerfile'
  if (base.toLowerCase() === 'makefile') return 'makefile'
  return map[ext] ?? 'plaintext'
}

app.get('/api/git/status', async (_req, res) => {
  try {
    const inRepo = await git(['rev-parse', '--is-inside-work-tree'])
    if (inRepo !== 'true') {
      const result: GitStatus = {
        initialized: false,
        branch: null,
        ahead: 0,
        behind: 0,
        changes: [],
        head: null,
      }
      return res.json(result)
    }

    const branch = (await git(['rev-parse', '--abbrev-ref', 'HEAD'])) || null
    // --untracked-files=all expands untracked directories into their
    // individual files so the count matches what VS Code / `git status -u`
    // show. Without this, a newly-created directory collapses to a single
    // entry regardless of how many files are inside it.
    const porcelain = await git(['status', '--porcelain=v1', '-b', '--renames', '--untracked-files=all'])

    // Parse "## main...origin/main [ahead 2]" header
    let ahead = 0
    let behind = 0
    const changes: GitFileChange[] = []
    for (const line of porcelain.split('\n').filter(Boolean)) {
      if (line.startsWith('##')) {
        const aheadM = line.match(/ahead (\d+)/)
        const behindM = line.match(/behind (\d+)/)
        if (aheadM) ahead = Number(aheadM[1])
        if (behindM) behind = Number(behindM[1])
        continue
      }
      // XY filename — X = index status, Y = worktree status
      const x = line[0]
      const y = line[1]
      let rest = line.slice(3)
      const isRenamed = x === 'R' || y === 'R'
      let oldPath: string | undefined
      let filePath = rest
      if (isRenamed && rest.includes(' -> ')) {
        const [o, n] = rest.split(' -> ')
        oldPath = o
        filePath = n
      }
      // staged if index status is non-empty and not untracked-space
      const staged = x !== ' ' && x !== '?'
      const statusChar = x !== ' ' && x !== '?' ? x : y === 'D' ? 'D' : y === 'A' || y === '?' ? 'U' : y
      changes.push({
        path: filePath,
        status: statusChar as GitFileChange['status'],
        staged,
        oldPath,
      })
    }

    // HEAD commit
    let head: GitStatus['head'] = null
    // Use ASCII unit separator (\x1f) as delimiter to avoid collisions with `|` in commit messages
    const headRaw = await git(['log', '-1', `--pretty=format:%H\x1f%s\x1f%an\x1f%ci`])
    if (headRaw) {
      const [hash, message, author, date] = headRaw.split('\x1f')
      head = { hash: hash.slice(0, 7), message, author, date }
    }

    const result: GitStatus = {
      initialized: true,
      branch,
      ahead,
      behind,
      changes,
      head,
    }
    res.json(result)
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

app.get('/api/git/diff', async (req, res) => {
  try {
    const filePath = String(req.query.path ?? '')
    const staged = req.query.staged === 'true'
    const args = ['diff', '--no-color']
    if (staged) args.push('--cached')
    if (filePath) args.push('--', filePath)
    const diff = await git(args)
    res.json({ diff })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

/**
 * Side-by-side diff content for the Monaco DiffEditor.
 * Returns { original, modified, language, path } where:
 *  - staged:    original = HEAD version,  modified = index version
 *  - unstaged:  original = index version, modified = working tree (disk)
 * Missing refs (new/deleted files) gracefully resolve to ''.
 */
app.get('/api/git/diff-content', async (req, res) => {
  try {
    const filePath = String(req.query.path ?? '')
    const staged = req.query.staged === 'true'
    if (!filePath) return res.status(400).json({ error: 'path required' })
    // Validate path stays within workspace (throws if it escapes)
    const abs = safeJoin(filePath)

    // git show returns '' (via the git() helper) when the ref doesn't exist.
    const show = async (ref: string): Promise<string> =>
      git(['show', `${ref}:${filePath}`])

    let original = ''
    let modified = ''
    if (staged) {
      original = await show('HEAD')
      modified = await show(':')
    } else {
      original = await show(':')
      try {
        modified = await fs.readFile(abs, 'utf8')
      } catch {
        modified = '' // file may be deleted from the working tree
      }
    }

    res.json({ original, modified, language: inferLanguage(filePath), path: filePath })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

app.post('/api/git/stage', async (req, res) => {
  try {
    const { paths } = req.body as { paths: string[] }
    if (!paths || paths.length === 0) return res.json({ ok: true })
    // Validate paths stay within workspace
    for (const p of paths) safeJoin(p)
    await git(['add', '--', ...paths])
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

app.post('/api/git/unstage', async (req, res) => {
  try {
    const { paths } = req.body as { paths: string[] }
    if (!paths || paths.length === 0) return res.json({ ok: true })
    for (const p of paths) safeJoin(p)
    // Use reset HEAD to unstage
    await git(['reset', 'HEAD', '--', ...paths])
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

app.post('/api/git/commit', async (req, res) => {
  try {
    const { message } = req.body as { message: string }
    if (!message || !message.trim()) {
      return res.status(400).json({ error: 'Commit message required' })
    }
    const out = await git(['commit', '-m', message.trim()])
    res.json({ ok: true, output: out })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

app.get('/api/git/log', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 30, 100)
    const raw = await git([
      'log',
      `-${limit}`,
      `--pretty=format:%H\x1f%h\x1f%s\x1f%an\x1f%ar`,
    ])
    if (!raw) return res.json({ commits: [] })
    const commits = raw.split('\n').map((line) => {
      const [hash, short, message, author, date] = line.split('\x1f')
      return { hash, short, message, author, date }
    })
    res.json({ commits })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

// ---------- Suggestion cache (content-hash keyed, disk-persisted) ----------
/**
 * Each unique (file path + content + model) triplet costs exactly one LLM
 * call across the lifetime of the project, regardless of how many tabs /
 * sessions / dev-server-restarts pass through. Cache key is sha1 of those
 * three so editing the file or switching models invalidates naturally.
 *
 * Persisted to .newton-cache/suggestions.json so the cache survives
 * restarts. Capped at 1000 entries (LRU by timestamp) so the file can't
 * grow without bound on huge projects.
 */
interface CachedSuggestion {
  path: string
  model: string
  ts: number
  suggestions: Array<{ title: string; reason: string; kind: string }>
}
const SUGGESTIONS_CACHE_FILE = path.join(WORKSPACE, '.newton-cache', 'suggestions.json')
const SUGGESTIONS_CACHE_LIMIT = 1000
let suggestionsCache: Record<string, CachedSuggestion> = {}
let suggestionsCacheLoaded = false
let suggestionsSaveTimer: NodeJS.Timeout | null = null

async function loadSuggestionsCache(): Promise<void> {
  if (suggestionsCacheLoaded) return
  suggestionsCacheLoaded = true
  try {
    const raw = await fs.readFile(SUGGESTIONS_CACHE_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    if (parsed?.version === 1 && parsed.entries && typeof parsed.entries === 'object') {
      suggestionsCache = parsed.entries
    }
  } catch { /* no cache yet — first run */ }
}

function scheduleSuggestionsCacheSave(): void {
  if (suggestionsSaveTimer) clearTimeout(suggestionsSaveTimer)
  suggestionsSaveTimer = setTimeout(async () => {
    try {
      // LRU prune to the most recent N entries before writing.
      const entries = Object.entries(suggestionsCache)
      if (entries.length > SUGGESTIONS_CACHE_LIMIT) {
        entries.sort(([, a], [, b]) => b.ts - a.ts)
        suggestionsCache = Object.fromEntries(entries.slice(0, SUGGESTIONS_CACHE_LIMIT))
      }
      await fs.mkdir(path.dirname(SUGGESTIONS_CACHE_FILE), { recursive: true })
      await fs.writeFile(
        SUGGESTIONS_CACHE_FILE,
        JSON.stringify({ version: 1, entries: suggestionsCache }, null, 2),
        'utf8',
      )
    } catch { /* cache is best-effort */ }
  }, 800)
}

function suggestionCacheKey(filePath: string, content: string, modelId: string): string {
  const h = crypto.createHash('sha1')
  h.update(filePath); h.update('\0')
  h.update(content);  h.update('\0')
  h.update(modelId)
  return h.digest('hex')
}

/**
 * Per-file "what could I do here?" suggestions. Used by the constellation's
 * Node Details drawer. Asks the LLM (or a demo heuristic) for 3–5 short,
 * actionable items keyed to what's actually in this file.
 *
 * Returns: { suggestions: [{ title, reason, kind }], cached: boolean }
 */
app.post('/api/node/suggestions', async (req, res) => {
  try {
    const { path: rel, provider } = req.body as { path: string; provider?: ProviderConfig }
    if (!rel || !rel.trim()) return res.status(400).json({ error: 'path required' })
    const abs = safeJoin(rel)
    const content = await fs.readFile(abs, 'utf8')

    const p = provider ?? { provider: 'demo', model: 'demo' }
    if (p.provider === 'demo') {
      // Demo heuristics are deterministic from content alone — no point
      // hitting the disk cache; just compute.
      return res.json({ suggestions: demoSuggestions(rel, content), cached: false })
    }

    // ----- Cache lookup: sha1(path + content + model) -----
    await loadSuggestionsCache()
    const modelId = `${p.provider}:${p.model ?? 'default'}`
    const cacheKey = suggestionCacheKey(rel, content, modelId)
    const hit = suggestionsCache[cacheKey]
    if (hit) {
      // Refresh the LRU timestamp so this entry sticks around.
      hit.ts = Date.now()
      scheduleSuggestionsCacheSave()
      return res.json({ suggestions: hit.suggestions, cached: true })
    }

    // Real provider: pull lightweight graph context (callers + deps) so
    // the LLM can suggest things like "extract this into a hook — it's
    // imported by 14 callers".
    let inbound: string[] = []
    let outbound: string[] = []
    try {
      const builder = getGraphBuilder(WORKSPACE)
      await builder.build()
      const g = builder.getGraph()
      if (g) {
        inbound = (g.reverseEdges?.[rel] ?? []).slice(0, 12)
        outbound = (g.nodes[rel]?.imports ?? []).slice(0, 12)
      }
    } catch { /* graph is best-effort */ }

    const sys = [
      'You are reviewing a single file in a codebase. Suggest 3 to 5 short, actionable',
      'improvements specific to THIS file — what you can see in it. Avoid generic advice.',
      '',
      'Each suggestion MUST:',
      '  - Be achievable as a single focused mission (one prompt the user could send back to you).',
      '  - Reference something concrete in the file: a function name, a missing thing, a pattern.',
      '  - Include a one-line reason, ≤ 18 words.',
      '  - Use the most apt `kind` from: test, refactor, docs, perf, security, cleanup, review.',
      '',
      'Respond with ONLY valid JSON (no prose, no markdown fences):',
      '{"suggestions":[{"title": string, "reason": string, "kind":"test|refactor|docs|perf|security|cleanup|review"}]}',
    ].join('\n')

    const user =
      `File: ${rel}\nLines: ${content.split('\n').length}\n` +
      (inbound.length ? `Imported by (callers): ${inbound.join(', ')}\n` : '') +
      (outbound.length ? `Imports: ${outbound.join(', ')}\n` : '') +
      `\nContent:\n\`\`\`\n${content.slice(0, 12_000)}\n\`\`\``

    let raw: string
    try {
      raw = await llmComplete(p, sys, user, { maxTokens: 1200, jsonMode: true })
    } catch (e) {
      return res.status(502).json({ error: (e as Error).message, suggestions: [] })
    }

    // Parse JSON (with the fence-tolerant helper used elsewhere).
    let parsed: any = null
    try { parsed = JSON.parse(raw) } catch {
      const m = raw.match(/\{[\s\S]*\}/)
      if (m) { try { parsed = JSON.parse(m[0]) } catch { /* give up */ } }
    }
    const suggestions = Array.isArray(parsed?.suggestions)
      ? parsed.suggestions
          .filter((s: any) => s && typeof s.title === 'string')
          .slice(0, 6)
          .map((s: any) => ({
            title: String(s.title),
            reason: typeof s.reason === 'string' ? s.reason : '',
            kind: ['test','refactor','docs','perf','security','cleanup','review'].includes(s.kind)
              ? s.kind : 'review',
          }))
      : []

    // Persist for next time — only cache non-empty results, otherwise a
    // transient LLM stumble would lock in "no suggestions" until the file
    // is edited.
    if (suggestions.length > 0) {
      suggestionsCache[cacheKey] = {
        path: rel,
        model: modelId,
        ts: Date.now(),
        suggestions,
      }
      scheduleSuggestionsCacheSave()
    }
    res.json({ suggestions, cached: false })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message, suggestions: [] })
  }
})

/** Heuristic suggestions when the user is on demo mode (no LLM key). */
function demoSuggestions(rel: string, content: string): Array<{ title: string; reason: string; kind: string }> {
  const out: Array<{ title: string; reason: string; kind: string }> = []
  const lines = content.split('\n').length
  const hasTodo = /TODO|FIXME|XXX/i.test(content)
  const hasAnyType = /:\s*any\b/.test(content)
  const isTest = /\.test\.|\.spec\.|^tests\//.test(rel)
  if (!isTest && lines > 30) {
    out.push({ title: `Add unit tests for ${rel.split('/').pop()}`, reason: 'No tests detected for this module.', kind: 'test' })
  }
  if (lines > 400) {
    out.push({ title: 'Split this file into smaller modules', reason: `${lines} lines — past the readability cliff.`, kind: 'refactor' })
  }
  if (hasAnyType) {
    out.push({ title: 'Replace `any` types with concrete shapes', reason: 'Loses type safety where it appears.', kind: 'refactor' })
  }
  if (hasTodo) {
    out.push({ title: 'Resolve open TODO/FIXME markers', reason: 'Comments mark unfinished work.', kind: 'cleanup' })
  }
  if (!/\/\*\*|\/\/\s*[A-Z]/.test(content.slice(0, 400))) {
    out.push({ title: 'Add a top-of-file overview comment', reason: 'No documentation block at the top.', kind: 'docs' })
  }
  if (out.length === 0) {
    out.push({ title: `Review ${rel.split('/').pop()}`, reason: 'Generic review — connect an LLM provider for richer suggestions.', kind: 'review' })
  }
  return out.slice(0, 5)
}

/**
 * Recent commits touching a specific file. Used by the constellation's
 * Node Details drawer. Path is validated via safeJoin to make sure it's
 * inside the workspace before we pass it to git.
 */
app.get('/api/git/file-log', async (req, res) => {
  try {
    const rel = String(req.query.path ?? '').trim()
    if (!rel) return res.status(400).json({ error: 'path required' })
    // Validate path stays within workspace (throws if it escapes)
    safeJoin(rel)
    const limit = Math.min(Number(req.query.limit) || 5, 50)
    const raw = await git([
      'log',
      `-${limit}`,
      `--pretty=format:%H\x1f%h\x1f%s\x1f%an\x1f%ar`,
      '--',
      rel,
    ])
    if (!raw) return res.json({ commits: [] })
    const commits = raw.split('\n').map((line) => {
      const [hash, short, message, author, date] = line.split('\x1f')
      return { hash, short, message, author, date }
    })
    res.json({ commits })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

/**
 * Per-file commit-frequency stats — drives the Quality & Risk section of
 * the Node Details drawer. Returns commit counts over a few rolling
 * windows so we can render "change frequency" + "days since last touch"
 * without the client doing date math on the full log.
 */
app.get('/api/git/file-stats', async (req, res) => {
  try {
    const rel = String(req.query.path ?? '').trim()
    if (!rel) return res.status(400).json({ error: 'path required' })
    safeJoin(rel)
    // %ci → committer date in ISO format. One line per commit.
    const raw = await git(['log', '--pretty=format:%ci', '--', rel])
    if (!raw) {
      return res.json({
        totalCommits: 0, last7Days: 0, last30Days: 0, last90Days: 0,
        daysSinceLastTouch: null, distinctAuthors: 0,
      })
    }
    const times = raw.split('\n').filter(Boolean)
      .map((s) => new Date(s).getTime())
      .filter((t) => Number.isFinite(t))
    const now = Date.now()
    const ms = 86_400_000
    const within = (days: number) => times.filter((t) => now - t < days * ms).length
    // Distinct authors — fetch in a second cheap call (could combine but
    // the format separator gets gnarly, and these files rarely have 1000+
    // commits so a second `git log` is fine).
    const authorsRaw = await git(['log', '--pretty=format:%an', '--', rel])
    const authors = new Set(authorsRaw.split('\n').filter(Boolean))
    res.json({
      totalCommits: times.length,
      last7Days: within(7),
      last30Days: within(30),
      last90Days: within(90),
      daysSinceLastTouch: times.length > 0 ? Math.floor((now - times[0]) / ms) : null,
      distinctAuthors: authors.size,
    })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

/**
 * Top-N owners of a file by commit count. Used by the Impact Report's right
 * rail to render the "Owners" panel (avatars + names).
 *
 * Returns { name, email, commits } per author. We compute Gravatar URLs
 * client-side from email — server returns the email so the client can hash.
 */
app.get('/api/git/file-owners', async (req, res) => {
  try {
    const rel = String(req.query.path ?? '').trim()
    const limit = Math.min(10, Math.max(1, Number(req.query.limit ?? 3)))
    if (!rel) return res.status(400).json({ error: 'path required' })
    safeJoin(rel)
    // %an = author name, %ae = author email. Format: name<TAB>email per commit.
    const raw = await git(['log', '--pretty=format:%an\t%ae', '--', rel])
    if (!raw) return res.json({ owners: [], totalCommits: 0 })
    const counts = new Map<string, { name: string; email: string; commits: number }>()
    for (const line of raw.split('\n')) {
      if (!line) continue
      const [name, email] = line.split('\t')
      const key = (email || name).toLowerCase()
      const cur = counts.get(key)
      if (cur) cur.commits++
      else counts.set(key, { name: name || email, email: email || '', commits: 1 })
    }
    const owners = [...counts.values()]
      .sort((a, b) => b.commits - a.commits)
      .slice(0, limit)
    const totalCommits = [...counts.values()].reduce((s, o) => s + o.commits, 0)
    res.json({ owners, totalCommits })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

app.post('/api/git/init', async (_req, res) => {
  try {
    await git(['init'])
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

// ---------- AI SCM: commit suggestion ----------
app.post('/api/git/suggest-commit', async (req, res) => {
  try {
    const { diff, provider: p, forceDemo } = req.body as {
      diff: string
      provider: ProviderConfig
      forceDemo?: boolean
    }
    if (!diff || !diff.trim()) {
      return res.json({ message: 'chore: update files', note: 'No staged changes to analyze.' })
    }

    // Demo heuristic
    if (p.provider === 'demo' || forceDemo) {
      const message = demoCommitMessage(diff)
      return res.json({ message, note: 'Demo heuristic commit message.' })
    }

    const system =
      'You are an expert at writing concise conventional-commit messages. ' +
      'Analyze the diff and return ONLY the commit message (no markdown, no code fence). ' +
      'Format: type(scope): short description. Types: feat, fix, refactor, docs, test, chore, perf, style, ci, build.'
    const user = `Here is the staged diff. Write a single conventional-commit message.\n\n\`\`\`diff\n${diff.slice(0, DIFF_SLICE_COMMIT_MSG)}\n\`\`\``

    const message = await llmComplete(p, system, user)
    res.json({ message: message.trim(), note: 'AI-generated commit message.' })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

// ---------- AI SCM: explain diff ----------
app.post('/api/git/explain-diff', async (req, res) => {
  try {
    const { diff, path: filePath, provider: p, forceDemo } = req.body as {
      diff: string
      path?: string
      provider: ProviderConfig
      forceDemo?: boolean
    }
    if (!diff || !diff.trim()) {
      return res.json({ explanation: 'No changes to explain.' })
    }

    // Demo heuristic
    if (p.provider === 'demo' || forceDemo) {
      return res.json({ explanation: demoExplainDiff(diff, filePath) })
    }

    const system =
      'You are a senior code reviewer. Explain what the diff does in plain, concise language. ' +
      'Use bullet points. Note the key changes, any potential risks, and the intent behind the change.'
    const user = `Explain this diff${filePath ? ` for \`${filePath}\`` : ''}:\n\n\`\`\`diff\n${diff.slice(0, DIFF_SLICE_EXPLAIN)}\n\`\`\``

    const explanation = await llmComplete(p, system, user)
    res.json({ explanation: explanation.trim() })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

// ---------- AI SCM: code review ----------
app.post('/api/git/review', async (req, res) => {
  try {
    const { diff, files, provider: p, forceDemo } = req.body as {
      diff: string
      files: string[]
      provider: ProviderConfig
      forceDemo?: boolean
    }
    if (!diff || !diff.trim()) {
      return res.json({ findings: [], summary: 'No changes to review.', score: 100 })
    }

    // Demo heuristic
    if (p.provider === 'demo' || forceDemo) {
      const result = demoCodeReview(diff, files)
      return res.json(result)
    }

    const system =
      'You are a principal engineer doing a code review. ' +
      'Analyze the diff for bugs, security issues, performance problems, and maintainability concerns. ' +
      'Respond as STRICT JSON only (no markdown, no code fence). Schema:\n' +
      '{\n  "findings": [\n    {\n      "severity": "critical"|"warning"|"info"|"praise",\n' +
      '      "category": "bug"|"security"|"performance"|"maintainability"|"style",\n' +
      '      "message": "string",\n      "file": "optional string",\n      "line": optional number\n    }\n  ],\n' +
      '  "summary": "string",\n  "score": number\n}'
    const user =
      `Review this diff${files.length ? ` (files: ${files.join(', ')})` : ''}:\n\n\`\`\`diff\n${diff.slice(0, DIFF_SLICE_REVIEW)}\n\`\`\`\n\n` +
      `Respond as JSON only.`

    const raw = await llmComplete(p, system, user)

    // Try to parse JSON from the response
    let parsed: any
    try {
      // Strip markdown code fences if present
      const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
      parsed = JSON.parse(cleaned)
    } catch {
      // If parsing fails, return the raw text as a single finding
      return res.json({
        findings: [{ severity: 'info', category: 'maintainability', message: raw.slice(0, 500) }],
        summary: 'Review completed (unstructured).',
        score: 80,
      })
    }

    res.json({
      findings: parsed.findings ?? [],
      summary: parsed.summary ?? 'Review complete.',
      score: typeof parsed.score === 'number' ? parsed.score : 80,
    })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

// ---------- workspace memory ----------
// NOTE: the client (src/store.ts) reads the JSON body directly as the
// WorkspaceMemory object (e.g. `set({ memory: await r.json() })`), so these
// handlers return `mem` directly — NOT wrapped in `{ memory: mem }`. The
// welcome endpoint is read via `wd.digest`, so it returns `{ digest: ... }`.
app.get('/api/memory', async (_req, res) => {
  try {
    const mem = await getOrCreateMemory(WORKSPACE)
    res.json(mem)
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

app.get('/api/memory/welcome', async (_req, res) => {
  try {
    const mem = await getOrCreateMemory(WORKSPACE)
    res.json({ digest: buildWelcomeDigest(mem) })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

app.post('/api/memory/refresh', async (_req, res) => {
  try {
    const mem = await refreshMemory(WORKSPACE)
    res.json(mem)
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

app.post('/api/memory/entry', async (req, res) => {
  try {
    const { type, text, source } = req.body as {
      type: MemoryEntry['type']
      text: string
      source?: string
    }
    if (!type || !text || !text.trim()) {
      return res.status(400).json({ error: 'type and text are required' })
    }
    const mem = await memAddEntry(WORKSPACE, type, text, source)
    res.json(mem)
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

app.delete('/api/memory/entry/:id', async (req, res) => {
  try {
    const mem = await memRemoveEntry(WORKSPACE, req.params.id)
    res.json(mem)
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

/** Demo heuristic: generate a conventional commit message from a diff. */
function demoCommitMessage(diff: string): string {
  const added = (diff.match(/^\+[^+]/gm) || []).length
  const removed = (diff.match(/^-[^-]/gm) || []).length
  const files = (diff.match(/^diff --git b\//gm) || []).length || 1
  const fileNames = (diff.match(/\+\+\+ b\/(.+)/g) || [])
    .map((s) => s.replace('+++ b/', ''))
    .slice(0, 3)

  // Detect type from file patterns
  const allFiles = fileNames.join(' ')
  let type = 'refactor'
  if (/\.md$|README|CHANGELOG|docs\//.test(allFiles)) type = 'docs'
  else if (/test|spec|\.test\.|\.spec\./.test(allFiles)) type = 'test'
  else if (/package\.json|package-lock|Cargo\.toml|go\.mod|Dockerfile|\.ya?ml/.test(allFiles)) type = 'chore'
  else if (/\.css|\.scss|\.less/.test(allFiles)) type = 'style'
  else if (added > removed * 2) type = 'feat'
  else if (removed > added * 2) type = 'fix'

  const scope = fileNames[0]?.split('/')[0] ?? ''
  const desc =
    files === 1 && fileNames[0]
      ? `update ${fileNames[0]}`
      : `${added} additions, ${removed} deletions across ${files} file${files > 1 ? 's' : ''}`

  return `${type}${scope ? `(${scope})` : ''}: ${desc}`
}

/** Demo heuristic: explain a diff in plain language. */
function demoExplainDiff(diff: string, filePath?: string): string {
  const added = (diff.match(/^\+[^+]/gm) || []).length
  const removed = (diff.match(/^-[^-]/gm) || []).length
  const fileNames = (diff.match(/\+\+\+ b\/(.+)/g) || [])
    .map((s) => s.replace('+++ b/', ''))
    .slice(0, 5)

  const parts: string[] = []
  parts.push(`**Summary:** This change ${added > removed ? 'adds' : 'modifies'} code in ${fileNames.length || 'the'} file(s).`)
  parts.push('')
  parts.push(`**Changes:**`)
  parts.push(`- **+${added} lines added**, **-${removed} lines removed**`)
  if (fileNames.length) {
    parts.push(`- **Files affected:** ${fileNames.join(', ')}`)
  }

  // Look for common patterns
  if (/async|await/.test(diff)) parts.push('- Involves **asynchronous** operations')
  if (/import\s+|require\(/.test(diff)) parts.push('- Updates **imports / dependencies**')
  if (/function|=>|def /.test(diff)) parts.push('- Modifies **function definitions**')
  if (/TODO|FIXME|HACK/.test(diff)) parts.push('- Contains **TODO/FIXME** markers')
  if (/password|secret|token|key/i.test(diff)) parts.push('- ⚠️ References **sensitive data** — review carefully')

  parts.push('')
  parts.push(`> 💡 *Connect a real AI provider in Settings for a detailed, intelligent explanation.*`)
  return parts.join('\n')
}

/** Demo heuristic: basic code review. */
function demoCodeReview(diff: string, files: string[]): import('../shared/types.js').CodeReviewResponse {
  const findings: import('../shared/types.js').CodeReviewFinding[] = []
  const lines = diff.split('\n')

  for (const line of lines) {
    if (!line.startsWith('+') || line.startsWith('+++')) continue

    // Security checks
    if (/password|secret|api[_-]?key|token/i.test(line) && /=|:/.test(line)) {
      findings.push({
        severity: 'critical',
        category: 'security',
        message: 'Possible hardcoded credential detected. Never commit secrets — use environment variables.',
      })
    }
    if (/eval\(/.test(line)) {
      findings.push({
        severity: 'critical',
        category: 'security',
        message: 'Use of `eval()` is dangerous — it can execute arbitrary code.',
      })
    }

    // Bug risk
    if (/console\.log/.test(line)) {
      findings.push({
        severity: 'info',
        category: 'style',
        message: 'Debug `console.log` found — consider removing before production.',
      })
    }
    // Match `==` loose equality but exclude `===`, `<=`, `>=`, `!=`, `==` in `!==`
    if (/(?<![=!<>])==(?!=[=])(?!=)/.test(line)) {
      findings.push({
        severity: 'warning',
        category: 'bug',
        message: 'Loose equality (`==`) can cause unexpected type coercion — use `===`.',
      })
    }
  }

  // Praise for tests
  if (files.some((f) => /test|spec/i.test(f))) {
    findings.push({
      severity: 'praise',
      category: 'maintainability',
      message: 'Great work adding tests! 🎉',
    })
  }

  if (findings.length === 0) {
    findings.push({
      severity: 'praise',
      category: 'maintainability',
      message: 'No obvious issues detected by heuristic review.',
    })
  }

  const criticalCount = findings.filter((f) => f.severity === 'critical').length
  const warningCount = findings.filter((f) => f.severity === 'warning').length
  const score = Math.max(0, 100 - criticalCount * 25 - warningCount * 10)

  return {
    findings,
    summary: `${criticalCount} critical, ${warningCount} warnings, ${findings.length} total findings.`,
    score,
  }
}

// ---------- Repository dependency graph ----------
app.get('/api/graph', async (req, res) => {
  try {
    const force = req.query.force === 'true'
    const builder = getGraphBuilder(WORKSPACE)
    const { parsed, cached, total } = await builder.build(Boolean(force))
    const graph = builder.getGraph()
    if (!graph) return res.status(500).json({ error: 'Graph build failed' })

    // If the graph is huge, slim it down for the API response (drop symbol lists
    // from nodes unless requested — the viz only needs connectivity + labels)
    const includeSymbols = req.query.symbols === 'true'
    const slimNodes: Record<string, any> = {}
    for (const [id, node] of Object.entries(graph.nodes)) {
      slimNodes[id] = {
        id: node.id,
        path: node.path,
        language: node.language,
        lineCount: node.lineCount,
        symbolCount: node.symbols.length,
        imports: node.imports,
        externalDeps: node.externalDeps,
        ...(includeSymbols ? { symbols: node.symbols } : {}),
      }
    }

    res.json({
      ...graph,
      nodes: slimNodes,
      buildStats: { parsed, cached, total },
    })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

app.get('/api/graph/impact', async (req, res) => {
  try {
    const file = String(req.query.file ?? '')
    if (!file) return res.status(400).json({ error: 'file parameter required' })

    const builder = getGraphBuilder(WORKSPACE)
    await builder.build()
    const result = builder.impactAnalysis(file)

    // Enrich impacted file IDs with metadata
    const graph = builder.getGraph()
    const impacted = result.impacted.map((id) => ({
      id,
      path: graph?.nodes[id]?.path ?? id,
      language: graph?.nodes[id]?.language,
    }))

    res.json({ file, ...result, impacted })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

/**
 * Impact Report tiles — endpoints + DB tables for the focused file.
 *
 * - endpoints: HTTP endpoints declared in any of the file's inbound callers
 *   (i.e. routes whose handlers transitively touch this file). Useful for the
 *   "What endpoints will this change affect?" tile.
 * - tables: DB tables referenced by this file OR any of its direct imports.
 *   Useful for the "What tables does this file touch?" tile.
 *
 * Best-effort regex over the workspace; cached in-process with a short TTL.
 */
app.get('/api/file/impact', async (req, res) => {
  try {
    const file = String(req.query.path ?? '').trim()
    if (!file) return res.status(400).json({ error: 'path query param required' })

    const builder = getGraphBuilder(WORKSPACE)
    await builder.build()
    const graph = builder.getGraph()
    if (!graph) return res.status(500).json({ error: 'graph unavailable' })
    if (!graph.nodes[file]) return res.status(404).json({ error: 'file not in graph' })

    const idx = await getImpactIndex(WORKSPACE)

    // Endpoints: collect across the file's inbound callers. The focused file
    // itself counts too — a route handler can call no one and still be one.
    const inbound = graph.reverseEdges?.[file] ?? []
    const endpointSources = new Set<string>([file, ...inbound])
    const endpointSeen = new Set<string>()
    const endpoints: Array<{
      method: string; route: string; file: string; framework: string
    }> = []
    for (const src of endpointSources) {
      const list = idx.endpointsByFile.get(src)
      if (!list) continue
      for (const e of list) {
        const key = `${e.method} ${e.route}`
        if (endpointSeen.has(key)) continue
        endpointSeen.add(key)
        endpoints.push({ method: e.method, route: e.route, file: e.file, framework: e.framework })
      }
    }

    // Tables: this file + its 1-hop import set.
    const directDeps = graph.nodes[file].imports ?? []
    const tableSources = new Set<string>([file, ...directDeps])
    const tableSeen = new Set<string>()
    const tables: Array<{ name: string; kind: string; file: string }> = []
    for (const src of tableSources) {
      const list = idx.tablesByFile.get(src)
      if (!list) continue
      for (const t of list) {
        if (tableSeen.has(t.name)) continue
        tableSeen.add(t.name)
        tables.push({ name: t.name, kind: t.kind, file: t.file })
      }
    }

    res.json({
      path: file,
      endpoints,
      tables,
      stats: {
        endpointSources: endpointSources.size,
        tableSources: tableSources.size,
        builtAt: idx.builtAt,
      },
    })
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

// ---------- RecourseOS: Consequence Engine ----------
/**
 * Assess a plan's risk before execution. Returns a ConsequenceReport that
 * the UI uses to gate behind approval confirmations.
 */
app.post('/api/agent/assess', async (req, res) => {
  try {
    const { steps } = req.body as { steps: import('../shared/types.js').AgentStep[] }
    if (!Array.isArray(steps)) return res.status(400).json({ error: 'steps array required' })

    // Try to enrich blast radius from the repo graph
    let edges: Array<{ source: string; target: string }> | undefined
    try {
      const builder = getGraphBuilder(WORKSPACE)
      await builder.build()
      const graph = builder.getGraph()
      if (graph) edges = graph.edges
    } catch {
      /* graph is optional enrichment */
    }

    const report = assessPlan(steps, { dependencyEdges: edges })
    res.json(report)
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

// ---------- Mission Control ----------
/** Create + plan a new mission. */
app.post('/api/missions', async (req, res) => {
  try {
    const { goal, contextFiles, provider } = req.body as {
      goal: string
      contextFiles?: string[]
      provider?: ProviderConfig
    }
    if (!goal || !goal.trim()) return res.status(400).json({ error: 'goal required' })

    const mission = createMission(goal.trim(), contextFiles ?? [])

    // Plan the mission
    const p = provider ?? { provider: 'demo', model: 'demo' }
    let plan: { steps: import('../shared/types.js').MissionStep[]; outcomes: import('../shared/types.js').MissionOutcome[]; summary: string }

    if (p.provider === 'demo') {
      plan = demoMissionPlan(goal.trim())
    } else {
      // Build planner context in four layers (Cursor/Aider-style):
      //   A. Repo map — every file + top-level symbols, always included.
      //      Cheap orientation: LLM sees what exists even if not attached.
      //   B. Goal-keyword path boost — rank files whose path matches goal
      //      tokens (e.g. goal mentions "settings" → SettingsModal.tsx).
      //   C. Import-graph expansion — files that import or are imported by
      //      the top-K picks come along for the ride (catches integration).
      //   D. Whole-repo mode — if total code is small, just send everything.
      //
      // All four feed into a single byte budget for attached file CONTENTS.
      const stats = index.getStats()
      if (stats.totalFiles === 0 && !stats.indexing) {
        try { await index.index() } catch { /* indexer is best-effort */ }
      }
      const workspaceFiles = Array.from(((index as unknown as { filePaths: Set<string> }).filePaths) ?? []).sort()

      // Layer A: repo map (always included, separate budget from contents).
      const repoMap = index.getRepoMap(25_000)
      // Semantic excerpts retained as a tertiary signal.
      const relevantContext = index.getContextForQuery(goal.trim(), 6000)

      const ATTACHED_CONTENT_BUDGET = 80_000 // ~20k tokens
      const PER_FILE_LIMIT = 50_000
      const attachedContents: Array<{ path: string; content: string }> = []
      const seenPaths = new Set<string>()
      let consumed = 0

      const tryAttach = async (rel: string): Promise<boolean> => {
        if (seenPaths.has(rel)) return false
        if (consumed >= ATTACHED_CONTENT_BUDGET) return false
        try {
          const abs = safeResolve(WORKSPACE, rel)
          const content = await fs.readFile(abs, 'utf8')
          if (content.length > PER_FILE_LIMIT) return false
          if (consumed + content.length > ATTACHED_CONTENT_BUDGET) return false
          attachedContents.push({ path: rel, content })
          seenPaths.add(rel)
          consumed += content.length
          return true
        } catch { return false }
      }

      // Layer D: whole-repo mode. If the workspace's text-file total is
      // small enough to fit, just attach everything and skip ranking.
      const WHOLE_REPO_THRESHOLD = 150_000 // ~37k tokens of code
      let totalSize = 0
      for (const rel of workspaceFiles) {
        try {
          const abs = safeResolve(WORKSPACE, rel)
          const st = await fs.stat(abs)
          if (st.size <= PER_FILE_LIMIT) totalSize += st.size
        } catch { /* skip */ }
        if (totalSize > WHOLE_REPO_THRESHOLD) break
      }
      const wholeRepoMode = totalSize > 0 && totalSize <= WHOLE_REPO_THRESHOLD

      if (wholeRepoMode) {
        for (const rel of workspaceFiles) await tryAttach(rel)
      } else {
        // User-attached focus files come first, always.
        for (const cf of contextFiles ?? []) await tryAttach(cf)

        // Layer B: goal-keyword path-match scoring. Filter out filler verbs
        // and articles ("add", "the", "make") that would otherwise match
        // unrelated paths and dilute the ranking.
        const PATH_STOPWORDS = new Set([
          'add', 'the', 'and', 'for', 'with', 'from', 'into', 'make', 'make',
          'use', 'using', 'new', 'put', 'set', 'get', 'fix', 'all', 'any',
          'this', 'that', 'these', 'those', 'when', 'where', 'what', 'how',
          'support', 'feature', 'mode', 'option',
        ])
        const goalTokens = goal.trim().toLowerCase()
          .replace(/([a-z])([A-Z])/g, '$1 $2')
          .split(/[^a-z0-9]+/)
          .filter((t) => t.length >= 3 && !PATH_STOPWORDS.has(t))
        const goalTokenSet = new Set(goalTokens)
        const pathScores = new Map<string, number>()
        for (const rel of workspaceFiles) {
          const pathTokens = rel.toLowerCase()
            .replace(/([a-z])([A-Z])/g, '$1 $2')
            .split(/[^a-z0-9]+/)
          let score = 0
          for (const t of pathTokens) if (goalTokenSet.has(t)) score++
          if (score > 0) pathScores.set(rel, score)
        }
        const pathRanked = [...pathScores.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([rel]) => rel)

        // Semantic-search hits (existing behavior).
        const hits = index.search(goal.trim(), 30)
        const semanticRanked: string[] = []
        const seenSem = new Set<string>()
        for (const h of hits) {
          const p = h.chunk.filePath
          if (!seenSem.has(p)) { seenSem.add(p); semanticRanked.push(p) }
        }

        // Merge: interleave path-match and semantic rankings so each gets
        // representation in the top-N. Dedupe naturally via tryAttach.
        const merged: string[] = []
        for (let i = 0; i < Math.max(pathRanked.length, semanticRanked.length); i++) {
          if (i < pathRanked.length) merged.push(pathRanked[i])
          if (i < semanticRanked.length) merged.push(semanticRanked[i])
        }
        const initialPicks: string[] = []
        for (const rel of merged) {
          if (await tryAttach(rel)) initialPicks.push(rel)
        }

        // Layer C: import-graph expansion. Pull files that import or are
        // imported by the initial picks. The graph is best-effort — if it
        // hasn't been built yet, skip silently. Use a Set for O(1) edge
        // membership so this stays cheap on large graphs.
        try {
          const builder = getGraphBuilder(WORKSPACE)
          await builder.build()
          const graph = builder.getGraph()
          if (graph) {
            const pickSet = new Set(initialPicks)
            const neighbors = new Set<string>()
            for (const e of graph.edges) {
              if (pickSet.has(e.source)) neighbors.add(e.target)
              if (pickSet.has(e.target)) neighbors.add(e.source)
            }
            for (const rel of neighbors) await tryAttach(rel)
          }
        } catch { /* graph is optional */ }
      }

      try {
        // Mission planning may need to emit full file contents for several
        // edits in a single response; give it a generous output budget and
        // ask for JSON mode where supported (Ollama, OpenAI).
        const complete = (sys: string, user: string) =>
          llmComplete(p, sys, user, { maxTokens: 16384, jsonMode: true })
        plan = await llmMissionPlan(
          goal.trim(),
          contextFiles ?? [],
          complete,
          workspaceFiles,
          relevantContext,
          attachedContents,
          repoMap,
        )
      } catch (e) {
        // Surface the real error — do not silently fall back to a heuristic
        // planner that produces no file edits. Mark the mission failed so the
        // UI can show the actual reason.
        updateMission(mission.id, { status: 'failed', phase: 'plan', summary: `Planner failed: ${(e as Error).message}` })
        return res.status(502).json({
          error: `LLM planner failed: ${(e as Error).message}`,
          missionId: mission.id,
        })
      }

      // Validate the plan upfront, before any execution. Catches the two
      // failure modes weaker models keep producing:
      //   1) edit/delete targeting a path that doesn't exist in the workspace
      //      (hallucinated paths like "settings.json" when none exists)
      //   2) edit/create with no `after` content (the LLM ignored the rule)
      // Either is a plan-level error — fail loud so the user sees the real
      // reason instead of partial execution with confusing per-step errors.
      //
      // Note: demo provider's heuristic planner produces description-only
      // steps (no action+path) on purpose — it's an outline, not real edits.
      // The legacy executor fallback handles those. Skip the strict validator
      // for demo so demo missions don't get marked failed at plan time.
      const workspaceSet = new Set(workspaceFiles)
      const planProblems: string[] = []
      for (const s of plan.steps) {
        if (!s.action || !s.path) {
          planProblems.push(`step "${s.description}" has no action+path`)
          continue
        }
        if ((s.action === 'edit' || s.action === 'delete' || s.action === 'patch') && !workspaceSet.has(s.path)) {
          planProblems.push(
            `${s.action} step targets "${s.path}", which does not exist in the workspace ` +
            `(${workspaceFiles.length} files indexed). The model hallucinated this path.`,
          )
        }
        if ((s.action === 'edit' || s.action === 'create') && (typeof s.after !== 'string' || s.after.length === 0)) {
          planProblems.push(
            `${s.action} step for "${s.path}" has no \`after\` content. The model did not ` +
            `provide the file contents to write.`,
          )
        }
        if (s.action === 'patch' && (!Array.isArray(s.edits) || s.edits.length === 0)) {
          planProblems.push(
            `patch step for "${s.path}" has no edits. The model needs to provide ` +
            `at least one {find, replace} pair.`,
          )
        }
        if (s.action === 'patch' && Array.isArray(s.edits)) {
          for (let i = 0; i < s.edits.length; i++) {
            const e = s.edits[i]
            if (!e.find || e.find.length === 0) {
              planProblems.push(`patch step for "${s.path}" edit ${i + 1}: empty find string`)
            }
          }
        }
      }
      const actionable = plan.steps.filter((s) => s.action && s.path)
      if (actionable.length === 0) {
        updateMission(mission.id, { status: 'failed', phase: 'plan', summary: 'Planner returned no actionable steps.' })
        return res.status(502).json({
          error: 'LLM planner returned no actionable steps (no action+path). Try a more specific goal or check your model.',
          missionId: mission.id,
        })
      }
      if (planProblems.length > 0) {
        const reason = `Plan rejected — ${planProblems.length} problem(s):\n  • ${planProblems.join('\n  • ')}`
        updateMission(mission.id, { status: 'failed', phase: 'plan', summary: reason })
        return res.status(502).json({
          error: reason + '\n\nThis usually means the model is too small for full-file edits. Try a stronger model (e.g. Claude Sonnet, GPT-4o) or attach the target file as context.',
          missionId: mission.id,
        })
      }
    }

    const updated = updateMission(mission.id, {
      steps: plan.steps,
      outcomes: plan.outcomes,
      summary: plan.summary,
      status: 'running',
      phase: 'execute',
    })
    res.json(updated)
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

/** List all missions. */
app.get('/api/missions', (_req, res) => {
  res.json(listMissions())
})

/** Get a single mission. */
app.get('/api/missions/:id', (req, res) => {
  const m = getMission(req.params.id)
  if (!m) return res.status(404).json({ error: 'not found' })
  res.json(m)
})

/** Update a mission (e.g. mark steps done, pause, cancel). */
app.patch('/api/missions/:id', (req, res) => {
  try {
    const updated = updateMission(req.params.id, req.body as Partial<import('../shared/types.js').Mission>)
    if (!updated) return res.status(404).json({ error: 'not found' })
    res.json(updated)
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

/** Delete a mission. */
app.delete('/api/missions/:id', (req, res) => {
  const ok = deleteMission(req.params.id)
  if (!ok) return res.status(404).json({ error: 'not found' })
  res.json({ ok: true })
})

/** Verify a mission's outcomes (run build/tests/lint). */
app.post('/api/missions/:id/verify', async (req, res) => {
  try {
    const mission = getMission(req.params.id)
    if (!mission) return res.status(404).json({ error: 'not found' })

    const results = await Promise.all(
      mission.outcomes.map(async (o) => {
        const r = await verifyOutcome(o)
        return { ...o, actual: r.actual, passed: r.passed }
      }),
    )

    const allPassed = results.every((o) => o.passed)
    const updated = updateMission(mission.id, {
      outcomes: results,
      phase: 'report',
      status: allPassed ? 'done' : 'failed',
    })
    res.json(updated)
  } catch (e) {
    res.status(500).json({ error: (e as Error).message })
  }
})

/** Execute a mission's steps automatically via the agent. */
app.post('/api/missions/:id/execute', async (req, res) => {
  const { provider } = req.body as { provider?: ProviderConfig }
  const mission = getMission(req.params.id)
  if (!mission) return res.status(404).json({ error: 'not found' })

  // Set up SSE for progress updates
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  const send = (data: any) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`)
  }

  try {
    // Mark mission as running
    updateMission(mission.id, { status: 'running', phase: 'execute' })
    send({ type: 'status', status: 'running', phase: 'execute' })

    const p = provider ?? { provider: 'demo', model: 'demo' }
    const complete = (sys: string, user: string) => llmComplete(p, sys, user)

    // Get workspace files for context
    const files: Array<{ path: string; content: string }> = []
    for (const cf of mission.contextFiles) {
      try {
        const abs = safeResolve(WORKSPACE, cf)
        const content = await fs.readFile(abs, 'utf8')
        files.push({ path: cf, content })
      } catch {
        /* skip inaccessible files */
      }
    }

    // Execute each pending step
    const updatedSteps = [...mission.steps]
    for (let i = 0; i < updatedSteps.length; i++) {
      const step = updatedSteps[i]
      if (step.status !== 'pending') continue

      // Mark step as running
      updatedSteps[i] = { ...step, status: 'running', startedAt: Date.now() }
      updateMission(mission.id, { steps: updatedSteps })
      send({ type: 'step', index: i, status: 'running', description: step.description })

      try {
        // Fast path: step already carries a typed action from the planner.
        // Run it directly — no second-tier re-planning, no signal loss.
        if (step.action && step.path) {
          const agentStep = {
            id: `${step.id}-action`,
            action: step.action,
            path: step.path,
            description: step.description,
            status: 'pending' as const,
            before: step.before,
            after: step.after,
            edits: step.edits,
          }
          const executed = await executeStep(agentStep)
          send({
            type: 'agent_step',
            missionStepIndex: i,
            action: executed.action,
            path: executed.path,
            status: executed.status,
            note: executed.note,
          })

          if (executed.status === 'done' && (executed.action === 'create' || executed.action === 'edit' || executed.action === 'patch')) {
            const existing = files.findIndex((f) => f.path === executed.path)
            if (existing >= 0) files[existing].content = executed.after ?? ''
            else files.push({ path: executed.path, content: executed.after ?? '' })
          }

          updatedSteps[i] = {
            ...step,
            status: executed.status === 'done' ? 'done' : executed.status === 'skipped' ? 'skipped' : 'error',
            completedAt: Date.now(),
            agentSteps: [executed],
            note: executed.note,
            before: executed.before ?? step.before,
          }
          send({
            type: 'step',
            index: i,
            status: updatedSteps[i].status,
            description: step.description,
            note: executed.note,
          })
        } else {
          // Legacy / demo fallback: re-plan this step via agent and execute
          // each produced action.
          const agentReq = { task: step.description, files, provider: p }
          let agentPlan
          if (p.provider === 'demo') {
            agentPlan = demoPlan(agentReq)
          } else {
            // Real providers should have produced typed steps already; if we
            // get here it's a bug in the planner. Surface it instead of
            // silently doing nothing.
            try {
              agentPlan = await llmPlan(agentReq, complete)
            } catch (e) {
              throw new Error(`Mission step "${step.description}" had no action and re-planning failed: ${(e as Error).message}`)
            }
          }

          const executedAgentSteps = []
          for (const agentStep of agentPlan.steps) {
            const executed = await executeStep(agentStep)
            executedAgentSteps.push(executed)
            send({
              type: 'agent_step',
              missionStepIndex: i,
              action: executed.action,
              path: executed.path,
              status: executed.status,
              note: executed.note,
            })
            if (executed.status === 'done' && (executed.action === 'create' || executed.action === 'edit')) {
              const existing = files.findIndex((f) => f.path === executed.path)
              if (existing >= 0) files[existing].content = executed.after ?? ''
              else files.push({ path: executed.path, content: executed.after ?? '' })
            }
          }

          // Step is done only if it actually did something AND nothing errored.
          const anyError = executedAgentSteps.some((s) => s.status === 'error')
          const anyDone = executedAgentSteps.some((s) => s.status === 'done')
          const stepStatus = anyError ? 'error' : anyDone ? 'done' : 'skipped'

          // For error/skipped steps, surface the underlying agent-step note
          // (not just the planner's summary) so the user sees the real reason.
          const errNote = executedAgentSteps.find((s) => s.status === 'error')?.note
          const skipNote = executedAgentSteps.find((s) => s.status === 'skipped')?.note
          const stepNote = anyError ? errNote : !anyDone ? skipNote : agentPlan.summary

          updatedSteps[i] = {
            ...step,
            status: stepStatus,
            completedAt: Date.now(),
            agentSteps: executedAgentSteps,
            note: stepNote,
          }
          send({ type: 'step', index: i, status: stepStatus, description: step.description, note: stepNote })
        }
      } catch (e) {
        const errMsg = (e as Error).message
        updatedSteps[i] = {
          ...step,
          status: 'error',
          completedAt: Date.now(),
          note: errMsg,
        }
        // Use `note` (not `error`) to match what the store SSE handler reads,
        // so the user gets a useful toast instead of a bare "error" status.
        send({ type: 'step', index: i, status: 'error', description: step.description, note: errMsg })
      }

      updateMission(mission.id, { steps: updatedSteps })
    }

    // All steps done — move to verify phase only if every step actually
    // succeeded. Otherwise mark failed so the UI doesn't claim success.
    const allDone = updatedSteps.every((s) => s.status === 'done' || s.status === 'skipped')
    const final = updateMission(mission.id, {
      steps: updatedSteps,
      phase: allDone ? 'verify' : 'report',
      status: allDone ? 'running' : 'failed',
    })
    send({ type: 'complete', mission: final })
    res.end()
  } catch (e) {
    send({ type: 'error', error: (e as Error).message })
    updateMission(mission.id, { status: 'failed' })
    res.end()
  }
})

// ---------- health ----------
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    workspace: WORKSPACE,
    demo: true,
    env: {
      hasOpenaiKey: Boolean(process.env.OPENAI_API_KEY),
      hasAnthropicKey: Boolean(process.env.ANTHROPIC_API_KEY),
    },
  })
})

// In production, serve the built frontend from /dist
const distDir = path.resolve(__dirname, '..', 'dist')
if (existsSync(distDir)) {
  app.use(express.static(distDir))
  app.get('*', (_req, res) => res.sendFile(path.join(distDir, 'index.html')))
}

const server = app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`\n  Newton editor backend on http://localhost:${PORT}`)
  // eslint-disable-next-line no-console
  console.log(`  Workspace: ${WORKSPACE}\n`)
})

// ---------- Real PTY terminal over WebSocket ----------
// Each WebSocket connection spawns its own shell in a pseudo-terminal via
// node-pty. The browser-side xterm.js renders raw PTY output and forwards
// keystrokes back. This gives full TTY semantics: interactive programs,
// ANSI escape codes, signals, colored output.
//
// Wire protocol (text JSON, one message per frame):
//   client → server: { type: 'input', data: string }
//                    { type: 'resize', cols: number, rows: number }
//   server → client: { type: 'output', data: string }
//                    { type: 'exit', code: number, signal?: string }
;(async () => {
  let WebSocketServer: typeof import('ws').WebSocketServer
  // Use the homebridge prebuilt fork — it ships binaries for current Node
  // versions (incl. Node 24). The upstream `node-pty` 1.1.0 fails with a
  // generic posix_spawnp error on Node 24 because its prebuilts predate it.
  let nodePty: typeof import('@homebridge/node-pty-prebuilt-multiarch')
  try {
    ({ WebSocketServer } = await import('ws'))
    nodePty = await import('@homebridge/node-pty-prebuilt-multiarch')
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('  Terminal WS disabled — missing deps:', (e as Error).message)
    return
  }

  const wss = new WebSocketServer({ noServer: true })
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/api/terminal/ws') return

    // SECURITY: only allow connections from same-origin browser pages.
    // Without this check, ANY webpage the user has open in their browser
    // could connect to this localhost WS and execute shell commands.
    // We allow: localhost on the configured client/server ports, plus
    // 127.0.0.1 equivalents. Reject everything else.
    const origin = req.headers.origin
    const allowedOrigins = new Set<string>([
      `http://localhost:${PORT}`,
      `http://127.0.0.1:${PORT}`,
      `http://localhost:${process.env.NEWTON_CLIENT_PORT || 5173}`,
      `http://127.0.0.1:${process.env.NEWTON_CLIENT_PORT || 5173}`,
    ])
    if (origin && !allowedOrigins.has(origin)) {
      // eslint-disable-next-line no-console
      console.warn(`  Terminal WS rejected non-allowed origin: ${origin}`)
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
      socket.destroy()
      return
    }

    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
  })

  wss.on('connection', (ws) => {
    // Build a clean env object — posix_spawnp rejects entries whose value is
    // not a string, and process.env values are typed `string | undefined`.
    const cleanEnv: { [key: string]: string } = {}
    for (const [k, v] of Object.entries(process.env)) {
      if (typeof v === 'string') cleanEnv[k] = v
    }
    cleanEnv.TERM = 'xterm-256color'
    cleanEnv.COLORTERM = 'truecolor'

    // Prefer the user's shell; fall back to common system shells if SHELL is
    // missing or unset. We don't trust SHELL blindly — if it doesn't point at
    // an executable file, try fallbacks rather than failing with a generic
    // posix_spawnp error.
    const candidates = [
      process.env.SHELL,
      '/bin/zsh',
      '/bin/bash',
      '/bin/sh',
    ].filter((s): s is string => typeof s === 'string' && s.length > 0)

    let shell: string | null = null
    for (const s of candidates) {
      try { if (existsSync(s)) { shell = s; break } } catch { /* ignore */ }
    }
    if (!shell) {
      const msg = `No usable shell found (tried: ${candidates.join(', ')})`
      try { ws.send(JSON.stringify({ type: 'output', data: `\r\n\x1b[31m${msg}\x1b[0m\r\n` })) } catch { /* ignore */ }
      try { ws.close() } catch { /* ignore */ }
      return
    }

    let pty: ReturnType<typeof nodePty.spawn>
    try {
      pty = nodePty.spawn(shell, [], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: WORKSPACE,
        env: cleanEnv,
      })
    } catch (e) {
      const msg = `Failed to spawn ${shell}: ${(e as Error).message}`
      // eslint-disable-next-line no-console
      console.error('  Terminal spawn error:', msg)
      try { ws.send(JSON.stringify({ type: 'output', data: `\r\n\x1b[31m${msg}\x1b[0m\r\n` })) } catch { /* ignore */ }
      try { ws.close() } catch { /* ignore */ }
      return
    }

    const send = (msg: object) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg))
    }

    pty.onData((data) => send({ type: 'output', data }))
    pty.onExit(({ exitCode, signal }) => {
      send({ type: 'exit', code: exitCode, signal })
      try { ws.close() } catch { /* ignore */ }
    })

    ws.on('message', (raw) => {
      let msg: any
      try { msg = JSON.parse(raw.toString()) } catch { return }
      if (msg.type === 'input' && typeof msg.data === 'string') {
        pty.write(msg.data)
      } else if (msg.type === 'resize' && Number.isFinite(msg.cols) && Number.isFinite(msg.rows)) {
        try { pty.resize(Math.max(1, msg.cols | 0), Math.max(1, msg.rows | 0)) } catch { /* ignore */ }
      }
    })

    ws.on('close', () => {
      try { pty.kill() } catch { /* ignore */ }
    })
    ws.on('error', () => {
      try { pty.kill() } catch { /* ignore */ }
    })
  })

  // eslint-disable-next-line no-console
  console.log(`  Terminal WS on ws://localhost:${PORT}/api/terminal/ws`)
})()

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  ✗ Port ${PORT} is already in use.`)
    console.error(`    Another Newton backend may already be running.`)
    console.error(`    Run: lsof -ti:${PORT} | xargs kill -9\n`)
  } else {
    console.error('Server error:', err)
  }
  process.exit(1)
})
