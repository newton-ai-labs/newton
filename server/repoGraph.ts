/**
 * repoGraph.ts — Repository Dependency Graph
 *
 * Builds a dependency graph of the entire codebase:
 *   - Nodes = files (with exported symbols)
 *   - Edges = import relationships (file A imports from file B)
 *   - Reverse edges for impact analysis ("what breaks if I delete this?")
 *
 * Supports: JS, TS, JSX, TSX, Python, Go, Rust, Java, Ruby
 *
 * The graph is persisted to `.newton/repo-graph.json` and updated incrementally
 * (only re-parses files whose mtime changed since last build).
 */

import * as fs from 'fs/promises'
import * as path from 'path'
import { existsSync } from 'fs'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GraphSymbol {
  name: string
  kind: 'function' | 'class' | 'interface' | 'type' | 'const' | 'variable' | 'method'
  exported: boolean
  line: number
}

export interface GraphNode {
  /** relative path from workspace root, e.g. "src/components/Button.tsx" */
  id: string
  path: string
  language: string
  lineCount: number
  /** symbols defined in this file */
  symbols: GraphSymbol[]
  /** raw import specifiers as written in source, e.g. "./utils", "react", "lodash" */
  rawImports: string[]
  /** resolved file IDs that this file imports (same-workspace only) */
  imports: string[]
  /** external packages imported, e.g. ["react", "lodash"] */
  externalDeps: string[]
}

export interface GraphEdge {
  source: string
  target: string
  /** which symbols are imported (empty = default/namespace import) */
  symbols: string[]
}

export interface RepoGraph {
  version: number
  root: string
  builtAt: string
  nodes: Record<string, GraphNode>
  edges: GraphEdge[]
  /** reverse adjacency: targetId → [sourceIds] (who imports me) */
  reverseEdges: Record<string, string[]>
  stats: {
    fileCount: number
    symbolCount: number
    edgeCount: number
    externalDepCount: number
    languages: Record<string, number>
  }
}

// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------

const EXT_LANG: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.py': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.java': 'java',
  '.rb': 'ruby',
}

function langFromExt(fp: string): string | null {
  const ext = path.extname(fp).toLowerCase()
  return EXT_LANG[ext] ?? null
}

const GRAPHABLE_EXTS = new Set(Object.keys(EXT_LANG))

// ---------------------------------------------------------------------------
// File collection (walk workspace, skip noise)
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  '.newton',
  'coverage',
  '__pycache__',
  '.cache',
  '.turbo',
  'vendor',
  '.gradle',
  'target',
])

async function collectFiles(rootDir: string): Promise<{ abs: string; rel: string }[]> {
  const results: { abs: string; rel: string }[] = []

  const walk = async (absDir: string, relDir: string) => {
    let entries
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') && SKIP_DIRS.has(entry.name)) continue
      if (SKIP_DIRS.has(entry.name)) continue
      const abs = path.join(absDir, entry.name)
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        await walk(abs, rel)
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase()
        if (GRAPHABLE_EXTS.has(ext)) {
          results.push({ abs, rel })
        }
      }
    }
  }

  await walk(rootDir, '')
  return results
}

// ---------------------------------------------------------------------------
// Parsing: symbols + imports (regex-based, language-aware)
// ---------------------------------------------------------------------------

interface ParsedFile {
  symbols: GraphSymbol[]
  rawImports: string[]
}

function parseJS_TS(content: string): ParsedFile {
  const symbols: GraphSymbol[] = []
  const rawImports: string[] = []
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // --- imports ---
    // import ... from '...'
    const importFrom = line.match(/from\s+['"]([^'"]+)['"]/)
    if (importFrom) {
      rawImports.push(importFrom[1])
    }
    // import '...' (side-effect)
    const importSide = line.match(/^\s*import\s+['"]([^'"]+)['"]/)
    if (importSide && !importFrom) {
      rawImports.push(importSide[1])
    }
    // require('...')
    const requireMatch = line.match(/require\(\s*['"]([^'"]+)['"]\s*\)/)
    if (requireMatch) {
      rawImports.push(requireMatch[1])
    }
    // import('...') dynamic
    const dynImport = line.match(/import\(\s*['"]([^'"]+)['"]\s*\)/)
    if (dynImport) {
      rawImports.push(dynImport[1])
    }

    // --- symbols: exports ---
    const isExported = /\bexport\b/.test(line)

    // export function / async function
    let m = line.match(
      /^export\s+(?:default\s+)?(?:async\s+)?function\s+(\w+)/,
    )
    if (m) {
      symbols.push({ name: m[1], kind: 'function', exported: isExported, line: i + 1 })
      continue
    }
    // function (non-export)
    m = line.match(/^(?:async\s+)?function\s+(\w+)/)
    if (m && !isExported) {
      symbols.push({ name: m[1], kind: 'function', exported: false, line: i + 1 })
      continue
    }
    // export class
    m = line.match(/^export\s+(?:default\s+)?(?:abstract\s+)?class\s+(\w+)/)
    if (m) {
      symbols.push({ name: m[1], kind: 'class', exported: isExported, line: i + 1 })
      continue
    }
    // class (non-export)
    m = line.match(/^(?:abstract\s+)?class\s+(\w+)/)
    if (m && !isExported) {
      symbols.push({ name: m[1], kind: 'class', exported: false, line: i + 1 })
      continue
    }
    // export interface
    m = line.match(/^export\s+(?:default\s+)?interface\s+(\w+)/)
    if (m) {
      symbols.push({ name: m[1], kind: 'interface', exported: true, line: i + 1 })
      continue
    }
    // interface (non-export)
    m = line.match(/^interface\s+(\w+)/)
    if (m && !isExported) {
      symbols.push({ name: m[1], kind: 'interface', exported: false, line: i + 1 })
      continue
    }
    // export type
    m = line.match(/^export\s+type\s+(\w+)/)
    if (m) {
      symbols.push({ name: m[1], kind: 'type', exported: true, line: i + 1 })
      continue
    }
    // export const/let/var (only exported named consts)
    m = line.match(/^export\s+(?:const|let|var)\s+(\w+)/)
    if (m) {
      // Heuristic: capitalized or SCREAMING = const/type-like; usePascal = component
      const name = m[1]
      const kind: GraphSymbol['kind'] =
        /^[A-Z]/.test(name) ? 'const' : 'variable'
      symbols.push({ name, kind, exported: true, line: i + 1 })
      continue
    }
    // arrow functions assigned to const: const foo = () =>  or const foo = function
    m = line.match(/^(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(?[\w\s,]*\)?\s*=>/)
    if (m && !isExported) {
      symbols.push({ name: m[1], kind: 'function', exported: false, line: i + 1 })
      continue
    }
  }

  return { symbols, rawImports: [...new Set(rawImports)] }
}

function parsePython(content: string): ParsedFile {
  const symbols: GraphSymbol[] = []
  const rawImports: string[] = []
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // imports
    const impModule = line.match(/^\s*from\s+([\w.]+)\s+import/)
    if (impModule) {
      rawImports.push(impModule[1])
      continue
    }
    const impPlain = line.match(/^\s*import\s+([\w.]+)/)
    if (impPlain) {
      rawImports.push(impPlain[1])
      continue
    }

    // def
    let m = line.match(/^\s*(?:async\s+)?def\s+(\w+)/)
    if (m) {
      symbols.push({ name: m[1], kind: 'function', exported: !line.startsWith(' ') && !line.startsWith('\t'), line: i + 1 })
      continue
    }
    // class
    m = line.match(/^\s*class\s+(\w+)/)
    if (m) {
      symbols.push({ name: m[1], kind: 'class', exported: true, line: i + 1 })
      continue
    }
  }

  return { symbols, rawImports: [...new Set(rawImports)] }
}

function parseGo(content: string): ParsedFile {
  const symbols: GraphSymbol[] = []
  const rawImports: string[] = []
  const lines = content.split('\n')

  let inImportBlock = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line === 'import (') {
      inImportBlock = true
      continue
    }
    if (inImportBlock && line === ')') {
      inImportBlock = false
      continue
    }
    if (inImportBlock) {
      const m = line.match(/^"([^"]+)"/)
      if (m) rawImports.push(m[1])
      continue
    }
    const singleImp = line.match(/^import\s+"([^"]+)"/)
    if (singleImp) {
      rawImports.push(singleImp[1])
      continue
    }

    // exported = starts with uppercase
    let m = line.match(/^func\s+(?:\(\s*\w+\s+\*?\w+\s*\)\s+)?([A-Z]\w*)/)
    if (m) {
      symbols.push({ name: m[1], kind: 'function', exported: /^[A-Z]/.test(m[1]), line: i + 1 })
      continue
    }
    m = line.match(/^type\s+([A-Z]\w*)/)
    if (m) {
      symbols.push({ name: m[1], kind: 'interface', exported: true, line: i + 1 })
      continue
    }
  }

  return { symbols, rawImports: [...new Set(rawImports)] }
}

function parseRust(content: string): ParsedFile {
  const symbols: GraphSymbol[] = []
  const rawImports: string[] = []
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // use ...
    const useMatch = line.match(/^\s*use\s+([\w:{}_ ,]+);/)
    if (useMatch) {
      // Extract crate-level path
      const parts = useMatch[1].split('{')[0].split('::')
      rawImports.push(parts.filter((p) => /^\w+$/.test(p)).join('::'))
      continue
    }

    let m = line.match(/^\s*pub\s+(?:async\s+)?fn\s+(\w+)/)
    if (m) {
      symbols.push({ name: m[1], kind: 'function', exported: true, line: i + 1 })
      continue
    }
    m = line.match(/^\s*(?:async\s+)?fn\s+(\w+)/)
    if (m) {
      symbols.push({ name: m[1], kind: 'function', exported: false, line: i + 1 })
      continue
    }
    m = line.match(/^\s*pub\s+struct\s+(\w+)/)
    if (m) {
      symbols.push({ name: m[1], kind: 'class', exported: true, line: i + 1 })
      continue
    }
    m = line.match(/^\s*pub\s+trait\s+(\w+)/)
    if (m) {
      symbols.push({ name: m[1], kind: 'interface', exported: true, line: i + 1 })
      continue
    }
  }

  return { symbols, rawImports: [...new Set(rawImports)] }
}

function parseJava(content: string): ParsedFile {
  const symbols: GraphSymbol[] = []
  const rawImports: string[] = []
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const imp = line.match(/^import\s+(?:static\s+)?([\w.]+);/)
    if (imp) {
      rawImports.push(imp[1])
      continue
    }

    let m = line.match(/(?:public|private|protected)?\s*(?:static\s+)?(?:final\s+)?class\s+(\w+)/)
    if (m) {
      symbols.push({ name: m[1], kind: 'class', exported: true, line: i + 1 })
      continue
    }
    m = line.match(/(?:public|private|protected)?\s*(?:static\s+)?interface\s+(\w+)/)
    if (m) {
      symbols.push({ name: m[1], kind: 'interface', exported: true, line: i + 1 })
      continue
    }
  }

  return { symbols, rawImports: [...new Set(rawImports)] }
}

function parseRuby(content: string): ParsedFile {
  const symbols: GraphSymbol[] = []
  const rawImports: string[] = []
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const imp = line.match(/^\s*require(?:_relative)?\s+['"]([^'"]+)['"]/)
    if (imp) {
      rawImports.push(imp[1])
      continue
    }

    let m = line.match(/^\s*(?:public\s+)?def\s+(?:self\.)?(\w+)/)
    if (m) {
      symbols.push({ name: m[1], kind: 'method', exported: true, line: i + 1 })
      continue
    }
    m = line.match(/^\s*class\s+(\w+)/)
    if (m) {
      symbols.push({ name: m[1], kind: 'class', exported: true, line: i + 1 })
      continue
    }
    m = line.match(/^\s*module\s+(\w+)/)
    if (m) {
      symbols.push({ name: m[1], kind: 'class', exported: true, line: i + 1 })
      continue
    }
  }

  return { symbols, rawImports: [...new Set(rawImports)] }
}

function parseFile(content: string, language: string): ParsedFile {
  switch (language) {
    case 'typescript':
    case 'javascript':
      return parseJS_TS(content)
    case 'python':
      return parsePython(content)
    case 'go':
      return parseGo(content)
    case 'rust':
      return parseRust(content)
    case 'java':
      return parseJava(content)
    case 'ruby':
      return parseRuby(content)
    default:
      return { symbols: [], rawImports: [] }
  }
}

// ---------------------------------------------------------------------------
// Import resolution: turn raw import specifiers into file IDs
// ---------------------------------------------------------------------------

const EXT_VARIANTS = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '/index.ts',
  '/index.tsx',
  '/index.js',
  '/index.jsx',
  '',
  '.py',
  '/__init__.py',
  '.go',
  '.rs',
  '.java',
  '.rb',
]

/**
 * Resolve a relative import specifier to an actual file ID.
 * Returns null if it can't be resolved (e.g., external package).
 */
function resolveImport(
  rawImport: string,
  sourceRelPath: string,
  knownFiles: Set<string>,
): string | null {
  // Only resolve relative imports (./ or ../)
  if (!rawImport.startsWith('.')) return null

  const sourceDir = path.dirname(sourceRelPath)
  const base = path.normalize(path.join(sourceDir, rawImport)).replace(/\\/g, '/')

  for (const variant of EXT_VARIANTS) {
    const candidate = (base + variant).replace(/\\/g, '/')
    if (knownFiles.has(candidate)) {
      return candidate
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// Graph builder
// ---------------------------------------------------------------------------

const GRAPH_VERSION = 1

export class RepoGraphBuilder {
  private root: string
  private graphPath: string
  private graph: RepoGraph | null = null
  /** file mtimes at last build, for incremental updates */
  private mtimes: Record<string, number> = {}

  constructor(root: string) {
    this.root = root
    this.graphPath = path.join(root, '.newton', 'repo-graph.json')
  }

  async load(): Promise<boolean> {
    try {
      const raw = await fs.readFile(this.graphPath, 'utf-8')
      const data = JSON.parse(raw)
      if (data.version !== GRAPH_VERSION) return false
      this.graph = data.graph ?? data
      this.mtimes = data.mtimes ?? {}
      return true
    } catch {
      return false
    }
  }

  private async persist() {
    if (!this.graph) return
    const dir = path.dirname(this.graphPath)
    if (!existsSync(dir)) await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(
      this.graphPath,
      JSON.stringify({ version: GRAPH_VERSION, graph: this.graph, mtimes: this.mtimes }, null, 2),
    )
  }

  /**
   * Build (or incrementally update) the dependency graph.
   * Returns stats about how many files were parsed.
   */
  async build(force = false): Promise<{ parsed: number; cached: number; total: number }> {
    const files = await collectFiles(this.root)
    const knownFiles = new Set(files.map((f) => f.rel))

    // Load existing graph for incremental updates
    if (!this.graph) await this.load()
    const existingNodes = this.graph?.nodes ?? {}

    const nodes: Record<string, GraphNode> = {}
    let parsed = 0
    let cached = 0

    for (const { abs, rel } of files) {
      let stat
      try {
        stat = await fs.stat(abs)
      } catch {
        continue
      }

      const mtime = stat.mtimeMs
      const cachedNode = !force ? existingNodes[rel] : null

      // Check if we can reuse cached node
      if (cachedNode && this.mtimes[rel] === mtime) {
        nodes[rel] = cachedNode
        cached++
        continue
      }

      // Parse the file
      let content: string
      try {
        content = await fs.readFile(abs, 'utf-8')
      } catch {
        continue
      }

      const language = langFromExt(rel)!
      const { symbols, rawImports } = parseFile(content, language)
      this.mtimes[rel] = mtime

      // Resolve imports
      const imports: string[] = []
      const externalDeps: string[] = []
      for (const raw of rawImports) {
        const resolved = resolveImport(raw, rel, knownFiles)
        if (resolved) {
          imports.push(resolved)
        } else if (!raw.startsWith('.')) {
          // External package: take top-level package name
          const pkg = raw.startsWith('@')
            ? raw.split('/').slice(0, 2).join('/')
            : raw.split('/')[0].split('.')[0]
          if (pkg && !raw.includes(' ')) externalDeps.push(pkg)
        }
      }

      nodes[rel] = {
        id: rel,
        path: rel,
        language,
        lineCount: content.split('\n').length,
        symbols,
        rawImports,
        imports: [...new Set(imports)],
        externalDeps: [...new Set(externalDeps)],
      }
      parsed++
    }

    // Build edges
    const edges: GraphEdge[] = []
    const reverseEdges: Record<string, string[]> = {}

    for (const [id, node] of Object.entries(nodes)) {
      for (const target of node.imports) {
        if (nodes[target]) {
          edges.push({ source: id, target, symbols: [] })
          if (!reverseEdges[target]) reverseEdges[target] = []
          reverseEdges[target].push(id)
        }
      }
    }

    // Compute stats
    const languages: Record<string, number> = {}
    let symbolCount = 0
    const externalSet = new Set<string>()
    for (const node of Object.values(nodes)) {
      languages[node.language] = (languages[node.language] ?? 0) + 1
      symbolCount += node.symbols.length
      for (const dep of node.externalDeps) externalSet.add(dep)
    }

    this.graph = {
      version: GRAPH_VERSION,
      root: this.root,
      builtAt: new Date().toISOString(),
      nodes,
      edges,
      reverseEdges,
      stats: {
        fileCount: Object.keys(nodes).length,
        symbolCount,
        edgeCount: edges.length,
        externalDepCount: externalSet.size,
        languages,
      },
    }

    await this.persist()

    return { parsed, cached, total: files.length }
  }

  getGraph(): RepoGraph | null {
    return this.graph
  }

  /**
   * Impact analysis: "What breaks if I delete/modify this file?"
   * Returns all files that directly or transitively depend on the given file.
   */
  impactAnalysis(fileId: string, maxDepth = 10): {
    impacted: string[]
    byDepth: Record<number, string[]>
  } {
    if (!this.graph) return { impacted: [], byDepth: {} }

    const visited = new Set<string>()
    const byDepth: Record<number, string[]> = {}
    const queue: { id: string; depth: number }[] = []

    const direct = this.graph.reverseEdges[fileId] ?? []
    for (const d of direct) {
      queue.push({ id: d, depth: 1 })
    }

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!
      if (visited.has(id) || depth > maxDepth) continue
      visited.add(id)
      if (!byDepth[depth]) byDepth[depth] = []
      byDepth[depth].push(id)

      const next = this.graph.reverseEdges[id] ?? []
      for (const n of next) {
        if (!visited.has(n)) queue.push({ id: n, depth: depth + 1 })
      }
    }

    return { impacted: [...visited], byDepth }
  }
}

// ---------------------------------------------------------------------------
// Singleton cache per workspace
// ---------------------------------------------------------------------------

const builders = new Map<string, RepoGraphBuilder>()

export function getGraphBuilder(workspace: string): RepoGraphBuilder {
  let b = builders.get(workspace)
  if (!b) {
    b = new RepoGraphBuilder(workspace)
    builders.set(workspace, b)
  }
  return b
}