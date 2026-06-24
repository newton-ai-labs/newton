import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import path from 'node:path'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { ChatRequest, EditRequest, EditResponse, FileNode, ProviderConfig, AgentRequest } from '../shared/types.js'
import { getProtocol, getProviderDef } from '../shared/types.js'
import { demoAnswer, streamDemo, demoEdit } from './demoAi.js'
import { demoPlan, executeStep, llmPlan } from './agent.js'
import { getIndex, type SearchHit } from './indexing.js'
import { getGraphBuilder } from './repoGraph.js'
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

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const PORT = Number(process.env.NEWTON_PORT) || 8787

// Resolve workspace root: NEWTON_WORKSPACE -> cwd -> (if running from dist) parent
function resolveWorkspace(): string {
  if (process.env.NEWTON_WORKSPACE) return path.resolve(process.env.NEWTON_WORKSPACE)
  const cwd = process.cwd()
  return cwd
}

const WORKSPACE = resolveWorkspace()

const app = express()
app.use(cors())
app.use(express.json({ limit: '10mb' }))

// ---------- safety helpers ----------
function safeJoin(rel: string): string {
  const resolved = path.resolve(WORKSPACE, rel)
  if (!resolved.startsWith(WORKSPACE)) {
    throw new Error('Path escapes workspace root')
  }
  return resolved
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

// ---------- chat / AI proxy (streaming) ----------
async function buildSystemPrompt(req: ChatRequest): Promise<string> {
  const base =
    'You are Newton, an elite AI pair-programmer embedded in a code editor. ' +
    'Be concise, correct, and practical. Use Markdown. Use fenced code blocks with language tags. ' +
    'When the user references "this file" or "my code", use the active file context. ' +
    'When the user asks about the codebase, use the relevant code context provided below. ' +
    '\n\nIMPORTANT — Apply-from-chat: When you produce code that is meant to be saved as a complete file or a complete replacement for an existing file, ' +
    'prepend a comment annotation on the FIRST line of the code block with the target file path, using the syntax the target language uses for comments: ' +
    'e.g. `// filepath: src/utils/debounce.ts` for JS/TS, `# filepath: main.py` for Python, `<!-- filepath: index.html -->` for HTML/XML, etc. ' +
    'Only add this annotation for complete, ready-to-apply files — NOT for short illustrative snippets. ' +
    'Prefer relative paths from the project root. The user can edit the path before applying.'

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
      `\n\nThe user currently has \`${req.activeFile.path}\` open:\n\`\`\`\n${req.activeFile.content.slice(0, 12000)}\n\`\`\``
  }

  // Inject @-mentioned attached files
  if (req.attachedFiles && req.attachedFiles.length > 0) {
    context +=
      '\n\n--- @-MENTIONED FILES (explicitly attached by the user) ---'
    for (const f of req.attachedFiles) {
      context += `\nFile: \`${f.path}\`\n\`\`\`\n${f.content.slice(0, 8000)}\n\`\`\`\n`
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

app.post('/api/chat', async (req, res) => {
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
app.post('/api/edit', async (req, res) => {
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
async function llmComplete(provider: ProviderConfig, system: string, user: string): Promise<string> {
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
    bodyObj = { model: provider.model, max_tokens: 4096, system, messages: [{ role: 'user', content: user }], stream: false }
  } else if (proto === 'ollama') {
    url = `${baseUrl}/api/chat`
    bodyObj = { model: provider.model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], stream: false }
  } else {
    // openai-compat (OpenAI, Groq, Mistral, DeepSeek, OpenRouter, Together, xAI, Gemini, …)
    url = `${baseUrl}/chat/completions`
    headers.Authorization = `Bearer ${provider.apiKey}`
    if (provider.provider === 'openrouter') {
      headers['HTTP-Referer'] = 'https://github.com/newton-editor'
      headers['X-Title'] = 'Newton Editor'
    }
    bodyObj = { model: provider.model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], stream: false, temperature: 0.2 }
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

// ---------- agent endpoints ----------
app.post('/api/agent/plan', async (req, res) => {
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

// ---------- natural-language shell (NL → command) ----------
app.post('/api/nlsh', async (req, res) => {
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
app.post('/api/exec', async (req, res) => {
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

/** Demo-mode test scaffold generator. */
function demoTests(code: string, filePath: string, language: string): string {
  const base = path.basename(filePath, path.extname(filePath))
  const ext = path.extname(filePath)

  if (language === 'python') {
    const funcs = [...code.matchAll(/def\s+(\w+)\s*\(([^)]*)\)/g)]
    const testFns = funcs.map((m) => {
      const name = m[1]
      return `def test_${name}():\n    result = ${name}()\n    assert result is not None  # TODO: expected value`
    }).join('\n\n')
    return `import pytest\nfrom ${base} import *\n\n${testFns || 'def test_placeholder():\n    assert True'}\n`
  }

  // JS/TS
  const isTs = ext === '.ts' || ext === '.tsx'
  const funcs = [...code.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g), ...code.matchAll(/export\s+const\s+(\w+)\s*=/g)]
  const fnNames = funcs.map((m) => m[1]).filter((n) => !/^[A-Z]/.test(n) || ext === '.tsx')

  const testCases = fnNames.length > 0
    ? fnNames.map((n) => `  it('${n} should work', () => {\n    // TODO: import and test\n    expect(typeof ${n}).toBeDefined()\n  })`).join('\n\n')
    : `  it('module loads', () => {\n    expect(true).toBe(true)\n  })`

  const importLine = isTs
    ? `import { ${fnNames.join(', ') || 'placeholder'} } from './${base}'`
    : `const { ${fnNames.join(', ') || 'placeholder'} } = require('./${base}')`

  return `${importLine}

describe('${base}', () => {
${testCases}
})
`
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
      { cwd: WORKSPACE, maxBuffer: 5 * 1024 * 1024, timeout: 15000 },
      (err, stdout) => {
        if (err) resolve('')
        else resolve(stdout.toString().trim())
      },
    )
  })
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
    const porcelain = await git(['status', '--porcelain=v1', '-b', '--renames'])

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
    const headRaw = await git(['log', '-1', '--pretty=format:%H|%s|%an|%ci'])
    if (headRaw) {
      const [hash, message, author, date] = headRaw.split('|')
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
      '--pretty=format:%H|%h|%s|%an|%ar',
    ])
    if (!raw) return res.json({ commits: [] })
    const commits = raw.split('\n').map((line) => {
      const [hash, short, message, author, date] = line.split('|')
      return { hash, short, message, author, date }
    })
    res.json({ commits })
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
    const user = `Here is the staged diff. Write a single conventional-commit message.\n\n\`\`\`diff\n${diff.slice(0, 8000)}\n\`\`\``

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
    const user = `Explain this diff${filePath ? ` for \`${filePath}\`` : ''}:\n\n\`\`\`diff\n${diff.slice(0, 10000)}\n\`\`\``

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
      `Review this diff${files.length ? ` (files: ${files.join(', ')})` : ''}:\n\n\`\`\`diff\n${diff.slice(0, 12000)}\n\`\`\`\n\n` +
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
    if (/==[^=]/.test(line) && !/===/.test(line)) {
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
      try {
        const complete = (sys: string, user: string) => llmComplete(p, sys, user)
        plan = await llmMissionPlan(goal.trim(), contextFiles ?? [], complete)
      } catch (e) {
        // fall back to demo plan
        plan = demoMissionPlan(goal.trim())
        plan.summary += ` (LLM planning failed: ${(e as Error).message}; using heuristic fallback.)`
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

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`\n  Newton editor backend on http://localhost:${PORT}`)
  // eslint-disable-next-line no-console
  console.log(`  Workspace: ${WORKSPACE}\n`)
})