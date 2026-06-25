import type { ChatMessage } from '../shared/types.js'

/**
 * Newton's built-in "demo" assistant — no API key required.
 *
 * This is NOT a language model. It is a structured, heuristic engine that does
 * real work: it parses the active file, runs deep static analysis, extracts
 * parameters from natural language, and generates parametrized code. It is
 * designed to feel useful out-of-the-box. For arbitrary reasoning, connect a
 * real LLM provider in Settings.
 *
 * Capabilities:
 *  - Deep code review (complexity, nesting, security, perf, anti-patterns)
 *  - Structural explanation that quotes real code
 *  - Parametrized snippet generation (numbers/options parsed from the prompt)
 *  - A broad knowledge base
 *  - Natural, varied phrasing so responses don't feel templated
 *  - Token-by-token streaming
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

// ─────────────────────────── helpers ───────────────────────────

const codeFence = (lang: string, code: string) =>
  '```' + lang + '\n' + code.trim() + '\n```'

function codeFenceWithFile(lang: string, filepath: string, code: string): string {
  const comment = lang === 'python' ? '#' : lang === 'html' || lang === 'xml' ? '<!-- -->' : '//'
  const annotation =
    comment === '<!-- -->' ? `<!-- filepath: ${filepath} -->` : `${comment} filepath: ${filepath}`
  return '```' + lang + '\n' + annotation + '\n' + code.trim() + '\n```'
}

/** Extract a number (with optional unit) from a question, with a fallback. */
function num(question: string, keys: RegExp, fallback: number): number {
  const m = question.match(keys)
  if (!m) return fallback
  const n = parseInt(m[1], 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

/** Pick a random phrasing so responses feel less robotic. */
function vary(variants: string[]): string {
  return variants[Math.floor(Math.random() * variants.length)]
}

/** Pull a quoted or backticked token out of the question. */
function quoted(q: string): string | null {
  return q.match(/["'`]([^"'`]+)["'`]/)?.[1] ?? null
}

// ─────────────────────────── templates ───────────────────────────

interface Template {
  match: RegExp
  lang: string
  filepath: string
  body: (ctx: DemoContext) => string
  intro: (ctx: DemoContext) => string
}

const TEMPLATES: Template[] = [
  {
    match: /\bdebounce\b/i,
    lang: 'ts',
    filepath: 'src/utils/debounce.ts',
    intro: () => vary([
      "Here's a fully typed debounce — it preserves the function signature:",
      'A type-safe debounce that cancels pending calls on each invocation:',
    ]),
    body: (ctx) => {
      const ms = num(ctx.question, /(\d+)\s*(?:ms|millis)/i, 300)
      return `export function debounce<T extends (...args: any[]) => void>(fn: T, ms = ${ms}) {
  let timer: ReturnType<typeof setTimeout>
  return (...args: Parameters<T>) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }
}`
    },
  },
  {
    match: /\bthrottle\b/i,
    lang: 'ts',
    filepath: 'src/utils/throttle.ts',
    intro: () =>
      'A leading-edge throttle — fires immediately, then ignores calls within the window:',
    body: (ctx) => {
      const ms = num(ctx.question, /(\d+)\s*(?:ms|millis)/i, 300)
      return `export function throttle<T extends (...args: any[]) => void>(fn: T, ms = ${ms}) {
  let last = 0
  return (...args: Parameters<T>) => {
    const now = Date.now()
    if (now - last >= ms) {
      last = now
      fn(...args)
    }
  }
}`
    },
  },
  {
    match: /\b(usestate|react.*state|counter.*component)\b/i,
    lang: 'tsx',
    filepath: 'src/components/Counter.tsx',
    intro: () => 'A minimal React counter using `useState`:',
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
    match: /\b(useeffect|react.*effect)\b/i,
    lang: 'tsx',
    filepath: 'src/hooks/useWindowSize.ts',
    intro: () => 'A `useEffect` hook that subscribes to window resize and cleans up:',
    body: () =>
      `import { useEffect, useState } from 'react'

export function useWindowSize() {
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight })
  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return size
}`,
  },
  {
    match: /\b(usememo|usecallback|memoiz.*hook)\b/i,
    lang: 'tsx',
    filepath: 'src/hooks/useSorted.ts',
    intro: () => '`useMemo` to avoid re-sorting on every render unless the input changes:',
    body: () =>
      `import { useMemo } from 'react'

export function useSorted<T>(items: T[], compare?: (a: T, b: T) => number) {
  return useMemo(
    () => [...items].sort(compare ?? ((a: any, b: any) => (a > b ? 1 : a < b ? -1 : 0))),
    [items, compare],
  )
}`,
  },
  {
    match: /\b(fetch|http get|api request|api call)\b/i,
    lang: 'ts',
    filepath: 'src/utils/getJSON.ts',
    intro: () => 'A typed fetch wrapper that throws on non-OK responses:',
    body: () =>
      `export async function getJSON<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(\`HTTP \${res.status}: \${res.statusText}\`)
  return res.json() as Promise<T>
}`,
  },
  {
    match: /\b(fetch.*retry|retry.*fetch)\b/i,
    lang: 'ts',
    filepath: 'src/utils/fetchRetry.ts',
    intro: () => 'Fetch with exponential backoff retry:',
    body: (ctx) => {
      const tries = num(ctx.question, /(\d+)\s*(?:retries|tries|attempts)/i, 3)
      return `export async function fetchRetry(url: string, opts: RequestInit = {}, retries = ${tries}): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, opts)
      if (!res.ok && attempt < retries) throw new Error(\`HTTP \${res.status}\`)
      return res
    } catch (err) {
      if (attempt === retries) throw err
      const backoff = Math.pow(2, attempt) * 200
      await new Promise((r) => setTimeout(r, backoff))
    }
  }
  throw new Error('unreachable')
}`
    },
  },
  {
    match: /\bexpress\s+(server|route|api|app)\b/i,
    lang: 'ts',
    filepath: 'server.ts',
    intro: () => 'A minimal Express server with a health route:',
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
    intro: () => 'A concise, purely-functional quicksort:',
    body: () =>
      `export function quicksort(arr: number[]): number[] {
  if (arr.length <= 1) return arr
  const [pivot, ...rest] = arr
  const left = rest.filter((x) => x < pivot)
  const right = rest.filter((x) => x >= pivot)
  return [...quicksort(left), pivot, ...quicksort(right)]
}`,
  },
  {
    match: /\b(binary search|binarysearch)\b/i,
    lang: 'ts',
    filepath: 'src/searching/binarySearch.ts',
    intro: () => 'Iterative binary search — O(log n):',
    body: () =>
      `export function binarySearch(arr: number[], target: number): number {
  let lo = 0, hi = arr.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (arr[mid] === target) return mid
    if (arr[mid] < target) lo = mid + 1
    else hi = mid - 1
  }
  return -1
}`,
  },
  {
    match: /\b(mergesort|merge sort)\b/i,
    lang: 'ts',
    filepath: 'src/sorting/mergeSort.ts',
    intro: () => 'Stable merge sort — O(n log n):',
    body: () =>
      `export function mergeSort(arr: number[]): number[] {
  if (arr.length <= 1) return arr
  const mid = arr.length >> 1
  const left = mergeSort(arr.slice(0, mid))
  const right = mergeSort(arr.slice(mid))
  const out: number[] = []
  let i = 0, j = 0
  while (i < left.length && j < right.length) {
    out.push(left[i] <= right[j] ? left[i++] : right[j++])
  }
  return [...out, ...left.slice(i), ...right.slice(j)]
}`,
  },
  {
    match: /\b(memoize|memoisation|memoization)\b/i,
    lang: 'ts',
    filepath: 'src/utils/memoize.ts',
    intro: () => 'A generic memoizer keyed on argument JSON:',
    body: () =>
      `export function memoize<Args extends unknown[], R>(fn: (...args: Args) => R) {
  const cache = new Map<string, R>()
  return (...args: Args): R => {
    const key = JSON.stringify(args)
    if (cache.has(key)) return cache.get(key)!
    const result = fn(...args)
    cache.set(key, result)
    return result
  }
}`,
  },
  {
    match: /\b(curry|currying)\b/i,
    lang: 'ts',
    filepath: 'src/utils/curry.ts',
    intro: () => 'A type-relaxed curry that accumulates args until satisfied:',
    body: () =>
      `export function curry(fn: Function): Function {
  return function curried(...args: any[]) {
    if (args.length >= fn.length) return fn(...args)
    return (...more: any[]) => curried(...args, ...more)
  }
}`,
  },
  {
    match: /\b(compose|pipeline|pipe function)\b/i,
    lang: 'ts',
    filepath: 'src/utils/compose.ts',
    intro: () => 'Left-to-right `pipe` and right-to-left `compose`:',
    body: () =>
      `export const pipe = <T>(...fns: ((x: T) => T)[]) =>
  (x: T) => fns.reduce((v, f) => f(v), x)

export const compose = <T>(...fns: ((x: T) => T)[]) =>
  (x: T) => fns.reduceRight((v, f) => f(v), x)`,
  },
  {
    match: /\b(event emitter|eventemitter|pub.?sub|event bus)\b/i,
    lang: 'ts',
    filepath: 'src/utils/EventEmitter.ts',
    intro: () => 'A tiny typed event emitter with `on`/`off`/`emit`:',
    body: () =>
      `type Handler = (...args: any[]) => void

export class EventEmitter {
  private handlers = new Map<string, Set<Handler>>()

  on(event: string, fn: Handler) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set())
    this.handlers.get(event)!.add(fn)
    return () => this.off(event, fn)
  }

  off(event: string, fn: Handler) {
    this.handlers.get(event)?.delete(fn)
  }

  emit(event: string, ...args: any[]) {
    this.handlers.get(event)?.forEach((fn) => fn(...args))
  }
}`,
  },
  {
    match: /\b(singleton pattern|singleton class)\b/i,
    lang: 'ts',
    filepath: 'src/patterns/Singleton.ts',
    intro: () => 'A thread-of-event-loop-safe singleton:',
    body: () =>
      `export class Singleton {
  private static instance: Singleton
  private constructor() {}

  static getInstance() {
    if (!Singleton.instance) Singleton.instance = new Singleton()
    return Singleton.instance
  }
}`,
  },
  {
    match: /\b(linked list)\b/i,
    lang: 'ts',
    filepath: 'src/data/LinkedList.ts',
    intro: () => 'A singly linked list with push/insert/remove:',
    body: () =>
      `export class Node<T> {
  constructor(public value: T, public next: Node<T> | null = null) {}
}

export class LinkedList<T> {
  private head: Node<T> | null = null
  private _size = 0

  get size() { return this._size }

  push(value: T) {
    const node = new Node(value)
    if (!this.head) this.head = node
    else {
      let cur = this.head
      while (cur.next) cur = cur.next
      cur.next = node
    }
    this._size++
  }

  remove(value: T) {
    if (!this.head) return
    if (this.head.value === value) { this.head = this.head.next; this._size--; return }
    let cur = this.head
    while (cur.next) {
      if (cur.next.value === value) { cur.next = cur.next.next; this._size--; return }
      cur = cur.next
    }
  }
}`,
  },
  {
    match: /\b(sleep|wait.*promise|delay.*promise|promise.*delay)\b/i,
    lang: 'ts',
    filepath: 'src/utils/sleep.ts',
    intro: () => 'A one-liner promise-based sleep:',
    body: (ctx) => {
      const ms = num(ctx.question, /(\d+)\s*(?:ms|millis|seconds?|s)\b/i, 1000)
      return `export const sleep = (ms = ${ms}) => new Promise<void>((resolve) => setTimeout(resolve, ms))`
    },
  },
  {
    match: /\b(deep clone|deepcopy|deep copy|structured clone)\b/i,
    lang: 'ts',
    filepath: 'src/utils/deepClone.ts',
    intro: () => 'A robust deep clone (handles dates, maps, sets, arrays):',
    body: () =>
      `export function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') return obj
  if (obj instanceof Date) return new Date(obj.getTime()) as any
  if (obj instanceof Map) return new Map(Array.from(obj, ([k, v]) => [k, deepClone(v)])) as any
  if (obj instanceof Set) return new Set(Array.from(obj, (v) => deepClone(v))) as any
  if (Array.isArray(obj)) return obj.map(deepClone) as any
  const copy: Record<string, any> = {}
  for (const key in obj) if (obj.hasOwnProperty(key)) copy[key] = deepClone((obj as any)[key])
  return copy as any
}`,
  },
]

// ─────────────────────────── knowledge base ───────────────────────────

const KB: { match: RegExp; answer: string }[] = [
  {
    match: /\b(what is|what's).*newton\b/i,
    answer:
      "Newton is an AI-native code editor — a web-based alternative to Cursor. " +
      'It bundles the Monaco editor, a file explorer, and an AI assistant that can ' +
      'stream answers, review your code, and generate snippets. ' +
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
  {
    match: /\b(what is|explain).*(closure|closures)\b/i,
    answer:
      'A **closure** is a function that remembers the variables from the scope in which it was ' +
      'defined, even after that scope has exited. Closures are how JS achieves data privacy ' +
      '(the module pattern) and how you build factories like `makeAdder(x)`.',
  },
  {
    match: /\b(what is|explain).*(event loop)\b/i,
    answer:
      'The **event loop** is JavaScript\'s concurrency model. It processes the call stack to ' +
      'completion, then drains the microtask queue (Promises, `queueMicrotask`), then one ' +
      'macrotask (timers, I/O), then repeats. This is why `setTimeout` callbacks run *after* ' +
      'synchronous code and resolved Promise `.then` handlers.',
  },
  {
    match: /\b(difference|==.*===).*(==.*===)\b/i,
    answer:
      '`==` performs **type coercion** (so `"0" == 0` is `true`); `===` checks **strict equality** ' +
      'without coercion. Always prefer `===` / `!==` to avoid the footguns of coercion.',
  },
  {
    match: /\b(what is|explain).*(promise|promises)\b/i,
    answer:
      'A **Promise** represents a value that may not be available yet. It is in one of three ' +
      'states: pending → fulfilled (with a value) or rejected (with a reason). Chain `.then`/' +
      '`.catch`/`.finally`, or consume with `await`. Use `Promise.all` for parallel work and ' +
      '`Promise.allSettled` when you want to tolerate failures.',
  },
  {
    match: /\b(what is|explain).*recursion\b/i,
    answer:
      '**Recursion** is when a function calls itself. Every recursive solution needs a *base case* ' +
      '(to stop) and a *recursive case* (to make progress toward it). Watch for stack overflow on ' +
      'deep recursion in JS — convert to iteration or use trampolining for unbounded depth.',
  },
  {
    match: /\b(what is|explain).*(big o|time complexity|complexity)\b/i,
    answer:
      '**Big O** describes how an algorithm\'s runtime grows with input size *n*. Common orders ' +
      'from best to worst: `O(1)` < `O(log n)` < `O(n)` < `O(n log n)` < `O(n²)` < `O(2ⁿ)`. ' +
      'It ignores constants and lower-order terms, focusing on the dominant growth factor.',
  },
  {
    match: /\b(what is|explain).*typescript\b/i,
    answer:
      '**TypeScript** is a statically-typed superset of JavaScript. It adds optional types that are ' +
      'erased at compile time, producing plain JS. Types catch bugs before runtime and power great ' +
      'editor tooling. Start with `tsc` to type-check and emit JS.',
  },
  {
    match: /\b(difference|node.*browser|browser.*node)\b/i,
    answer:
      '**Node.js** runs JS on the server using V8; it provides `fs`, `http`, `process`, and a ' +
      'module system (CommonJS/ESM), but no DOM. **Browsers** run JS with a DOM, `window`, ' +
      '`localStorage`, and strict security sandboxing. Code that touches the DOM won\'t run in Node, ' +
      'and code using `fs` won\'t run in the browser without a shim.',
  },
]

// ─────────────────────────── rules ───────────────────────────

const RULES: Rule[] = [
  {
    match: (q) => TEMPLATES.some((t) => t.match.test(q)),
    respond: (ctx) => {
      const tpl = TEMPLATES.find((t) => t.match.test(ctx.question))!
      return (
        `${tpl.intro(ctx)}\n\n` +
        codeFenceWithFile(tpl.lang, tpl.filepath, tpl.body(ctx)) +
        '\n\nClick **Apply** to save this as a file, or ask for a variant — tests, a different language, or wiring it into your existing code.'
      )
    },
  },
  {
    match: (q) =>
      /\b(explain|what does|walk me through|how does|review|improve|bug|fix|issue|problem|refactor|optimize|clean up|analyze|lint)\b/i.test(
        q,
      ),
    respond: (ctx) => reviewCode(ctx),
  },
  {
    match: (q) => KB.some((k) => k.match.test(q)),
    respond: (ctx) => KB.find((k) => k.match.test(ctx.question))!.answer,
  },
  {
    match: (q) => /\b(hello|hi|hey|yo|sup|howdy)\b/i.test(q) && ctxIsShort(q),
    respond: () =>
      "Hey! 👋 I'm Newton's built-in assistant. I can **explain code**, **review** for bugs and " +
      "improvements, **generate** common snippets, and **answer** programming questions. Ask me " +
      "to *review this file* or *write a debounce function* — or add a real LLM provider in Settings " +
      'for unlimited capability.',
  },
]

function ctxIsShort(s: string) {
  return s.trim().split(/\s+/).length <= 4
}

// ─────────────────────────── review & analysis ───────────────────────────

function reviewCode(ctx: DemoContext): string {
  const file = ctx.activeFile
  const wantsReview = /\b(review|improve|bug|fix|issue|problem|refactor|optimize|clean up|lint)\b/i.test(
    ctx.question,
  )

  if (!file || !file.content.trim()) {
    return wantsReview
      ? "I'd be happy to review — but there's no active file in the editor. " +
          'Open or paste some code, then ask me to review it. I check for type smells, missing error ' +
          'handling, leftover debugging, security issues, complexity, and more.'
      : 'Sure! Could you open a file or paste some code first? I can then explain it, find bugs, or suggest improvements.'
  }

  const lang = inferLang(file.path)
  const lines = file.content.split('\n')
  const analysis = analyze(file.content, lang)

  let out = `### \`${file.path}\`\n\n`
  out += `**${lines.length} lines** · ${lang}\n\n`
  out += `**Summary:** ${analysis.summary}\n\n`

  if (analysis.complexity.max > 8) {
    out += `**Complexity:** the most complex function is \`${analysis.complexity.worstFn}\` at ` +
      `cyclomatic complexity **${analysis.complexity.max}** — consider breaking it up.\n\n`
  }

  if (analysis.issues.length === 0) {
    out += '✅ **No issues detected** by the static checks. '
    out += wantsReview
      ? 'This is heuristic — for a deeper architectural review, connect a real LLM provider.\n\n'
      : '\n\n'
  } else {
    out += `**Found ${analysis.issues.length} issue${analysis.issues.length > 1 ? 's' : ''}:**\n\n`
    for (const it of analysis.issues.slice(0, 15)) out += `- ${it}\n`
    if (analysis.issues.length > 15) out += `- …and ${analysis.issues.length - 15} more\n`
    out += '\n'
    if (analysis.autoFixable > 0) {
      out += `💡 ${analysis.autoFixable} of these can be auto-fixed with inline AI edit ` +
        '(e.g. "convert == to ===" or "remove console.log").\n\n'
    }
  }

  if (analysis.functions.length) {
    out += '**Functions detected:**\n'
    for (const f of analysis.functions.slice(0, 8)) out += `- \`${f.signature}\` — ${f.purpose}\n`
    out += '\n'
  }

  if (/\b(explain|walk me through|how does)\b/i.test(ctx.question)) {
    out += `**Walkthrough:**\n${explainWalkthrough(file.content)}`
  }

  return out.trim()
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
      c: 'c',
      cpp: 'c++',
      cs: 'c#',
      md: 'markdown',
      json: 'json',
      html: 'html',
      css: 'css',
    }[ext] ?? 'text'
  )
}

interface Analysis {
  issues: string[]
  autoFixable: number
  summary: string
  complexity: { max: number; worstFn: string }
  functions: { signature: string; purpose: string }[]
}

function analyze(src: string, lang: string): Analysis {
  const issues: string[] = []
  let autoFixable = 0
  const lines = src.split('\n')
  const isJsLike = ['typescript', 'javascript'].includes(lang)

  // Per-line checks
  lines.forEach((line, i) => {
    const n = i + 1
    const trimmed = line.trim()

    if (isJsLike && /:\s*any\b/.test(line)) {
      issues.push(`Line ${n}: \`any\` type — replace with a specific type.`)
    }
    if (isJsLike && /console\.(log|debug)\s*\(/.test(line) && !isCommented(line)) {
      issues.push(`Line ${n}: leftover \`console.log\` — remove before shipping.`)
      autoFixable++
    }
    if (isJsLike && /\bvar\s+/.test(line)) {
      issues.push(`Line ${n}: \`var\` — prefer \`let\`/\`const\`.`)
      autoFixable++
    }
    if (isJsLike && /[^=!<>]==[^=]/.test(line)) {
      issues.push(`Line ${n}: loose \`==\`/\`!=\` — use strict \`===\`/\`!==\`.`)
      autoFixable++
    }
    if (/\b(eval|Function)\s*\(/.test(line)) {
      issues.push(`Line ${n}: \`eval\`/\`Function()\` is a code-injection risk.`)
    }
    if (/TODO|FIXME|XXX/.test(line)) {
      issues.push(`Line ${n}: unresolved TODO/FIXME.`)
    }
    if (lang === 'python' && /\bprint\s*\(/.test(trimmed)) {
      issues.push(`Line ${n}: \`print()\` — use \`logging\` in production.`)
    }
    if (isJsLike && /catch\s*\([^)]*\)\s*\{\s*\}/.test(trimmed)) {
      issues.push(`Line ${n}: empty \`catch\` — silently swallows errors.`)
    }
    if (isJsLike && /catch\s*\(/.test(line) && !/catch\s*\(\s*\w+\s*\)/.test(line)) {
      issues.push(`Line ${n}: \`catch\` without binding — consider \`catch (e)\` to log the error.`)
    }
    if (/password|secret|api[_-]?key|token/i.test(line) && /=\s*["'][^"']{6,}["']/.test(line)) {
      issues.push(`Line ${n}: **possible hardcoded secret** — move to an env var.`)
    }
    if (isJsLike && /\bsetTimeout\s*\([^,]+,\s*\b0\b/.test(line)) {
      issues.push(`Line ${n}: \`setTimeout(..., 0)\` — prefer \`queueMicrotask\` or \`Promise.resolve\`.`)
    }
    if (isJsLike && /\.forEach\s*\(\s*async/.test(line)) {
      issues.push(`Line ${n}: \`async\` inside \`forEach\` won't be awaited — use \`for…of\` or \`Promise.all\`.`)
    }
    if (/\b(document\.write|innerHTML)\b/.test(line)) {
      issues.push(`Line ${n}: \`${trimmed.includes('innerHTML') ? 'innerHTML' : 'document.write'}\` — XSS risk; use textContent or sanitization.`)
    }
    if (lang === 'typescript' && /\bexport\s+default\s+function\s*\(/.test(trimmed)) {
      issues.push(`Line ${n}: anonymous default export — naming it aids stack traces and refactoring.`)
    }
    if (trimmed.length > 120) {
      issues.push(`Line ${n}: line is ${trimmed.length} chars — consider wrapping for readability.`)
    }
  })

  // Bracket balance
  const noStrings = src.replace(/(["'`])(?:\\.|(?!\1).)*\1/g, '""')
  const open = (noStrings.match(/\{/g) || []).length
  const close = (noStrings.match(/\}/g) || []).length
  if (open !== close) issues.push(`Brace mismatch: ${open} \`{\` vs ${close} \`}\`.`)
  const po = (noStrings.match(/\(/g) || []).length
  const pc = (noStrings.match(/\)/g) || []).length
  if (po !== pc) issues.push(`Paren mismatch: ${po} \`(\` vs ${pc} \`)\`).`)

  // Cyclomatic complexity
  const fns = extractFunctions(src, lang)
  let max = 0
  let worstFn = '—'
  for (const f of fns) {
    const body = f.body
    const complexity =
      1 +
      (body.match(/\bif\b/g) || []).length +
      (body.match(/\bfor\b/g) || []).length +
      (body.match(/\bwhile\b/g) || []).length +
      (body.match(/\bcase\b/g) || []).length +
      (body.match(/&&|\|\||\?[^.]/g) || []).length
    if (complexity > max) {
      max = complexity
      worstFn = f.name
    }
  }

  return {
    issues,
    autoFixable,
    summary: summarize(src, lang),
    complexity: { max, worstFn },
    functions: fns.slice(0, 8).map((f) => ({ signature: f.signature, purpose: describeFunction(f) })),
  }
}

function isCommented(line: string): boolean {
  return /^\s*(\/\/|#)/.test(line)
}

interface Fn {
  name: string
  signature: string
  body: string
}

function extractFunctions(src: string, lang: string): Fn[] {
  const out: Fn[] = []
  if (['typescript', 'javascript'].includes(lang)) {
    const re =
      /(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\s+(\w+)|const\s+(\w+)\s*=\s*(?:async\s*)?\(?[^=]*=>)\s*(\([^)]*\))?/g
    let m: RegExpExecArray | null
    while ((m = re.exec(src))) {
      const name = m[1] || m[2]
      const start = m.index
      const after = src.slice(start)
      const body = extractBalanced(after) ?? after.slice(0, 200)
      out.push({ name: name ?? 'anonymous', signature: firstLine(after), body })
    }
  } else if (lang === 'python') {
    const re = /def\s+(\w+)\s*\(([^)]*)\)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(src))) {
      const start = m.index
      const after = src.slice(start)
      out.push({ name: m[1], signature: firstLine(after), body: after.slice(0, 300) })
    }
  }
  return out
}

/** Grab the first `{ ... }` balanced block from a string, or null. */
function extractBalanced(s: string): string | null {
  const start = s.indexOf('{')
  if (start < 0) return null
  let depth = 0
  for (let i = start; i < s.length; i++) {
    if (s[i] === '{') depth++
    else if (s[i] === '}') {
      depth--
      if (depth === 0) return s.slice(0, i + 1)
    }
  }
  return null
}

function firstLine(s: string): string {
  return s.split('\n')[0].trim().replace(/\{$/, '').trim() + (s.includes('{') ? ' { … }' : '')
}

function describeFunction(f: Fn): string {
  const b = f.body
  if (/async\b/.test(b) || /\bawait\b/.test(b)) return 'async — performs asynchronous work.'
  if (/\breturn\b/.test(b) && /\(/.test(b)) return 'returns a value (likely a computation or lookup).'
  if (/console\.log/.test(b)) return 'side-effectful — logs to the console.'
  if (/fetch\(|axios/.test(b)) return 'performs a network request.'
  if (/\bthrow\b/.test(b)) return 'validates input and throws on invalid state.'
  if (/\.map\(|\.filter\(|\.reduce\(/.test(b)) return 'transforms a collection with array methods.'
  return 'utility / helper.'
}

function summarize(src: string, lang: string): string {
  const fns = extractFunctions(src, lang).map((f) => f.name)
  const classes = [...src.matchAll(/class\s+(\w+)/g)].map((m) => m[1])
  const imports = (src.match(/^\s*import\s+/gm) || []).length
  const parts: string[] = []
  if (imports) parts.push(`${imports} import${imports > 1 ? 's' : ''}`)
  if (classes.length) parts.push(`class${classes.length > 1 ? 'es' : ''} \`${classes.join('`, `')}\``)
  if (fns.length)
    parts.push(`function${fns.length > 1 ? 's' : ''} \`${fns.slice(0, 6).join('`, `')}${fns.length > 6 ? '…' : ''}\``)
  return parts.length ? parts.join(', ') + '.' : 'No top-level symbols detected.'
}

function explainWalkthrough(src: string): string {
  const lines = src.split('\n')
  const bullets: string[] = []
  lines.forEach((line, i) => {
    const t = line.trim()
    if (/^(export\s+)?(async\s+)?function/.test(t)) {
      const name = t.match(/function\s+(\w+)/)?.[1] ?? 'anonymous'
      bullets.push(`• Line ${i + 1}: defines \`${name}\`.`)
    } else if (/^(export\s+)?class/.test(t)) {
      const name = t.match(/class\s+(\w+)/)?.[1] ?? 'class'
      bullets.push(`• Line ${i + 1}: declares class \`${name}\`.`)
    } else if (/^(import|from)\s/.test(t)) {
      bullets.push(`• Line ${i + 1}: imports a module.`)
    } else if (/^\s*(const|let|var)\s+\w+\s*=/.test(t) && bullets.length < 12) {
      const name = t.match(/(const|let|var)\s+(\w+)/)?.[2] ?? 'variable'
      bullets.push(`• Line ${i + 1}: declares \`${name}\`.`)
    } else if (/if\s*\(/.test(t) && bullets.length < 14) {
      bullets.push(`• Line ${i + 1}: a conditional branch.`)
    } else if (/\bfor\s*\(/.test(t) && bullets.length < 14) {
      bullets.push(`• Line ${i + 1}: a loop.`)
    } else if (/\breturn\b/.test(t) && bullets.length < 14) {
      bullets.push(`• Line ${i + 1}: returns a value.`)
    }
  })
  return bullets.length ? bullets.join('\n') : 'No high-level structure markers found.'
}

// ─────────────────────────── entry points ───────────────────────────

export function demoAnswer(messages: ChatMessage[], activeFile: DemoContext['activeFile']): string {
  const last = [...messages].reverse().find((m) => m.role === 'user')
  const question = last?.content?.trim() ?? '...'
  const ctx: DemoContext = { question, activeFile, history: messages }

  for (const rule of RULES) {
    if (rule.match(question)) return rule.respond(ctx)
  }

  // Fallback: if there's an open file, default to a review.
  if (activeFile?.content.trim()) {
    return reviewCode(ctx)
  }
  return (
    "I'm Newton's built-in demo assistant. I can:\n\n" +
    '- **Explain / review** the open file — I run real static analysis (complexity, security, bugs)\n' +
    '- **Generate** code from templates (debounce, fetch, hooks, sorts, data structures, patterns…)\n' +
    '- **Answer** programming questions (closures, the event loop, Big-O, async/await…)\n\n' +
    'Try: *"review this file"*, *"write a debounce for 500ms"*, or *"explain the event loop"`. ' +
    'Add a real LLM provider in Settings for unlimited capability.'
  )
}

/**
 * Heuristic inline edit for demo mode. Supports a useful set of transformations;
 * returns code unchanged with a note for anything it can't handle.
 */
export function demoEdit(code: string, instruction: string, lang: string): { code: string; note: string } {
  const q = instruction.toLowerCase()
  const lines = code.split('\n')

  if (/\b(add|write|generate).*\b(comments?|docs?|documentation|jsdoc)\b/.test(q) || q.trim() === 'comment') {
    return { code: addComments(lines, lang), note: 'Added explanatory comments.' }
  }
  if (/\b(remove|strip|delete|clean).*\b(comments?|docs?)\b/.test(q)) {
    const out = lines
      .filter((l) => !/^\s*(\/\/|#|--)/.test(l))
      .join('\n')
      .replace(/\/\*[\s\S]*?\*\//g, '')
    return { code: out, note: 'Removed comments.' }
  }
  if (/\b(add|infer|write).*\b(types?|annotations?)\b/.test(q) && lang.startsWith('typescript')) {
    return { code: addTsTypes(code), note: 'Inferred basic TypeScript types.' }
  }
  if (/\b(var|replace var).*\b(const|let)\b/.test(q)) {
    return { code: code.replace(/\bvar\s+/g, 'const '), note: 'Replaced `var` with `const`.' }
  }
  if (/\b(strict|===).*(equality|equals?)\b/.test(q) || q.includes('== to ===')) {
    return { code: code.replace(/([^=!<>])==([^=])/g, '$1===$2'), note: 'Converted `==` to `===`.' }
  }
  if (/\b(remove|strip|delete).*\b(console|log|debug)\b/.test(q)) {
    const out = lines.filter((l) => !/console\.(log|debug|info)\s*\(/.test(l)).join('\n')
    return { code: out, note: 'Removed `console.log` statements.' }
  }
  if (/\buppercase\b/.test(q)) return { code: code.toUpperCase(), note: 'Uppercased.' }
  if (/\blowercase\b/.test(q)) return { code: code.toLowerCase(), note: 'Lowercased.' }
  if (/\bsort.*(lines?|imports?)\b/.test(q)) return { code: [...lines].sort().join('\n'), note: 'Sorted lines.' }
  if (/\b(trim|clean).*(whitespace|spaces?|trailing)\b/.test(q)) {
    return { code: lines.map((l) => l.replace(/\s+$/, '')).join('\n'), note: 'Trimmed trailing whitespace.' }
  }
  if (/\b(format|prettier|indent)\b/.test(q)) {
    return { code: lines.map((l) => l.replace(/\t/g, '  ')).join('\n'), note: 'Normalized indentation to 2 spaces.' }
  }

  const rep = instruction.match(/replace\s+["'`]?(.+?)["'`]?\s+with\s+["'`]?(.+?)["'`]?\s*$/i)
  if (rep) {
    const [, from, to] = rep
    if (code.includes(from)) return { code: code.split(from).join(to), note: `Replaced "${from}" with "${to}".` }
  }

  return {
    code,
    note:
      "Demo mode can't do this edit yet. It supports: add/remove comments, add types, var→const, " +
      '==→===, remove console.log, sort/trim lines, and "replace X with Y". Connect a real provider for full power.',
  }
}

// ─────────────────────────── edit helpers ───────────────────────────

function addComments(lines: string[], lang: string): string {
  const c = lang === 'python' ? '#' : '//'
  const out: string[] = []
  lines.forEach((line) => {
    const t = line.trim()
    if (!t) { out.push(line); return }
    let comment: string | null = null
    if (/^(export\s+)?(async\s+)?function\s+\w+/.test(t)) {
      const name = t.match(/function\s+(\w+)/)?.[1] ?? 'function'
      comment = `${name}: ${/async/.test(t) ? 'async function (returns a Promise)' : 'function'}`
    } else if (/^(export\s+)?class\s+\w+/.test(t)) {
      comment = `${t.match(/class\s+(\w+)/)?.[1]} class definition`
    } else if (/^(import|from)\s/.test(t)) {
      comment = 'imports a module'
    } else if (/if\s*\(/.test(t) && !t.includes('=')) {
      comment = 'conditional branch'
    } else if (/\bfor\s*\(/.test(t)) {
      comment = 'loop'
    } else if (/\breturn\b/.test(t)) {
      comment = 'returns a value'
    }
    if (comment) out.push(`${c} ${comment}`)
    out.push(line)
  })
  return out.join('\n')
}

function addTsTypes(code: string): string {
  return code
    .replace(/function\s+(\w+)\s*\(([^)]*)\)/g, (m, name: string, params: string) => {
      if (params.includes(':')) return m
      const typed = params
        .split(',')
        .map((p: string) => p.trim())
        .filter(Boolean)
        .map((p: string) => `${p}: any`)
        .join(', ')
      return `function ${name}(${typed})`
    })
    .replace(/(\bconst|\blet)\s+(\w+)\s*=\s*([^;]+);/g, (m, kw: string, name: string, val: string) => {
      if (/^["'`]/.test(val.trim())) return `${kw} ${name}: string = ${val};`
      if (/^-?\d+(\.\d+)?$/.test(val.trim())) return `${kw} ${name}: number = ${val};`
      if (val.trim() === 'true' || val.trim() === 'false') return `${kw} ${name}: boolean = ${val};`
      return m
    })
}

/** Stream a string out word-by-word via callback. */
export async function streamDemo(text: string, send: (chunk: string) => void, signal?: AbortSignal) {
  const tokens = text.match(/\S+\s*|\s+/g) ?? [text]
  for (const tk of tokens) {
    if (signal?.aborted) return
    send(tk)
    await new Promise((r) => setTimeout(r, 8 + Math.random() * 22))
  }
}
