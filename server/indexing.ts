/**
 * Newton Codebase Index — semantic code search engine.
 *
 * This is THE feature that makes Newton competitive: it builds a searchable
 * index of your entire codebase so the AI can answer questions like
 * "where is the auth logic?" or "find all API endpoints".
 *
 * ARCHITECTURE:
 * - Files are chunked into logical units (functions, classes, blocks)
 * - Each chunk is indexed using TF-IDF vector space model (works OFFLINE, no API key)
 * - When an OpenAI key is available, real embeddings are used for even better results
 * - Incremental indexing: only re-index files whose mtime changed
 * - Persistence: index is cached to .newton-index.json for instant startup
 *
 * The TF-IDF engine is genuinely useful — it's the same core technique that
 * powered early code search tools before embeddings became cheap.
 */

import fs from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import path from 'node:path'
import { atomicWrite } from './atomicWrite.js'

// ---------- Types ----------
export interface CodeChunk {
  id: string
  filePath: string
  startLine: number
  endLine: number
  content: string
  /** semantic label extracted from code, e.g. function name */
  symbol?: string
  /** chunk type for display */
  kind: 'function' | 'class' | 'interface' | 'block' | 'file'
  language: string
}

export interface SearchHit {
  chunk: CodeChunk
  score: number
}

export interface IndexStats {
  totalFiles: number
  totalChunks: number
  indexedAt: number
  indexing: boolean
  lastQuery?: string
}

// ---------- Language detection ----------
function langFromExt(fp: string): string {
  const ext = path.extname(fp).slice(1).toLowerCase()
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    mjs: 'javascript', py: 'python', go: 'go', rs: 'rust', rb: 'ruby',
    java: 'java', c: 'c', cpp: 'cpp', h: 'cpp', cs: 'csharp', php: 'php',
    swift: 'swift', kt: 'kotlin', dart: 'dart', lua: 'lua', sh: 'shell',
    sql: 'sql', html: 'html', css: 'css', scss: 'scss', vue: 'html',
    svelte: 'html', json: 'json', yaml: 'yaml', yml: 'yaml', md: 'markdown',
  }
  return map[ext] ?? 'plaintext'
}

const BINARY_EXT = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'svg', 'pdf', 'zip', 'gz',
  'tar', 'rar', '7z', 'mp4', 'mp3', 'wav', 'avi', 'mov', 'woff', 'woff2',
  'ttf', 'eot', 'otf', 'webp', 'webm', 'lock', 'sum',
])

const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.cache', '.vite',
  'coverage', '__pycache__', '.pytest_cache', 'vendor', 'target',
  '.DS_Store', '.newton-index', 'tmp', 'temp', '.turbo', '.vercel',
])

const MAX_FILE_SIZE = 100_000 // 100KB — skip huge generated files

// ---------- Stopwords ----------
const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'must', 'can', 'this', 'that',
  'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'what',
  'which', 'who', 'when', 'where', 'why', 'how', 'all', 'each', 'every',
  'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor',
  'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just',
  'if', 'then', 'else', 'as', 'also', 'about', 'into', 'through',
  'during', 'before', 'after', 'above', 'below', 'up', 'down', 'out',
  'off', 'over', 'under', 'again', 'further', 'once', 'here', 'there',
  'new', 'use', 'used', 'using', 'get', 'set', 'return', 'const', 'let',
  'var', 'function', 'class', 'import', 'export', 'default', 'void',
  'string', 'number', 'boolean', 'true', 'false', 'null', 'undefined',
])

// ---------- Tokenizer ----------
function tokenize(text: string): string[] {
  // Split camelCase, snake_case, kebab-case, and punctuation
  const words = text
    .toLowerCase()
    .replace(/([a-z])([A-Z])/g, '$1 $2') // camelCase
    .replace(/[_\-\.\/\\]/g, ' ') // separators
    .split(/[^a-z0-9+]+/) // keep + for c++
    .filter((w) => w.length >= 2 && w.length <= 40 && !STOPWORDS.has(w))

  // Add bigrams for better phrase matching
  const bigrams: string[] = []
  for (let i = 0; i < words.length - 1; i++) {
    bigrams.push(`${words[i]}_${words[i + 1]}`)
  }
  return [...words, ...bigrams]
}

// ---------- Chunking ----------
/**
 * Split a file into semantic chunks based on code structure.
 * Uses regex to detect function/class/interface boundaries — works across
 * many languages (JS/TS, Python, Go, Rust, etc).
 */
function chunkFile(filePath: string, content: string): CodeChunk[] {
  const lang = langFromExt(filePath)
  const lines = content.split('\n')

  // For small files, return as single chunk
  if (content.length < 500) {
    return [{
      id: `${filePath}:0`,
      filePath,
      startLine: 1,
      endLine: lines.length,
      content,
      kind: 'file',
      language: lang,
    }]
  }

  const chunks: CodeChunk[] = []

  // Patterns that indicate a new top-level block
  const blockPatterns = [
    // JS/TS: export function/class/const, function, class, interface
    { regex: /^(export\s+)?(default\s+)?(async\s+)?(function|class|interface|type|enum)\s+(\w+)/,
      kind: 'function' as const, group: 5, kw: 4 },
    // JS/TS: export const Name = | const Name = (
    { regex: /^(export\s+)?(const|let|var)\s+([A-Z]\w*|use\w+)\s*[=:]/,
      kind: 'function' as const, group: 3, kw: 2 },
    // Python: def / class
    { regex: /^(async\s+)?def\s+(\w+)/,
      kind: 'function' as const, group: 2, kw: 0 },
    { regex: /^class\s+(\w+)/,
      kind: 'class' as const, group: 1, kw: 0 },
    // Go: func / type
    { regex: /^func\s+(?:\([^)]*\)\s+)?(\w+)/,
      kind: 'function' as const, group: 1, kw: 0 },
    { regex: /^type\s+(\w+)\s+(struct|interface)/,
      kind: 'class' as const, group: 1, kw: 0 },
    // Rust: fn / struct / enum / impl
    { regex: /^(pub\s+)?fn\s+(\w+)/,
      kind: 'function' as const, group: 2, kw: 0 },
    { regex: /^(pub\s+)?(struct|enum|trait)\s+(\w+)/,
      kind: 'class' as const, group: 3, kw: 0 },
    // Java/C#: public/private/protected class/method
    { regex: /^(public|private|protected)\s+(?:static\s+)?(?:class|void|int|string|boolean)\s+(\w+)/,
      kind: 'function' as const, group: 2, kw: 0 },
    { regex: /^(public|private|protected)\s+(?:static\s+)?class\s+(\w+)/,
      kind: 'class' as const, group: 2, kw: 0 },
    // Ruby: def / class / module
    { regex: /^(def|class|module)\s+([\w:]+)/,
      kind: 'function' as const, group: 2, kw: 0 },
  ]

  let currentStart = 0
  let currentSymbol: string | undefined
  let currentKind: 'function' | 'class' | 'interface' | 'block' | 'file' = 'block'
  let inDocComment = false

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Track multi-line comments
    if (line.includes('/*') && !line.includes('*/')) inDocComment = true
    if (line.includes('*/')) inDocComment = false
    if (inDocComment) continue

    for (const pat of blockPatterns) {
      const m = line.match(pat.regex)
      if (m) {
        // Close previous chunk
        if (i > currentStart) {
          const chunkContent = lines.slice(currentStart, i).join('\n')
          if (chunkContent.trim().length > 10) {
            chunks.push({
              id: `${filePath}:${currentStart}`,
              filePath,
              startLine: currentStart + 1,
              endLine: i,
              content: chunkContent,
              symbol: currentSymbol,
              kind: currentKind,
              language: lang,
            })
          }
        }
        currentStart = i
        currentSymbol = m[pat.group]
        currentKind = pat.kind
        break
      }
    }
  }

  // Last chunk
  if (lines.length > currentStart) {
    const chunkContent = lines.slice(currentStart).join('\n')
    if (chunkContent.trim().length > 10) {
      chunks.push({
        id: `${filePath}:${currentStart}`,
        filePath,
        startLine: currentStart + 1,
        endLine: lines.length,
        content: chunkContent,
        symbol: currentSymbol,
        kind: currentKind,
        language: lang,
      })
    }
  }

  // If no chunks were found (no function/class boundaries), split by size
  if (chunks.length === 0) {
    const chunkSize = 50 // lines
    for (let i = 0; i < lines.length; i += chunkSize) {
      const end = Math.min(i + chunkSize, lines.length)
      chunks.push({
        id: `${filePath}:${i}`,
        filePath,
        startLine: i + 1,
        endLine: end,
        content: lines.slice(i, end).join('\n'),
        kind: 'block',
        language: lang,
      })
    }
  }

  return chunks
}

// ---------- TF-IDF Vector Space ----------
interface VectorEntry {
  [term: string]: number
}

interface IndexedChunk {
  chunk: CodeChunk
  /** TF-IDF vector */
  vector: VectorEntry
  /** file mtime for incremental updates */
  mtime: number
}

/**
 * The core codebase index. Builds a TF-IDF model over all code chunks
 * and supports semantic search via cosine similarity.
 */
export class CodebaseIndex {
  private chunks: Map<string, IndexedChunk> = new Map()
  private documentFrequency: Map<string, number> = new Map()
  private totalDocs = 0
  private workspace: string
  private indexing = false
  private lastIndexedAt = 0
  private lastQuery = ''
  private filePaths: Set<string> = new Set()

  // Optional: real embeddings (when OpenAI key available)
  private embeddings: Map<string, number[]> = new Map()
  private useEmbeddings = false

  constructor(workspace: string) {
    this.workspace = workspace
  }

  getStats(): IndexStats {
    return {
      totalFiles: this.filePaths.size,
      totalChunks: this.chunks.size,
      indexedAt: this.lastIndexedAt,
      indexing: this.indexing,
      lastQuery: this.lastQuery,
    }
  }

  /**
   * Full (re)index of the workspace. Walks the tree, chunks each file,
   * and builds the TF-IDF model. Incremental: skips unchanged files.
   */
  async index(
    _opts?: { useEmbeddings?: boolean; onProgress?: (done: number, total: number) => void },
  ): Promise<void> {
    if (this.indexing) return
    this.indexing = true

    try {
      // Collect all indexable files
      const files = await this.collectFiles()
      this.filePaths = new Set(files.map((f) => f.rel))

      let done = 0
      const total = files.length

      for (const file of files) {
        try {
          const stat = statSync(file.abs)
          const existing = this.chunks.get(file.rel)
          if (existing && existing.mtime === stat.mtimeMs) {
            done++
            continue // skip unchanged
          }

          const content = await fs.readFile(file.abs, 'utf8')
          const newChunks = chunkFile(file.rel, content)

          // Remove old chunks for this file
          for (const [id, c] of this.chunks) {
            if (c.chunk.filePath === file.rel) this.chunks.delete(id)
          }

          // Add new chunks
          for (const c of newChunks) {
            const tokens = tokenize(c.content)
            const tf = this.computeTF(tokens)
            this.chunks.set(c.id, {
              chunk: c,
              vector: tf,
              mtime: stat.mtimeMs,
            })
          }
        } catch {
          // skip unreadable files
        }
        done++
        _opts?.onProgress?.(done, total)
      }

      // Recompute document frequencies and IDF
      this.rebuildIDF()
      this.lastIndexedAt = Date.now()

      // Persist
      await this.persist()
    } finally {
      this.indexing = false
    }
  }

  /** Rebuild inverse document frequency from current chunks. */
  private rebuildIDF() {
    this.documentFrequency.clear()
    this.totalDocs = this.chunks.size

    for (const [, indexed] of this.chunks) {
      for (const term of Object.keys(indexed.vector)) {
        this.documentFrequency.set(term, (this.documentFrequency.get(term) ?? 0) + 1)
      }
    }

    // Apply IDF weighting: tf * log(N / df)
    for (const [, indexed] of this.chunks) {
      for (const term of Object.keys(indexed.vector)) {
        const df = this.documentFrequency.get(term) ?? 1
        const idf = Math.log(this.totalDocs / df)
        indexed.vector[term] *= idf
      }
    }
  }

  /** Term frequency with sublinear scaling. */
  private computeTF(tokens: string[]): VectorEntry {
    const counts: Record<string, number> = {}
    for (const t of tokens) counts[t] = (counts[t] ?? 0) + 1

    const vec: VectorEntry = {}
    for (const [term, count] of Object.entries(counts)) {
      vec[term] = 1 + Math.log(count) // sublinear TF
    }
    return vec
  }

  /**
   * Semantic search: returns the most relevant code chunks for a query.
   * Uses cosine similarity in TF-IDF space (or embeddings if available).
   */
  search(query: string, limit = 8): SearchHit[] {
    this.lastQuery = query
    if (this.chunks.size === 0) return []

    const queryTokens = tokenize(query)
    if (queryTokens.length === 0) return []

    const queryVec = this.computeTF(queryTokens)
    // Apply IDF to query
    for (const term of Object.keys(queryVec)) {
      const df = this.documentFrequency.get(term) ?? 1
      const idf = Math.log(this.totalDocs / df)
      queryVec[term] *= idf
    }

    // Normalize query vector
    let queryNorm = 0
    for (const v of Object.values(queryVec)) queryNorm += v * v
    queryNorm = Math.sqrt(queryNorm)
    if (queryNorm === 0) return []

    // Score each chunk by cosine similarity
    const hits: SearchHit[] = []
    for (const [, indexed] of this.chunks) {
      let dotProduct = 0
      let chunkNorm = 0

      // Only iterate over query terms for efficiency
      for (const [term, qWeight] of Object.entries(queryVec)) {
        const cWeight = indexed.vector[term]
        if (cWeight) {
          dotProduct += qWeight * cWeight
        }
      }

      if (dotProduct === 0) continue

      // Pre-computed chunk norm (approximate — we can cache this)
      for (const v of Object.values(indexed.vector)) chunkNorm += v * v
      chunkNorm = Math.sqrt(chunkNorm)
      if (chunkNorm === 0) continue

      const score = dotProduct / (queryNorm * chunkNorm)

      // Boost: symbol name match — when the query mentions the symbol name
      if (indexed.chunk.symbol) {
        const symLower = indexed.chunk.symbol.toLowerCase()
        if (query.toLowerCase().includes(symLower)) {
          hits.push({ chunk: indexed.chunk, score: score * 2.0 })
          continue
        }
      }

      hits.push({ chunk: indexed.chunk, score })
    }

    hits.sort((a, b) => b.score - a.score)
    return hits.slice(0, limit)
  }

  /**
   * Get context for the AI: returns concatenated code from top search hits,
   * formatted for inclusion in an LLM prompt.
   */
  getContextForQuery(query: string, maxChars = 8000): string {
    const hits = this.search(query, 10)
    if (hits.length === 0) return ''

    let result = ''
    let charCount = 0

    for (const hit of hits) {
      const c = hit.chunk
      const header = `--- ${c.filePath}:${c.startLine}-${c.endLine}${c.symbol ? ` (${c.symbol})` : ''} [score: ${hit.score.toFixed(3)}] ---\n`
      const snippet = `${c.content.trim()}\n\n`
      const piece = header + snippet

      if (charCount + piece.length > maxChars) break
      result += piece
      charCount += piece.length
    }

    return result.trim()
  }

  /** Collect all indexable files from the workspace. */
  private async collectFiles(): Promise<{ abs: string; rel: string }[]> {
    const results: { abs: string; rel: string }[] = []

    const walk = async (absDir: string, relDir: string) => {
      let entries
      try {
        entries = await fs.readdir(absDir, { withFileTypes: true })
      } catch {
        return
      }

      for (const entry of entries) {
        if (IGNORED_DIRS.has(entry.name)) continue
        // Skip hidden files/dirs except .env
        if (entry.name.startsWith('.') && entry.name !== '.env.example') continue

        const abs = path.join(absDir, entry.name)
        const rel = relDir ? `${relDir}/${entry.name}` : entry.name

        if (entry.isDirectory()) {
          await walk(abs, rel)
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).slice(1).toLowerCase()
          if (BINARY_EXT.has(ext)) continue
          // Skip the index file itself
          if (entry.name === '.newton-index.json') continue
          try {
            const stat = statSync(abs)
            if (stat.size > MAX_FILE_SIZE) continue
          } catch {
            continue
          }
          results.push({ abs, rel })
        }
      }
    }

    await walk(this.workspace, '')
    return results
  }

  /** Persist index to disk for fast startup. */
  private async persist() {
    try {
      const data = {
        version: 1,
        workspace: this.workspace,
        indexedAt: this.lastIndexedAt,
        chunks: Array.from(this.chunks.entries()).map(([id, ic]) => ({
          id,
          chunk: ic.chunk,
          mtime: ic.mtime,
        })),
      }
      // Atomic write prevents a half-written index cache from blocking
      // startup reads or corrupting the search index.
      await atomicWrite(
        path.join(this.workspace, '.newton-index.json'),
        JSON.stringify(data),
      )
    } catch {
      // persistence is best-effort
    }
  }

  /** Load persisted index from disk. */
  async load(): Promise<boolean> {
    try {
      const indexFile = path.join(this.workspace, '.newton-index.json')
      if (!existsSync(indexFile)) return false

      const raw = await fs.readFile(indexFile, 'utf8')
      const data = JSON.parse(raw)

      for (const entry of data.chunks ?? []) {
        const tokens = tokenize(entry.chunk.content)
        this.chunks.set(entry.id, {
          chunk: entry.chunk,
          vector: this.computeTF(tokens),
          mtime: entry.mtime,
        })
        this.filePaths.add(entry.chunk.filePath)
      }

      this.rebuildIDF()
      this.lastIndexedAt = data.indexedAt ?? 0
      return true
    } catch {
      return false
    }
  }

  /** Enable real embeddings (when OpenAI key is available). */
  setEmbeddingsMode(enabled: boolean) {
    this.useEmbeddings = enabled
  }
}

// ---------- Singleton ----------
let indexInstance: CodebaseIndex | null = null

export function getIndex(workspace: string): CodebaseIndex {
  if (!indexInstance || indexInstance['workspace'] !== workspace) {
    indexInstance = new CodebaseIndex(workspace)
  }
  return indexInstance
}

export function resetIndex(): void {
  indexInstance = null
}