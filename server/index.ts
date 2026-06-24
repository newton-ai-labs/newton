import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import path from 'node:path'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { ChatRequest, EditRequest, EditResponse, FileNode, ProviderConfig, AgentRequest } from '../shared/types.js'
import { demoAnswer, streamDemo, demoEdit } from './demoAi.js'
import { demoPlan, executeStep, llmPlan } from './agent.js'
import { getIndex, type SearchHit } from './indexing.js'

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
function buildSystemPrompt(req: ChatRequest): string {
  const base =
    'You are Newton, an elite AI pair-programmer embedded in a code editor. ' +
    'Be concise, correct, and practical. Use Markdown. Use fenced code blocks with language tags. ' +
    'When the user references "this file" or "my code", use the active file context. ' +
    'When the user asks about the codebase, use the relevant code context provided below.'

  let context = base

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

    if (provider.provider === 'openai') {
      if (!provider.apiKey) return fallbackNoKey(send, done, 'OpenAI')
      await streamOpenai(body, provider, send, ac.signal)
      return done()
    }

    if (provider.provider === 'anthropic') {
      if (!provider.apiKey) return fallbackNoKey(send, done, 'Anthropic')
      await streamAnthropic(body, provider, send, ac.signal)
      return done()
    }

    if (provider.provider === 'ollama') {
      await streamOllama(body, provider, send, ac.signal)
      return done()
    }

    // unknown provider
    await streamDemo('Unknown provider — falling back to demo mode.', send, ac.signal)
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

// ----- OpenAI streaming -----
async function streamOpenai(
  body: ChatRequest,
  provider: ProviderConfig,
  send: (c: string) => void,
  signal: AbortSignal,
) {
  const baseUrl = (provider.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '')
  const messages = [{ role: 'system', content: buildSystemPrompt(body) }, ...body.messages]
  const r = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${provider.apiKey}`,
    },
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
    throw new Error(`OpenAI ${r.status}: ${txt.slice(0, 300)}`)
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
  const sys = buildSystemPrompt(body)
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
      messages: [{ role: 'system', content: buildSystemPrompt(body) }, ...body.messages],
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

    let code = ''
    if (provider.provider === 'openai') {
      code = await llmComplete(
        provider,
        sys,
        userMsg,
        'https://api.openai.com/v1/chat/completions',
        (j: any) => j.choices?.[0]?.message?.content ?? '',
        true,
      )
    } else if (provider.provider === 'anthropic') {
      code = await llmComplete(
        provider,
        sys,
        userMsg,
        'https://api.anthropic.com/v1/messages',
        (j: any) =>
          (j.content ?? []).map((b: any) => b.text ?? '').join(''),
        false,
        body.path,
      )
    } else if (provider.provider === 'ollama') {
      const baseUrl = (provider.baseUrl || 'http://localhost:11434').replace(/\/$/, '')
      code = await llmComplete(
        provider,
        sys,
        userMsg,
        `${baseUrl}/api/chat`,
        (j: any) => j.message?.content ?? '',
        false,
        body.path,
        true,
      )
    }

    // strip accidental markdown fences
    code = code.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '').trim()
    res.json({ code, note: 'Edited with ' + provider.provider + '.' } satisfies EditResponse)
  } catch (e) {
    res.status(500).json({ code: req.body?.code ?? '', note: 'Error: ' + (e as Error).message })
  }
})

/**
 * Non-streaming LLM "complete" helper used by the edit endpoint.
 * Supports OpenAI-style (messages), Anthropic, and Ollama (NDJSON).
 */
async function llmComplete(
  provider: ProviderConfig,
  system: string,
  user: string,
  url: string,
  extract: (json: any) => string,
  isJsonResponse: boolean,
  _path?: string,
  isOllama = false,
): Promise<string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  let bodyObj: any

  if (url.includes('anthropic.com')) {
    headers['x-api-key'] = provider.apiKey!
    headers['anthropic-version'] = '2023-06-01'
    bodyObj = {
      model: provider.model,
      max_tokens: 4096,
      system,
      messages: [{ role: 'user', content: user }],
      stream: false,
    }
  } else if (isOllama) {
    bodyObj = {
      model: provider.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      stream: false,
    }
  } else {
    // OpenAI-compatible
    headers.Authorization = `Bearer ${provider.apiKey}`
    bodyObj = {
      model: provider.model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      stream: false,
      temperature: 0.2,
    }
  }

  const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(bodyObj) })
  if (!r.ok) {
    const txt = await r.text().catch(() => '')
    throw new Error(`${provider.provider} ${r.status}: ${txt.slice(0, 200)}`)
  }

  if (isJsonResponse) {
    const j = await r.json()
    return extract(j)
  }
  // Ollama streams NDJSON even with stream:false? It returns one JSON line.
  const text = await r.text()
  try {
    return extract(JSON.parse(text))
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
    const complete = (sys: string, user: string) =>
      llmComplete(
        provider,
        sys,
        user,
        provider.provider === 'openai'
          ? 'https://api.openai.com/v1/chat/completions'
          : provider.provider === 'anthropic'
          ? 'https://api.anthropic.com/v1/messages'
          : `${(provider.baseUrl || 'http://localhost:11434').replace(/\/$/, '')}/api/chat`,
        (j: any) =>
          j.choices?.[0]?.message?.content ??
          (j.content ?? []).map((b: any) => b.text ?? '').join('') ??
          j.message?.content ??
          '',
        provider.provider === 'openai',
        undefined,
        provider.provider === 'ollama',
      )

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
    const complete = (sys2: string, user2: string) =>
      llmComplete(
        p,
        sys2,
        user2,
        p.provider === 'openai'
          ? 'https://api.openai.com/v1/chat/completions'
          : p.provider === 'anthropic'
          ? 'https://api.anthropic.com/v1/messages'
          : `${(p.baseUrl || 'http://localhost:11434').replace(/\/$/, '')}/api/chat`,
        (j: any) =>
          j.choices?.[0]?.message?.content ??
          (j.content ?? []).map((b: any) => b.text ?? '').join('') ??
          j.message?.content ??
          '',
        p.provider === 'openai',
        undefined,
        p.provider === 'ollama',
      )
    let cmd = await complete(sys, user)
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
    const complete = (sys2: string, user2: string) =>
      llmComplete(
        p,
        sys2,
        user2,
        p.provider === 'openai'
          ? 'https://api.openai.com/v1/chat/completions'
          : p.provider === 'anthropic'
          ? 'https://api.anthropic.com/v1/messages'
          : `${(p.baseUrl || 'http://localhost:11434').replace(/\/$/, '')}/api/chat`,
        (j: any) =>
          j.choices?.[0]?.message?.content ??
          (j.content ?? []).map((b: any) => b.text ?? '').join('') ??
          j.message?.content ??
          '',
        p.provider === 'openai',
        undefined,
        p.provider === 'ollama',
      )
    let tests = await complete(sys, user)
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