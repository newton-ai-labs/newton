import type * as monaco from 'monaco-editor'
import type { Monaco } from './monacoTypes'

type MonacoEditor = monaco.editor.IStandaloneCodeEditor

export interface DetectedSymbol {
  name: string
  kind: string
  startLine: number
  endLine: number
}

export type CodeLensAction = 'explain' | 'refactor' | 'tests'

/** Regex patterns for common function/class/method declarations across languages. */
const PATTERNS: { re: RegExp; kind: string }[] = [
  { re: /^\s*(export\s+)?(default\s+)?(async\s+)?function\s+(\w+)/, kind: 'function' },
  { re: /^\s*(export\s+)?(const|let|var)\s+(\w+)\s*=\s*(async\s*)?\(/, kind: 'function' },
  { re: /^\s*(export\s+)?(const|let|var)\s+(\w+)\s*=\s*(async\s*)?function\b/, kind: 'function' },
  { re: /^\s*(export\s+)?(default\s+)?(abstract\s+)?class\s+(\w+)/, kind: 'class' },
  { re: /^\s*(async\s+)?def\s+(\w+)/, kind: 'function' },
  { re: /^\s*class\s+(\w+)/, kind: 'class' },
  { re: /^\s*func\s+(?:\([^)]*\)\s+)?(\w+)/, kind: 'function' },
  { re: /^\s*(pub\s+)?fn\s+(\w+)/, kind: 'function' },
  { re: /^\s*(public|private|protected|static|async|\s)+\s+(\w+)\s*\(/, kind: 'method' },
]

function extractName(text: string): { name: string; kind: string } | null {
  // skip comment / blank lines
  const trimmed = text.trim()
  if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('/*') || trimmed.startsWith('*') || trimmed.startsWith('<!--')) {
    return null
  }
  for (const p of PATTERNS) {
    const m = p.re.exec(text)
    if (m) {
      // the captured group with the name is typically the last group
      const nameGroup = m[m.length - 1]
      if (nameGroup && /^\w+$/.test(nameGroup)) {
        return { name: nameGroup, kind: p.kind }
      }
    }
  }
  return null
}

/**
 * Scan a Monaco model for top-level-ish symbol declarations.
 * Returns symbols with their start/end line ranges.
 */
export function detectSymbols(model: monaco.editor.ITextModel): DetectedSymbol[] {
  const lineCount = model.getLineCount()
  const starts: DetectedSymbol[] = []

  for (let i = 1; i <= lineCount; i++) {
    const text = model.getLineContent(i)
    const hit = extractName(text)
    if (hit) {
      starts.push({ name: hit.name, kind: hit.kind, startLine: i, endLine: i })
    }
  }

  // fill in endLine = line before the next symbol (or EOF)
  for (let idx = 0; idx < starts.length; idx++) {
    const next = starts[idx + 1]
    starts[idx].endLine = next ? next.startLine - 1 : lineCount
  }

  // cap to avoid perf issues in very large files
  return starts.slice(0, 80)
}

/**
 * Set up Code Lens AI action buttons (✨ Explain · ♻️ Refactor · 🧪 Tests)
 * above every detected symbol. Returns an IDisposable for cleanup.
 */
export function setupCodeLens(
  editor: MonacoEditor,
  monaco: Monaco,
  onAction: (action: CodeLensAction, symbol: DetectedSymbol, code: string) => void,
): monaco.IDisposable {
  const langs = [
    'typescript', 'javascript', 'typescriptreact', 'javascriptreact',
    'python', 'go', 'rust', 'java', 'php', 'ruby', 'c', 'cpp',
  ]

  // Register a single command per action; lenses reference the returned command IDs.
  const explainCmd = editor.addCommand(0, (_ctx: unknown, sym: DetectedSymbol) => {
    const model = editor.getModel()
    if (!model) return
    const code = model.getValueInRange(new monaco.Range(sym.startLine, 1, sym.endLine + 1, 1))
    onAction('explain', sym, code)
  }, '')

  const refactorCmd = editor.addCommand(0, (_ctx: unknown, sym: DetectedSymbol) => {
    const model = editor.getModel()
    if (!model) return
    const code = model.getValueInRange(new monaco.Range(sym.startLine, 1, sym.endLine + 1, 1))
    onAction('refactor', sym, code)
  }, '')

  const testsCmd = editor.addCommand(0, (_ctx: unknown, sym: DetectedSymbol) => {
    const model = editor.getModel()
    if (!model) return
    const code = model.getValueInRange(new monaco.Range(sym.startLine, 1, sym.endLine + 1, 1))
    onAction('tests', sym, code)
  }, '')

  const disposables: monaco.IDisposable[] = []

  const cmdIds = [explainCmd, refactorCmd, testsCmd].filter(Boolean) as string[]

  for (const lang of langs) {
    try {
      const d = monaco.languages.registerCodeLensProvider(lang, {
        provideCodeLenses: (model) => {
          const symbols = detectSymbols(model)
          const lenses: monaco.languages.CodeLens[] = []
          for (const sym of symbols) {
            const range = new monaco.Range(sym.startLine, 1, sym.startLine, 1)
            lenses.push({
              range,
              id: `explain-${sym.startLine}`,
              command: { id: explainCmd!, title: '✨ Explain', arguments: [sym] },
            })
            lenses.push({
              range,
              id: `refactor-${sym.startLine}`,
              command: { id: refactorCmd!, title: '♻️ Refactor', arguments: [sym] },
            })
            lenses.push({
              range,
              id: `tests-${sym.startLine}`,
              command: { id: testsCmd!, title: '🧪 Tests', arguments: [sym] },
            })
          }
          return { lenses, dispose: () => {} }
        },
        resolveCodeLens: (_model, lens) => lens,
      })
      disposables.push(d)
    } catch {
      // some languages may not be registered; skip
    }
  }

  // refresh lenses on content change
  const onModelChange = editor.onDidChangeModelContent(() => {
    // Monaco auto-refreshes, but nudge it
  })
  disposables.push(onModelChange)

  return {
    dispose: () => {
      disposables.forEach((d) => {
        try { d.dispose() } catch { /* ignore */ }
      })
    },
  }
}