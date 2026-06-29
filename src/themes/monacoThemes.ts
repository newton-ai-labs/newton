/**
 * Monaco theme definitions, one per app theme.
 *
 * Monaco has its own theme system entirely independent of CSS variables —
 * the editor canvas is painted with the values defined here, not by anything
 * in themes.css. So whenever we add or change a theme in src/themes/registry.ts
 * or src/themes.css, we must add a matching block here for the editor to
 * re-skin correctly.
 *
 * Each Monaco theme name matches the app theme ID (`monaco-<id>`).
 */

import type * as MonacoNs from 'monaco-editor'

type ThemeData = MonacoNs.editor.IStandaloneThemeData

interface PaletteForMonaco {
  base: 'vs-dark' | 'vs'
  bg: string
  bgPanel: string
  bgPanel2: string
  text: string
  textDim: string
  textFaint: string
  border: string
  borderSoft: string
  accent: string
  accent2: string
  selection: string  // accent at ~25% alpha (8-digit hex)
  green: string
  red: string
  yellow: string
  blue: string
}

const PALETTES: Record<string, PaletteForMonaco> = {
  newton: {
    base: 'vs-dark',
    bg: '#0d0f1a',
    bgPanel: '#0e1019',
    bgPanel2: '#141726',
    text: '#f0f2fa',
    textDim: '#b0b6d4',
    textFaint: '#727890',
    border: '#232842',
    borderSoft: '#1a1d30',
    accent: '#7c5cff',
    accent2: '#00d4ff',
    selection: '#7c5cff40',
    green: '#4ade80',
    red: '#f87171',
    yellow: '#fbbf24',
    blue: '#60a5fa',
  },
  'newton-light': {
    base: 'vs',
    bg: '#ffffff',
    bgPanel: '#f5f4f0',
    bgPanel2: '#ecebe5',
    text: '#14171c',
    textDim: '#5f6675',
    textFaint: '#8b91a0',
    border: '#d6d3ce',
    borderSoft: '#e2e1da',
    accent: '#7c3aed',
    accent2: '#0891b2',
    selection: '#7c3aed29',
    green: '#16a34a',
    red: '#dc2626',
    yellow: '#ca8a04',
    blue: '#2563eb',
  },
}

function buildMonacoTheme(p: PaletteForMonaco): ThemeData {
  return {
    base: p.base,
    inherit: true,
    rules: [
      { token: 'comment', foreground: p.textFaint.slice(1), fontStyle: 'italic' },
      { token: 'keyword', foreground: p.accent.slice(1) },
      { token: 'string', foreground: p.green.slice(1) },
      { token: 'number', foreground: p.yellow.slice(1) },
      { token: 'type', foreground: p.accent2.slice(1) },
      { token: 'function', foreground: p.blue.slice(1) },
      { token: 'variable', foreground: p.text.slice(1) },
    ],
    colors: {
      'editor.background': p.bg,
      'editor.foreground': p.text,
      'editorLineNumber.foreground': p.textFaint,
      'editorLineNumber.activeForeground': p.textDim,
      'editor.selectionBackground': p.selection,
      'editor.lineHighlightBackground': p.bgPanel2,
      'editorCursor.foreground': p.accent2,
      'editorIndentGuide.background': p.borderSoft,
      'editorIndentGuide.activeBackground': p.border,
      'editorWidget.background': p.bgPanel2,
      'editorWidget.border': p.border,
      'editorSuggestWidget.background': p.bgPanel2,
      'editorSuggestWidget.selectedBackground': p.bgPanel,
      'input.background': p.bgPanel,
      'input.border': p.border,
    },
  }
}

/** The Monaco theme name corresponding to an app theme ID. */
export function monacoThemeName(appThemeId: string): string {
  // Fall back to newton if the app theme has no Monaco mapping defined.
  if (!(appThemeId in PALETTES)) return 'monaco-newton'
  return `monaco-${appThemeId}`
}

/**
 * Register all Monaco themes. Idempotent — calling twice just overwrites
 * with the same definitions. Call once after Monaco has loaded.
 */
export function registerAllMonacoThemes(monaco: typeof MonacoNs): void {
  for (const [id, palette] of Object.entries(PALETTES)) {
    monaco.editor.defineTheme(monacoThemeName(id), buildMonacoTheme(palette))
  }
}
