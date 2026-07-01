/**
 * Impact analyzers — surface the things the constellation graph doesn't:
 * HTTP endpoints and database tables.
 *
 * The graph already knows "file A imports file B." This module adds:
 *   - "which files declare HTTP endpoints, and which endpoints?" — so the
 *     Impact Report can show, for a focused file, how many endpoints among
 *     its inbound callers will be affected by a change.
 *   - "which files touch which DB tables?" — so the Impact Report can show
 *     the actual tables this file (or its imports) reads/writes.
 *
 * Multi-framework, regex-based. False positives are tolerable — these tiles
 * are signal, not source of truth.
 */

import fs from 'node:fs/promises'
import path from 'node:path'

export interface EndpointRef {
  method: string         // GET / POST / PUT / DELETE / PATCH / *
  route: string          // '/api/auth/login' or '/users/{id}'
  file: string           // workspace-relative path where it's declared
  framework: 'express' | 'next-app' | 'next-pages' | 'fastapi' | 'flask' | 'rails' | 'spring'
}

export interface TableRef {
  name: string
  kind: 'prisma' | 'knex' | 'sqlalchemy' | 'sql' | 'rails'
  file: string           // workspace-relative path where the ref was found
}

interface ImpactIndex {
  /** path → endpoints declared in that file */
  endpointsByFile: Map<string, EndpointRef[]>
  /** path → tables referenced from that file */
  tablesByFile: Map<string, TableRef[]>
  /** absolute timestamp when this snapshot was built */
  builtAt: number
}

const TTL_MS = 60_000 // 1 minute — re-scan if the cache is older than this
let cache: { workspace: string; index: ImpactIndex } | null = null

// ----- public API ------------------------------------------------------------

/**
 * Build (or return cached) impact index for the workspace. Walks the file
 * tree under workspace, skipping the same noise dirs as the graph builder.
 */
export async function getImpactIndex(workspace: string): Promise<ImpactIndex> {
  const now = Date.now()
  if (cache && cache.workspace === workspace && now - cache.index.builtAt < TTL_MS) {
    return cache.index
  }
  const files = await collectFiles(workspace)
  const endpointsByFile = new Map<string, EndpointRef[]>()
  const tablesByFile = new Map<string, TableRef[]>()

  await Promise.all(files.map(async ({ abs, rel }) => {
    let content: string
    try { content = await fs.readFile(abs, 'utf8') } catch { return }
    if (content.length > 1_000_000) return // skip absurdly large files

    const endpoints = scanEndpoints(rel, content)
    if (endpoints.length) endpointsByFile.set(rel, endpoints)

    const tables = scanTables(rel, content)
    if (tables.length) tablesByFile.set(rel, tables)
  }))

  const index: ImpactIndex = { endpointsByFile, tablesByFile, builtAt: now }
  cache = { workspace, index }
  return index
}

/** Force a re-scan on the next get(). */
export function invalidateImpactIndex(): void { cache = null }

// ----- endpoint scanners -----------------------------------------------------

const HTTP_METHODS = ['get', 'post', 'put', 'delete', 'patch', 'options', 'head', 'all']

export function scanEndpoints(rel: string, content: string): EndpointRef[] {
  const out: EndpointRef[] = []
  const seen = new Set<string>() // dedupe (method, route)

  const push = (e: EndpointRef) => {
    const key = `${e.method} ${e.route}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(e)
  }

  // ---- Next.js App Router: app/api/**/route.{ts,js}
  // The file IS the endpoint. Method is determined by exported function names.
  const nextAppMatch = rel.match(/(?:^|\/)(?:src\/)?app\/api\/(.+)\/route\.(?:tsx?|jsx?)$/)
  if (nextAppMatch) {
    const route = '/api/' + nextAppMatch[1].replace(/\[(\.\.\.)?(\w+)\]/g, ':$2')
    for (const m of content.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)\b/g)) {
      push({ method: m[1], route, file: rel, framework: 'next-app' })
    }
    return out
  }

  // ---- Next.js Pages Router: pages/api/**/*.{ts,js}
  const nextPagesMatch = rel.match(/(?:^|\/)(?:src\/)?pages\/api\/(.+?)\.(?:tsx?|jsx?)$/)
  if (nextPagesMatch) {
    const route = '/api/' + nextPagesMatch[1].replace(/\[(\.\.\.)?(\w+)\]/g, ':$2').replace(/\/index$/, '')
    // Pages Router exports a default handler — method is runtime, surface as *
    push({ method: '*', route, file: rel, framework: 'next-pages' })
    return out
  }

  // ---- Express / Fastify / Hono / NestJS (similar surface): app.METHOD('/route', ...)
  const expressRe = new RegExp(
    String.raw`\b(?:app|router|fastify|server)\s*\.\s*(${HTTP_METHODS.join('|')})\s*\(\s*['"\`]([^'"\`]+)['"\`]`,
    'gi',
  )
  for (const m of content.matchAll(expressRe)) {
    push({ method: m[1].toUpperCase(), route: m[2], file: rel, framework: 'express' })
  }

  // ---- FastAPI: @app.get("/path") or @router.post("/path")
  const fastapiRe = /@(?:app|router)\.(get|post|put|delete|patch|options|head)\s*\(\s*['"]([^'"]+)['"]/gi
  for (const m of content.matchAll(fastapiRe)) {
    push({ method: m[1].toUpperCase(), route: m[2], file: rel, framework: 'fastapi' })
  }

  // ---- Flask: @app.route("/path", methods=["GET", "POST"])
  const flaskRe = /@(?:app|bp|blueprint)\.route\s*\(\s*['"]([^'"]+)['"]\s*(?:,\s*methods\s*=\s*\[([^\]]+)\])?/gi
  for (const m of content.matchAll(flaskRe)) {
    const methods = m[2]
      ? m[2].match(/['"](\w+)['"]/g)?.map((s) => s.replace(/['"]/g, '').toUpperCase()) ?? ['GET']
      : ['GET']
    for (const method of methods) {
      push({ method, route: m[1], file: rel, framework: 'flask' })
    }
  }

  // ---- Rails routes.rb: get '/foo', to: '...' / resources :foo
  if (/(?:^|\/)config\/routes\.rb$/.test(rel)) {
    const railsRe = /^\s*(get|post|put|patch|delete)\s+['"]([^'"]+)['"]/gim
    for (const m of content.matchAll(railsRe)) {
      push({ method: m[1].toUpperCase(), route: m[2], file: rel, framework: 'rails' })
    }
  }

  // ---- Spring: @GetMapping("/path") / @PostMapping("/path") / @RequestMapping
  const springRe = /@(Get|Post|Put|Delete|Patch|Request)Mapping\s*\(\s*(?:value\s*=\s*)?['"]([^'"]+)['"]/g
  for (const m of content.matchAll(springRe)) {
    const method = m[1] === 'Request' ? '*' : m[1].toUpperCase()
    push({ method, route: m[2], file: rel, framework: 'spring' })
  }

  return out
}

// ----- table scanners --------------------------------------------------------

export function scanTables(rel: string, content: string): TableRef[] {
  const out: TableRef[] = []
  const seen = new Set<string>()
  const push = (t: TableRef) => {
    const key = `${t.kind}:${t.name}`
    if (seen.has(key)) return
    seen.add(key)
    out.push(t)
  }

  // ---- Prisma schema: model X { ... }  →  table is mapped name or model name
  if (/(?:^|\/)prisma\/schema\.prisma$/.test(rel)) {
    const blockRe = /model\s+(\w+)\s*\{([^}]*)\}/g
    for (const m of content.matchAll(blockRe)) {
      const mapMatch = m[2].match(/@@map\s*\(\s*['"]([^'"]+)['"]/)
      const tableName = mapMatch ? mapMatch[1] : snakeCase(m[1])
      push({ name: tableName, kind: 'prisma', file: rel })
    }
    return out
  }

  // ---- Knex migrations: schema.createTable('name', ...)
  if (/migrations?\//.test(rel) || /(?:^|\/)knexfile\./.test(rel)) {
    const knexRe = /(?:schema|knex)\.\s*(?:createTable|createTableIfNotExists)\s*\(\s*['"]([^'"]+)['"]/g
    for (const m of content.matchAll(knexRe)) {
      push({ name: m[1], kind: 'knex', file: rel })
    }
  }

  // ---- SQLAlchemy / Django: __tablename__ = 'name'  /  db_table = 'name'
  for (const m of content.matchAll(/__tablename__\s*=\s*['"]([^'"]+)['"]/g)) {
    push({ name: m[1], kind: 'sqlalchemy', file: rel })
  }
  for (const m of content.matchAll(/db_table\s*=\s*['"]([^'"]+)['"]/g)) {
    push({ name: m[1], kind: 'sqlalchemy', file: rel })
  }

  // ---- ActiveRecord (Rails): class Foo < ApplicationRecord  →  table inferred
  if (/(?:^|\/)app\/models\/[a-z0-9_]+\.rb$/.test(rel)) {
    const m = content.match(/class\s+(\w+)\s*<\s*(?:ApplicationRecord|ActiveRecord::Base)/)
    if (m) push({ name: pluralizeSnake(m[1]), kind: 'rails', file: rel })
  }

  // ---- Raw SQL referenced in any source file (best-effort, single-quoted
  //      string literals containing recognizable SQL verbs).
  const sqlRe = /\b(?:from|join|update|into|table)\s+([a-z_][a-z0-9_]{2,})/gi
  // Only scan files likely to contain SQL: SQL files, repo / dao / model
  // dirs, or files with explicit raw-SQL strings.
  const looksLikeSqlHost = /\.sql$/i.test(rel)
    || /(repos?|dao|models?|queries?|database|db)\//i.test(rel)
    || /(SELECT|INSERT|UPDATE|DELETE)\s+/.test(content)
  if (looksLikeSqlHost) {
    // Reject super-common false-positive words to keep the list useful.
    const SQL_NOISE = new Set([
      'the', 'this', 'that', 'next', 'select', 'where', 'from', 'on', 'as',
      'set', 'and', 'or', 'in', 'is', 'not', 'null', 'true', 'false',
    ])
    let count = 0
    for (const m of content.matchAll(sqlRe)) {
      const name = m[1].toLowerCase()
      if (SQL_NOISE.has(name)) continue
      if (count++ > 20) break  // cap per-file
      push({ name, kind: 'sql', file: rel })
    }
  }

  return out
}

// ----- helpers ---------------------------------------------------------------

function snakeCase(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
}
function pluralizeSnake(s: string): string {
  const snake = snakeCase(s)
  if (/(s|x|z|ch|sh)$/.test(snake)) return snake + 'es'
  if (/y$/.test(snake) && !/[aeiou]y$/.test(snake)) return snake.replace(/y$/, 'ies')
  return snake + 's'
}

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.newton', '.newton-cache',
  'coverage', '__pycache__', '.cache', '.turbo', 'vendor', '.gradle', 'target',
])

const SCAN_EXTS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.cs', '.php',
  '.prisma', '.sql',
])

async function collectFiles(rootDir: string): Promise<{ abs: string; rel: string }[]> {
  const results: { abs: string; rel: string }[] = []
  const walk = async (absDir: string, relDir: string) => {
    let entries
    try { entries = await fs.readdir(absDir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry.name)) continue
      const abs = path.join(absDir, entry.name)
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        await walk(abs, rel)
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase()
        if (SCAN_EXTS.has(ext) || /routes\.rb$/.test(entry.name)) {
          results.push({ abs, rel })
        }
      }
    }
  }
  await walk(rootDir, '')
  return results
}
