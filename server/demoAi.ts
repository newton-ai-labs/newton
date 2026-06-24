import type { ChatMessage } from '../shared/types.js'

/**
 * A self-contained "demo" assistant that needs no API key.
 * It understands common coding requests well enough to be genuinely useful:
 *  - explains code, summarizes, finds bugs/anti-patterns
 *  - generates common code from templates (debounce, fetch, components…)
 *  - answers general programming questions from a small knowledge base
 *  - streams responses token-by-token for a real assistant feel.
 *
 * It is intentionally heuristic. Pair with a real LLM provider for full power.
 */

interface Rule {
  match: (q: string) => boolean
  respond: (ctx: DemoContext) => string
}

interface DemoContext {
  question: string
  activeFile: { path: string; content: string } | null
  history: ChatMessage[]
}

const codeFence = (lang: string, code: string) =>
  '```' + lang + '\n' + code.trim() + '\n```'

const TEMPLATES: { match: RegExp; lang: string; filepath: string; body: (ctx: DemoContext) => string }[] = [
  {
    match: /\bdebounce\b/i,
    lang: 'ts',
    filepath: 'src/utils/debounce.ts',
    body: () =>
      `export function debounce<T extends (...args: any[]) => void>(fn: T, ms = 300) {
  let timer: ReturnType<typeof setTimeout>
  return (...args: Parameters<T>) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
}`,
  },
  {
    match: /\bthrottle\b/i,
    lang: 'ts',
    filepath: 'src/utils/throttle.ts',
    body: () =>
      `export function throttle<T extends (...args: any[]) => void>(fn: T, ms = 300) {
  let last = 0
  return (...args: Parameters<T>) => {
    const now = Date.now()
    if (now - last >= ms) {
      last = now
      fn(...args)
    }
  }
}`,
  },
  {
    match: /\b(usestate|react state hook)\b/i,
    lang: 'tsx',
    filepath: 'src/components/Counter.tsx',
    body: () =>
      `import { useState } from 'react'

export function Counter() {
  const [count, setCount] = useState(0)
  return (
    <button onClick={() => setCount((c) => c + 1)}>
      Count: {count}
    </button>
  )
}`,
  },
  {
    match: /\b(fetch|http get|api request)\b/i,
    lang: 'ts',
    filepath: 'src/utils/getJSON.ts',
    body: () =>
      `export async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(\`HTTP \${res.status}: \${res.statusText}\`)
  return res.json() as Promise<T>
}`,
  },
  {
    match: /\bexpress\s+(server|route|api)\b/i,
    lang: 'ts',
    filepath: 'server.ts',
    body: () =>
      `import express from 'express'
const app = express()
app.use(express.json())

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', time: Date.now() })
})

app.listen(3000, () => console.log('listening on :3000'))`,
  },
  {
    match: /\b(quicksort|quick sort)\b/i,
    lang: 'ts',
    filepath: 'src/sorting/quicksort.ts',
    body: () =>
      `export function quicksort(arr: number[]): number[] {
  if (arr.length <= 1) return arr
  const [pivot, ...rest] = arr
  const left = rest.filter((x) => x < pivot)
  const right = rest.filter((x) => x >= pivot)
  return [...quicksort(left), pivot, ...quicksort(right)]
}`,
  },
]

/** Build a code fence with an optional filepath annotation for apply-from-chat. */
function codeFenceWithFile(lang: string, filepath: string, code: string): string {
  // Pick a comment prefix based on language
  const comment = lang === 'python' ? '#' : lang === 'html' || lang === 'xml' ? '<!-- -->' : '//'
  const annotation = comment === '<!-- -->'
    ? `<!-- filepath: ${filepath} -->`
    : `${comment} filepath: ${filepath}`
  return '```' + lang + '\n' + annotation + '\n' + code.trim() + '\n```'
}

const KB: { match: RegExp; answer: string }[] = [
  {
    match: /\b(what is|what's) newton\b/i,
    answer:
      "Newton is an AI-native code editor — a web-based alternative to Cursor. " +
      'It bundles the Monaco editor, a file explorer, and an AI assistant that can ' +
      'stream answers, explain and review your code, and generate snippets. ' +
      'Right now you are talking to its built-in **demo assistant**, which works with ' +
      'zero configuration. For full power, open **Settings** and add an OpenAI, ' +
      'Anthropic, or local Ollama provider.',
  },
  {
    match: /\b(difference|vs|versus).*let.*const\b/i,
    answer:
      '`let` declares a **reassignable** variable; `const` declares one that **cannot be reassigned**. ' +
      'Objects/arrays declared with `const` are still mutable — only the binding is constant. ' +
      'Prefer `const` by default, and use `let` only when you must reassign.',
  },
  {
    match: /\b(what is|explain).*async.?await\b/i,
    answer:
      '`async/await` is syntax for working with Promises as if they were synchronous. ' +
      'An `async` function always returns a Promise, and `await` pauses inside that function ' +
      'until a Promise settles. Wrap awaits in `try/catch` to handle rejections.',
  },
]

const RULES: Rule[] = [
  {
    match: (q) => TEMPLATES.some((t) => t.match.test(q)),
    respond: (ctx) => {
      const tpl = TEMPLATES.find((t) => t.match.test(ctx.question))!
      return `Here's a clean implementation — click **Apply** to save it as a file:\n\n${codeFenceWithFile(tpl.lang, tpl.filepath, tpl.body(ctx))}\n\nLet me know if you'd like a variant (with tests, in a different language, or hooked into your existing code).`
    },
  },
  {
    match: (q) => /\b(explain|what does|walk me through|how does|review|improve|bug|fix|issue|problem)\b/i.test(q) || /\b(refactor|optimize|clean up)\b/i.test(q),
    respond: (ctx) => reviewCode(ctx),
  },
  {
    match: (q) => KB.some((k) => k.match.test(q)),
    respond: (ctx) => KB.find((k) => k.match.test(ctx.question))!.answer,
  },
  {
    match: (q) => /\b(hello|hi|hey|yo|sup)\b/i.test(q) && ctx_isShort(q),
    respond: () =>
      "Hey! 👋 I'm Newton's built-in assistant. I can explain code, review for bugs, " +
      "generate common snippets, and answer programming questions. Ask me to **review this file** " +
      "or **write a debounce function**, for example. Add a real LLM provider in Settings for full power.",
  },
]

function ctx_isShort(s: string) {
  return s.trim().split(/\s+/).length <= 4
}

function reviewCode(ctx: DemoContext): string {
  const file = ctx.activeFile
  const wantsReview = /\b(review|improve|bug|fix|issue|problem|refactor|optimize|clean up)\b/i.test(ctx.question)

  if (!file || !file.content.trim()) {
    return wantsReview
      ? "I'd be happy to review — but there's no active file in the editor. " +
          'Open or paste some code, then ask me to review it. I support detecting ' +
          '`any` types, missing error handling, `console.log` left behind, unused `var`, equality bugs, and more.'
      : 'Sure! Could you share the code or open a file first? I can then explain it, find bugs, or suggest improvements.'
  }

  const lang = inferLang(file.path)
  const issues = analyze(file.content, lang)
  const summary = summarize(file.content, lang)

  let out = `**\`${file.path}\`** — ${file.content.split('\n').length} lines.\n\n`
  out += `**Summary:** ${summary}\n\n`

  if (issues.length === 0) {
    out += '✅ No obvious issues found. The code looks clean. '
    out += wantsReview ? 'Want me to suggest stylistic or architectural improvements? ' : ''
  } else {
    out += `**Found ${issues.length} issue${issues.length > 1 ? 's' : ''}:**\n\n`
    for (const it of issues.slice(0, 12)) {
      out += `- ${it}\n`
    }
    if (issues.length > 12) out += `- …and ${issues.length - 12} more\n`
    out += '\nWant me to **apply** fixes? (Connect a real provider in Settings for inline edits.)'
  }

  if (/\b(explain|walk me through|how does)\b/i.test(ctx.question)) {
    out += `\n\n**Walkthrough:**\n${explainWalkthrough(file.content, lang)}`
  }

  return out
}

function inferLang(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return (
    {
      ts: 'typescript',
      tsx: 'typescript',
      js: 'javascript',
      jsx: 'javascript',
      py: 'python',
      go: 'go',
      rs: 'rust',
      rb: 'ruby',
      java: 'java',
      md: 'markdown',
    }[ext] ?? 'text'
  )
}

function analyze(src: string, lang: string): string[] {
  const issues: string[] = []
  const lines = src.split('\n')

  lines.forEach((line, i) => {
    const n = i + 1
    if (/:\s*any\b/.test(line)) issues.push(`Line ${n}: \`any\` type — consider a specific type (TS).`)
    if (/console\.(log|debug)\s*\(/.test(line) && !/\/\//.test(line.split('console')[0]))
      issues.push(`Line ${n}: leftover \`console.log\` — remove before shipping.`)
    if (/\bvar\s+/.test(line)) issues.push(`Line ${n}: \`var\` — prefer \`let\`/\`const\`.`)
    if (/==[^=]/.test(line)) issues.push(`Line ${n}: \`==\`/ \`!=\` — prefer strict \`===\`/\`!==\`.`)
    if (/\b(eval|Function)\s*\(/.test(line)) issues.push(`Line ${n}: \`eval\` is dangerous.`)
    if (/TODO|FIXME|XXX/.test(line)) issues.push(`Line ${n}: unresolved TODO/FIXME.`)
    if (lang === 'python' && /\bprint\s*\(/.test(line)) issues.push(`Line ${n}: \`print()\` — use logging in production.`)
    if (/catch\s*\(\s*\w*\s*\)\s*\{\s*\}/.test(line)) issues.push(`Line ${n}: empty catch — swallow errors silently.`)
    if (/password|secret|api[_-]?key/i.test(line) && /=\s*["'][^"']{6,}["']/.test(line))
      issues.push(`Line ${n}: possible hardcoded secret — move to env.`)
  })

  const srcNoStrings = src.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""')
  const open = (srcNoStrings.match(/\{/g) || []).length
  const close = (srcNoStrings.match(/\}/g) || []).length
  if (open !== close) issues.push(`Brace mismatch: ${open} \`{\` vs ${close} \`}\`.`)

  const parensOpen = (srcNoStrings.match(/\(/g) || []).length
  const parensClose = (srcNoStrings.match(/\)/g) || []).length
  if (parensOpen !== parensClose) issues.push(`Paren mismatch: ${parensOpen} \`(\` vs ${parensClose} \`)\`.`)

  return issues
}

function summarize(src: string, lang: string): string {
  const fns =
    lang.startsWith('typescript') || lang.startsWith('javascript')
      ? [...src.matchAll(/(?:export\s+)?(?:async\s+)?function\s+(\w+)/g)].map((m) => m[1])
      : lang === 'python'
      ? [...src.matchAll(/def\s+(\w+)/g)].map((m) => m[1])
      : []
  const classes = [...src.matchAll(/class\s+(\w+)/g)].map((m) => m[1])
  const imports = (src.match(/^\s*import\s+/gm) || []).length
  const parts: string[] = []
  if (imports) parts.push(`${imports} import${imports > 1 ? 's' : ''}`)
  if (classes.length) parts.push(`class${classes.length > 1 ? 'es' : ''} \`${classes.join('`, `')}\``)
  if (fns.length)
    parts.push(`function${fns.length > 1 ? 's' : ''} \`${fns.slice(0, 6).join('`, `')}${fns.length > 6 ? '…' : ''}\``)
  return parts.length ? parts.join(', ') + '.' : 'No top-level symbols detected.'
}

function explainWalkthrough(src: string, _lang: string): string {
  const lines = src.split('\n')
  const bullets: string[] = []
  lines.forEach((line, i) => {
    const t = line.trim()
    if (/^(export\s+)?(async\s+)?function/.test(t)) bullets.push(`• Line ${i + 1}: defines a function.`)
    else if (/^(export\s+)?class/.test(t)) bullets.push(`• Line ${i + 1}: declares a class.`)
    else if (/^(import|from)\s/.test(t)) bullets.push(`• Line ${i + 1}: imports a module.`)
    else if (/if\s*\(/.test(t) && bullets.length < 10) bullets.push(`• Line ${i + 1}: a conditional branch.`)
    else if (/\bfor\s*\(/.test(t) && bullets.length < 10) bullets.push(`• Line ${i + 1}: a loop.`)
  })
  return bullets.length ? bullets.join('\n') : 'No high-level structure markers found.'
}

export function demoAnswer(messages: ChatMessage[], activeFile: DemoContext['activeFile']): string {
  const last = [...messages].reverse().find((m) => m.role === 'user')
  const question = last?.content?.trim() ?? '...'
  const ctx: DemoContext = { question, activeFile, history: messages }

  for (const rule of RULES) {
    if (rule.match(question)) return rule.respond(ctx)
  }

  // Fallback: still try to be helpful.
  if (activeFile?.content.trim()) {
    return reviewCode(ctx)
  }
  return (
    "I'm Newton's built-in demo assistant. I can:\n\n" +
    '- **Explain / review** the open file for bugs and improvements\n' +
    '- **Generate** common snippets (debounce, fetch, React hooks, express routes…)\n' +
    '- **Answer** programming questions\n\n' +
    'Try asking: *"review this file"*, *"write a throttle function"*, or *"explain async/await"*. ' +
    'Add a real LLM provider in Settings for unlimited capability.'
  )
}

/**
 * Heuristic inline-edit for demo mode. Takes the selected code (or whole file)
 * plus an instruction and returns edited code. Supports a useful subset of
 * transformations; for everything else it returns the code unchanged with a
 * note. Pair with a real provider for arbitrary edits.
 */
export function demoEdit(
  code: string,
  instruction: string,
  lang: string,
): { code: string; note: string } {
  const q = instruction.toLowerCase()
  const lines = code.split('\n')

  // add comments
  if (/\b(add|write|generate).*\b(comments?|docs?|documentation|jsdoc)\b/.test(q) || q.trim() === 'comment') {
    const out = addComments(lines, lang)
    return { code: out, note: 'Added explanatory comments (demo heuristic).' }
  }
  // remove comments
  if (/\b(remove|strip|delete|clean).*\b(comments?|docs?)\b/.test(q)) {
    const out = lines
      .filter((l) => !/^\s*(\/\/|#|--|\/\*|\*)/.test(l) || /^\s*\*/.test(l))
      .join('\n')
      .replace(/\/\*[\s\S]*?\*\//g, '')
    return { code: out, note: 'Removed comments (demo heuristic).' }
  }
  // add types (TS)
  if (/\b(add|infer|write).*\b(types?|annotations?)\b/.test(q) && lang.startsWith('typescript')) {
    const out = addTsTypes(code)
    return { code: out, note: 'Inferred basic TypeScript types (demo heuristic).' }
  }
  // convert var -> const
  if (/\b(var|replace var).*\b(const|let)\b/.test(q)) {
    return { code: code.replace(/\bvar\s+/g, 'const '), note: 'Replaced `var` with `const`.' }
  }
  // use strict equality
  if (/\b(strict|===).*(equality|equals?)\b/.test(q) || q.includes('== to ===')) {
    return { code: code.replace(/([^=!<>])==([^=])/g, '$1===$2'), note: 'Converted `==` to `===`.' }
  }
  // remove console.log
  if (/\b(remove|strip|delete).*\b(console|log|debug)\b/.test(q)) {
    const out = lines.filter((l) => !/console\.(log|debug|info)\s*\(/.test(l)).join('\n')
    return { code: out, note: 'Removed `console.log` statements.' }
  }
  // uppercase / lowercase
  if (/\buppercase\b/.test(q)) return { code: code.toUpperCase(), note: 'Uppercased.' }
  if (/\blowercase\b/.test(q)) return { code: code.toLowerCase(), note: 'Lowercased.' }
  // sort lines
  if (/\bsort.*(lines?|imports?)\b/.test(q)) return { code: [...lines].sort().join('\n'), note: 'Sorted lines.' }
  // trim trailing whitespace
  if (/\b(trim|clean).*(whitespace|spaces?|trailing)\b/.test(q)) {
    return { code: lines.map((l) => l.replace(/\s+$/, '')).join('\n'), note: 'Trimmed trailing whitespace.' }
  }

  // generic fallback: try simple textual substitution "replace X with Y"
  const rep = instruction.match(/replace\s+["'`]?(.+?)["'`]?\s+with\s+["'`]?(.+?)["'`]?\s*$/i)
  if (rep) {
    const [, from, to] = rep
    if (code.includes(from)) {
      return { code: code.split(from).join(to), note: `Replaced "${from}" with "${to}".` }
    }
  }

  return {
    code,
    note:
      "Demo mode can't do arbitrary edits yet. It supports: add/remove comments, " +
      'add types, var→const, ==→===, remove console.log, sort lines, trim whitespace, ' +
      'and "replace X with Y". Connect a real provider in Settings for full power.',
  }
}

function addComments(lines: string[], lang: string): string {
  const c = lang === 'python' ? '#' : '//'
  const out: string[] = []
  lines.forEach((line, i) => {
    const t = line.trim()
    if (!t) {
      out.push(line)
      return
    }
    if (/^(export\s+)?(async\s+)?function\s+\w+/.test(t)) {
      const name = t.match(/function\s+(\w+)/)?.[1] ?? 'function'
      out.push(`${c} ${name}: ${describeFn(t)}`)
    } else if (/^(export\s+)?class\s+\w+/.test(t)) {
      const name = t.match(/class\s+(\w+)/)?.[1] ?? 'class'
      out.push(`${c} ${name} class definition.`)
    } else if (/^(import|from)\s/.test(t)) {
      out.push(`${c} imports a module.`)
    } else if (/if\s*\(/.test(t) && !t.includes('=')) {
      out.push(`${c} conditional branch.`)
    } else if (/\bfor\s*\(/.test(t)) {
      out.push(`${c} loop.`)
    } else if (/\breturn\b/.test(t)) {
      out.push(`${c} returns a value.`)
    } else {
      out.push(line)
      return
    }
    out.push(line)
  })
  return out.join('\n')
}

function describeFn(sig: string): string {
  if (/async\s+function/.test(sig)) return 'async function (returns a Promise).'
  if (sig.includes('=>')) return 'arrow function.'
  return 'function.'
}

function addTsTypes(code: string): string {
  return code
    .replace(
      /function\s+(\w+)\s*\(([^)]*)\)/g,
      (m, name: string, params: string) => {
        if (params.includes(':')) return m
        const typed = params
          .split(',')
          .map((p: string) => p.trim())
          .filter(Boolean)
          .map((p: string) => `${p}: any`)
          .join(', ')
        return `function ${name}(${typed})`
      },
    )
    .replace(
      /(\bconst|\blet)\s+(\w+)\s*=\s*([^;]+);/g,
      (m, kw: string, name: string, val: string) => {
        if (val.startsWith('"') || val.startsWith("'") || val.startsWith('`')) return `${kw} ${name}: string = ${val};`
        if (/^-?\d+(\.\d+)?$/.test(val.trim())) return `${kw} ${name}: number = ${val};`
        if (val === 'true' || val === 'false') return `${kw} ${name}: boolean = ${val};`
        return m
      },
    )
}

/** Stream a string out word-by-word via callback. */
export async function streamDemo(
  text: string,
  send: (chunk: string) => void,
  signal?: AbortSignal,
) {
  const tokens = text.match(/\S+\s*|\s+/g) ?? [text]
  for (const tk of tokens) {
    if (signal?.aborted) return
    send(tk)
    await new Promise((r) => setTimeout(r, 8 + Math.random() * 22))
  }
}
