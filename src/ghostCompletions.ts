/**
 * Newton Copilot — heuristic inline ghost-text completions.
 *
 * This is a lightweight, fully-offline completion engine that registers with
 * Monaco's InlineCompletionsProvider API. It produces context-aware suggestions
 * using pattern analysis of the current file:
 *
 *  - bracket/brace auto-closing with sensible bodies
 *  - function/class skeleton completion
 *  - console.* / common API completion
 *  - repetition detection (array maps, sequential assignments)
 *  - language-aware snippet expansion (return statements, exports, etc.)
 *  - multi-line block completion
 *
 * Suggestions appear as ghost text and are accepted with Tab.
 * Pair with a real LLM provider for open-ended completions.
 */

import type * as MonacoNs from 'monaco-editor'
import { useStore, providerConfig } from './store'
import type { ProviderConfig } from '../shared/types'

interface CompletionContext {
  textUntilCurrentLine: string
  currentLine: string
  textAfterCurrentLine: string
  fullText: string
  lineNumber: number
  column: number
  language: string
  indent: string
}

/**
 * Build a suggestion (string to insert at the cursor) or null.
 * The suggestion may be multi-line. It should NOT include text the user has
 * already typed on the current line after the cursor.
 */
export function generateCompletion(ctx: CompletionContext): string | null {
  const { currentLine, indent, language } = ctx
  const trimmed = currentLine.trim()
  if (!trimmed) return null

  // Run heuristics in priority order; first match wins.
  return (
    completeBracketClose(ctx) ??
    completeFunctionBody(ctx) ??
    completeClassBody(ctx) ??
    completeControlFlow(ctx) ??
    completeConsole(ctx) ??
    completeImports(ctx) ??
    completeRepetition(ctx) ??
    completeCommonSnippets(ctx) ??
    null
  )
}

// ---------- 1. bracket / brace closing ----------
function completeBracketClose(ctx: CompletionContext): string | null {
  const { currentLine, textAfterCurrentLine } = ctx
  const trimmed = currentLine.trim()
  const afterCursorOnLine = '' // we insert at end of typed content

  // function foo() {  → add closing brace on next line + a line for body
  if (/\{\s*$/.test(trimmed) && !textAfterCurrentLine.trimStart().startsWith('}')) {
    // determine if it's a one-liner arrow or block
    const nextIndent = increaseIndent(ctx.indent)
    // If the line opens a function/if/for/etc, offer a body + close
    if (/(\)|=>|else|try|do)\s*\{?\s*$/.test(trimmed) || /\{\s*$/.test(trimmed)) {
      return `\n${nextIndent}`
    }
  }

  // open paren without close on a call/def line
  if (/\([\w\s,]*$/.test(trimmed) && !trimmed.endsWith(')')) {
    return afterCursorOnLine + ')'
  }

  return null
}

// ---------- 2. function body ----------
function completeFunctionBody(ctx: CompletionContext): string | null {
  const { currentLine, indent, language, textAfterCurrentLine } = ctx
  const trimmed = currentLine.trim()

  // function foo(...) {  OR  const foo = (...) => {
  const fnMatch = trimmed.match(
    /^(export\s+)?(?:async\s+)?(?:function\s+\w+|(?:const|let)\s+\w+\s*=\s*(?:async\s*)?\([^)]*\)\s*=>)\s*\{?\s*$/,
  )
  if (fnMatch && !textAfterCurrentLine.trimStart().startsWith('}')) {
    const isAsync = /async/.test(trimmed)
    const name = trimmed.match(/\b(function|=>)\s*\*?\s*(\w+)/)?.[2]
    const body = buildFunctionBody(ctx, { isAsync, name })
    return body
  }

  // python def
  if (language === 'python' && /^def\s+\w+\s*\([^)]*\)\s*(?:->\s*[\w.]+)?\s*:?\s*$/.test(trimmed)) {
    const ni = ctx.language === 'python' ? increaseIndent(ctx.indent) : increaseIndent(ctx.indent)
    return `\n${ni}pass` // python placeholder; user replaces
  }

  return null
}

function buildFunctionBody(
  ctx: CompletionContext,
  opts: { isAsync: boolean; name?: string },
): string {
  const ni = increaseIndent(ctx.indent)
  const lines: string[] = []
  lines.push('')
  // heuristic: if function name hints at getter/boolean, return a literal
  const name = (opts.name ?? '').toLowerCase()
  if (/^(is|has|can|should|get)/.test(name)) {
    lines.push(`${ni}return ${name.startsWith('is') || name.startsWith('has') ? 'false' : 'null'}`)
  } else if (opts.isAsync) {
    lines.push(`${ni}// TODO: implement`)
    lines.push(`${ni}return await Promise.resolve()`)
  } else {
    lines.push(`${ni}// TODO: implement`)
  }
  lines.push(ctx.indent + '}')
  return lines.join('\n')
}

// ---------- 3. class body ----------
function completeClassBody(ctx: CompletionContext): string | null {
  const { currentLine, indent, textAfterCurrentLine } = ctx
  const trimmed = currentLine.trim()
  if (/^(export\s+)?(default\s+)?(abstract\s+)?class\s+\w+[^{]*\{?\s*$/.test(trimmed)) {
    if (textAfterCurrentLine.trimStart().startsWith('}')) return null
    const ni = increaseIndent(ctx.indent)
    return `\n${ni}constructor() {}\n` + ctx.indent + '}'
  }
  return null
}

// ---------- 4. control flow ----------
function completeControlFlow(ctx: CompletionContext): string | null {
  const { currentLine, indent, textAfterCurrentLine, language } = ctx
  const trimmed = currentLine.trim()
  const py = language === 'python'
  const ni = py ? increaseIndent(ctx.indent) : increaseIndent(ctx.indent)

  // if (...) {  OR  if ...:
  if (/^if\s*\([^)]*\)\s*\{?\s*$/.test(trimmed) && !py) {
    if (textAfterCurrentLine.trimStart().startsWith('}')) return null
    return `\n${ni}`
  }
  if (py && /^if\s+.*:\s*$/.test(trimmed)) return `\n${ni}pass`

  // for (...) {  / for ...:
  if (/^for\s*\([^)]*\)\s*\{?\s*$/.test(trimmed) && !py) {
    if (textAfterCurrentLine.trimStart().startsWith('}')) return null
    return `\n${ni}`
  }
  // while
  if (/^while\s*\([^)]*\)\s*\{?\s*$/.test(trimmed) && !py) {
    return `\n${ni}`
  }
  // else {
  if (/^else\s*\{?\s*$/.test(trimmed) && !py) {
    return `\n${ni}`
  }
  return null
}

// ---------- 5. console.* ----------
function completeConsole(ctx: CompletionContext): string | null {
  const { currentLine } = ctx
  const trimmed = currentLine.trim()
  if (/console\.l$/.test(trimmed)) return 'og('
  if (/console\.$/.test(trimmed)) return 'log('
  if (/console\.log\($/.test(trimmed)) return ');'
  return null
}

// ---------- 6. imports ----------
function completeImports(ctx: CompletionContext): string | null {
  const { currentLine, textAfterCurrentLine, language } = ctx
  const trimmed = currentLine.trim()
  if (language === 'typescript' || language === 'javascript') {
    if (/^import\s+\{?\s*\w*\s*$/.test(trimmed) && !trimmed.includes('from')) {
      return '' // not enough info
    }
  }
  // python: from X import
  if (language === 'python' && /^from\s+\w+(\.\w+)*\s+import\s*$/.test(trimmed)) {
    return ' *'
  }
  return null
}

// ---------- 7. repetition detection ----------
function completeRepetition(ctx: CompletionContext): string | null {
  const { textUntilCurrentLine, currentLine, indent, language } = ctx
  const lines = textUntilCurrentLine.split('\n').filter((l) => l.trim())
  if (lines.length < 2) return null

  const last = currentLine.trim()
  const prev = lines[lines.length - 1].trim()
  const prev2 = lines[lines.length - 2]?.trim()

  // sequential numbered assignments: const a = 1; const b = 2; const c = -> 3;
  const seqMatch = prev.match(/^(\w+)\s*([:=])\s*(\d+)\s*;?$/)
  const lastSeqMatch = last.match(/^(\w+)\s*([:=])\s*(\d+)\s*;?$/)
  if (seqMatch && lastSeqMatch) {
    const num = parseInt(lastSeqMatch[3], 10)
    // detect increment by diff
    const prevNum = parseInt(seqMatch[3], 10)
    const diff = num - prevNum
    if (diff === 1 || diff === -1) {
      // suggest next in sequence
      const baseName = lastSeqMatch[1].replace(/\d+$/, '')
      const idx = parseInt(lastSeqMatch[1].match(/\d+$/)?.[0] ?? '1', 10)
      return `\n${indent}${baseName}${idx + 1} ${lastSeqMatch[2]} ${num + diff};`
    }
  }

  // array method chaining: detect .map( then suggest .filter / .forEach
  if (language !== 'python' && /\.map\(\w+\s*=>\s*\w+\.?\w*\)\s*$/.test(last)) {
    return ''
  }

  // repeated property assignment in object literal
  if (/^\w+:\s*[^,]+,?\s*$/.test(prev) && /^\w+:\s*$/.test(last)) {
    return ' null,'
  }

  return null
}

// ---------- 8. common snippets ----------
function completeCommonSnippets(ctx: CompletionContext): string | null {
  const { currentLine, indent, language } = ctx
  const trimmed = currentLine.trim()
  const ni = increaseIndent(ctx.indent)

  // "return" in ts/js → suggest "return" with placeholder
  if ((language === 'typescript' || language === 'javascript') && /^return\s*$/.test(trimmed)) {
    return ''
  }

  // export default
  if (/^export\s+def$/.test(trimmed)) return 'ault'

  // Blank comment starter
  if (/^\/\/\s*$/.test(trimmed) || /^#\s*$/.test(trimmed)) return 'TODO: '

  // async arrow
  if (/^async\s*\($/.test(trimmed)) return ') => {'

  // try/catch
  if (/^try\s*\{\s*$/.test(trimmed)) {
    return `\n${ni}} catch (e) {\n${ni}  console.error(e)\n${ni}}`
  }

  // jsx: <div> -> </div>
  if (/<(\w+)\s*>\s*$/.test(trimmed) && language !== 'html') {
    const tag = trimmed.match(/<(\w+)/)?.[1]
    if (tag) return `</${tag}>`
  }

  return null
}

// ---------- helpers ----------
function increaseIndent(indent: string): string {
  if (indent.includes('\t')) return indent + '\t'
  return indent + '  '
}

// ---------- LLM completion fetch ----------
/**
 * Most-recent in-flight completion request. Aborted when a newer one starts
 * (e.g. the user kept typing) so we never show stale ghost text.
 */
let pendingLlm: AbortController | null = null

/**
 * Fetch a fill-in-the-middle completion from `/api/complete`.
 * Returns the completion string, or null if unavailable/aborted/empty.
 *
 * Cancellation is tied to Monaco's CancellationToken so abandoned requests
 * (cursor moved away) are aborted promptly.
 */
async function fetchLlmCompletion(
  prefix: string,
  suffix: string,
  language: string,
  path: string,
  cfg: ProviderConfig,
  token: MonacoNs.CancellationToken,
): Promise<string | null> {
  // Abort any previous in-flight request — only the latest cursor position wins.
  if (pendingLlm) pendingLlm.abort()
  const ctrl = new AbortController()
  pendingLlm = ctrl

  // Tie abort to Monaco's cancellation (cursor moved / model disposed).
  const cancelSub = token.onCancellationRequested(() => ctrl.abort())

  // Small leading debounce so rapid keystrokes coalesce into one request.
  await new Promise<void>((resolve) => setTimeout(resolve, 120))
  if (ctrl.signal.aborted) return null

  try {
    const r = await fetch('/api/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: prefix, suffix, language, path, provider: cfg }),
      signal: ctrl.signal,
    })
    if (!r.ok) return null
    const data = await r.json()
    const completion: string = data.completion ?? ''
    return completion.trim() ? completion : null
  } catch {
    return null
  } finally {
    cancelSub.dispose()
    if (pendingLlm === ctrl) pendingLlm = null
  }
}

// ---------- Monaco provider registration ----------
/**
 * Register Newton Copilot as Monaco's inline completions provider.
 *
 * Behavior:
 *  - Always computes a fast, fully-offline heuristic suggestion for instant
 *    feedback and as a guaranteed fallback.
 *  - When a real (non-demo) provider is configured, also requests an LLM
 *    fill-in-the-middle completion from `/api/complete`. If the LLM returns
 *    usable text it is preferred; otherwise the heuristic is shown.
 *
 * Returns a disposable to unregister.
 */
export function registerCopilot(
  monaco: typeof MonacoNs,
  languageIds?: string[],
): MonacoNs.IDisposable {
  const provider: MonacoNs.languages.InlineCompletionsProvider = {
    provideInlineCompletions: async (model, position, _ctx, token) => {
      const languageId = model.getLanguageId()
      // map monaco language id to our simplified language name
      const lang = normalizeLang(languageId)
      const fullText = model.getValue()

      const lineNumber = position.lineNumber
      const column = position.column
      const currentLine = model.getLineContent(lineNumber)
      const cursorOffset = model.getOffsetAt({ lineNumber, column })
      const prefix = fullText.slice(0, cursorOffset)
      const suffix = fullText.slice(cursorOffset)
      const textUntilCurrentLine = fullText.slice(
        0,
        model.getOffsetAt({ lineNumber, column: 1 }) + (column - 1),
      )
      const textAfterCurrentLine = suffix

      const indent = currentLine.match(/^\s*/)?.[0] ?? ''

      const heuristic = generateCompletion({
        textUntilCurrentLine,
        currentLine: currentLine.slice(0, column - 1),
        textAfterCurrentLine,
        fullText,
        lineNumber,
        column,
        language: lang,
        indent,
      })

      const buildItems = (insertText: string): MonacoNs.languages.InlineCompletions => ({
        items: [
          {
            insertText,
            range: {
              startLineNumber: lineNumber,
              startColumn: column,
              endLineNumber: lineNumber,
              endColumn: column,
            },
            // Monaco uses this to decide whether to show; keep stable
            filterText: currentLine.slice(0, column - 1),
          },
        ],
      })

      // Demo mode (or no real provider): heuristic only, shown immediately.
      const cfg = providerConfig(useStore.getState().settings)
      if (cfg.provider === 'demo') {
        if (!heuristic || !heuristic.trim()) return { items: [] }
        return buildItems(heuristic)
      }

      // Real provider: attempt an LLM completion, falling back to heuristic.
      // Skip the network call when there's barely any context to complete.
      const enoughContext = prefix.replace(/\s+$/, '').length >= 3
      if (enoughContext && !token.isCancellationRequested) {
        const path = model.uri.path || model.uri.toString()
        const llm = await fetchLlmCompletion(prefix, suffix, lang, path, cfg, token)
        if (llm && llm.trim()) return buildItems(llm)
      }

      if (!heuristic || !heuristic.trim()) return { items: [] }
      return buildItems(heuristic)
    },
    freeInlineCompletions: () => {
      /* noop */
    },
  }

  const langs = languageIds ?? [
    'typescript',
    'javascript',
    'typescript',
    'python',
    'go',
    'rust',
    'java',
    'cpp',
    'c',
    'php',
    'ruby',
  ]
  const disposables = langs.map((l) => monaco.languages.registerInlineCompletionsProvider(l, provider))

  return {
    dispose: () => disposables.forEach((d) => d.dispose()),
  }
}

function normalizeLang(id: string): string {
  if (id.startsWith('typescript')) return 'typescript'
  if (id.startsWith('javascript')) return 'javascript'
  return id
}
