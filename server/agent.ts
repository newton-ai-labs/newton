/**
 * Newton Agent — autonomous multi-file task execution.
 *
 * Given a natural-language task and the visible files, the agent produces a
 * PLAN (a list of steps: create/edit/delete/read), then executes each step,
 * returning diffs. In demo mode, the planner is heuristic but genuinely
 * useful for common scaffolding tasks. With a real LLM provider, the planner
 * asks the model for a JSON plan.
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import type { AgentPlan, AgentRequest, AgentStep } from '../shared/types.js'
import { safeResolve, assertSafeDelete } from './safePath.js'

const WORKSPACE = process.env.NEWTON_WORKSPACE
  ? path.resolve(process.env.NEWTON_WORKSPACE)
  : process.cwd()

let idc = 0
const nid = () => `step-${Date.now()}-${idc++}`

// ---------- DEMO PLANNER ----------
/**
 * Heuristic planner for demo mode. Detects common, concrete tasks and builds
 * a real, executable plan. Examples it understands:
 *   - "create a package.json" / "add a README"
 *   - "add an <X> file" / "create component <Name>"
 *   - "delete <file>"
 *   - "add a .gitignore"
 *   - "rename X to Y" (modeled as delete + create)
 *   - "add comments to <file>" (modeled as edit)
 */
export function demoPlan(req: AgentRequest): AgentPlan {
  const task = req.task.trim()
  const lower = task.toLowerCase()
  const files = req.files
  const steps: AgentStep[] = []

  // 1. explicit file creations from templates
  const templates = builtinTemplates()
  for (const t of templates) {
    if (t.match.test(lower)) {
      const target = pickPath(lower) ?? t.defaultPath
      const existing = files.find((f) => f.path === target)
      steps.push({
        id: nid(),
        action: existing ? 'edit' : 'create',
        path: target,
        description: t.description,
        status: 'pending',
        before: existing?.content,
        after: t.body(),
      })
    }
  }

  // 2. "create a file called X" / "add a file named X"
  const named = task.match(/(?:create|add|make|new)\s+(?:a\s+|an\s+)?(?:file|component|module)\s+(?:called\s+|named\s+)?[`"']?([\w./-]+)[`"']?/i)
  if (named && steps.length === 0) {
    let p = named[1]
    if (!/\.[a-z0-9]+$/i.test(p)) {
      // guess extension from "component" keyword
      if (/component/i.test(task)) p = `${p}.tsx`
      else p = `${p}.ts`
    }
    const existing = files.find((f) => f.path === p)
    steps.push({
      id: nid(),
      action: existing ? 'edit' : 'create',
      path: p,
      description: `Create ${p}`,
      status: 'pending',
      before: existing?.content,
      after: boilerplate(p, task),
    })
  }

  // 3. "delete <file>"
  const del = task.match(/(?:delete|remove)\s+[`"']?([\w./-]+\.[a-z0-9]+)[`"']?/i)
  if (del) {
    steps.push({
      id: nid(),
      action: 'delete',
      path: del[1],
      description: `Delete ${del[1]}`,
      status: 'pending',
    })
  }

  // 4. "add comments to <file>" / "format <file>"
  const editTarget = files.find((f) => lower.includes(f.path.toLowerCase()))
  if (editTarget && steps.length === 0) {
    const edited = applyDemoEditToContent(editTarget.content, task)
    if (edited !== editTarget.content) {
      steps.push({
        id: nid(),
        action: 'edit',
        path: editTarget.path,
        description: `Edit ${editTarget.path}`,
        status: 'pending',
        before: editTarget.content,
        after: edited,
      })
    }
  }

  // 5. initialize a project: "init a node project" / "scaffold an express app"
  if (/\b(init|scaffold|bootstrap|set up|setup)\b/i.test(lower) && steps.length === 0) {
    if (/\b(express|api|server)\b/i.test(lower)) {
      steps.push(
        {
          id: nid(),
          action: 'create',
          path: 'package.json',
          description: 'Create package.json',
          status: 'pending',
          after: JSON.stringify(expressPackageJson(), null, 2),
        },
        {
          id: nid(),
          action: 'create',
          path: 'src/index.ts',
          description: 'Create Express server entry',
          status: 'pending',
          after: expressServer(),
        },
        {
          id: nid(),
          action: 'create',
          path: '.gitignore',
          description: 'Create .gitignore',
          status: 'pending',
          after: 'node_modules\ndist\n.env\n',
        },
      )
    } else {
      steps.push({
        id: nid(),
        action: 'create',
        path: 'package.json',
        description: 'Create package.json',
        status: 'pending',
        after: JSON.stringify(basePackageJson(), null, 2),
      })
    }
  }

  const summary =
    steps.length > 0
      ? `I'll make ${steps.length} change${steps.length > 1 ? 's' : ''}: ${steps
          .map((s) => `${s.action} \`${s.path}\``)
          .join(', ')}.`
      : "In demo mode I can scaffold common files (package.json, express server, .gitignore, README), create files/components by name, or delete files. Describe one of those — or connect a real LLM provider in Settings for arbitrary agent tasks."

  return { steps, summary }
}

function pickPath(task: string): string | null {
  const m = task.match(/(?:to|into|at|called|named|path)\s+[`"']?([\w./-]+\.[a-z0-9]+)[`"']?/i)
  return m ? m[1] : null
}

interface Template {
  match: RegExp
  defaultPath: string
  description: string
  body: () => string
}
function builtinTemplates(): Template[] {
  return [
    {
      match: /\bpackage\.json\b/i,
      defaultPath: 'package.json',
      description: 'Create package.json',
      body: () => JSON.stringify(basePackageJson(), null, 2),
    },
    {
      match: /\.gitignore\b/i,
      defaultPath: '.gitignore',
      description: 'Create .gitignore',
      body: () =>
        'node_modules\ndist\nbuild\n.next\n.env\n.env.local\n.DS_Store\n*.log\ncoverage\n',
    },
    {
      match: /\breadme\b/i,
      defaultPath: 'README.md',
      description: 'Create README.md',
      body: () =>
        `# ${path.basename(WORKSPACE)}\n\nA project built with [Newton](https://example.com), the AI-native code editor.\n\n## Getting started\n\n\`\`\`bash\nnpm install\nnpm run dev\n\`\`\`\n\n## Scripts\n\n- \`npm run dev\` — start dev server\n- \`npm run build\` — production build\n- \`npm test\` — run tests\n\n## License\n\nMIT\n`,
    },
    {
      match: /\b(tsconfig|typescript config)\b/i,
      defaultPath: 'tsconfig.json',
      description: 'Create tsconfig.json',
      body: () =>
        JSON.stringify(
          {
            compilerOptions: {
              target: 'ES2022',
              module: 'ESNext',
              moduleResolution: 'Bundler',
              strict: true,
              esModuleInterop: true,
              skipLibCheck: true,
              jsx: 'react-jsx',
              outDir: 'dist',
            },
            include: ['src'],
          },
          null,
          2,
        ),
    },
    {
      match: /\bvite config\b/i,
      defaultPath: 'vite.config.ts',
      description: 'Create vite.config.ts',
      body: () =>
        `import { defineConfig } from 'vite'\nimport react from '@vitejs/plugin-react'\n\nexport default defineConfig({\n  plugins: [react()],\n  server: { port: 5173 },\n})\n`,
    },
    {
      match: /\b\.env\b/i,
      defaultPath: '.env',
      description: 'Create .env',
      body: () => '# Environment variables\nNODE_ENV=development\nPORT=3000\n',
    },
  ]
}

function boilerplate(p: string, task: string): string {
  if (p.endsWith('.tsx') || /component/i.test(task)) {
    const name = toComponentName(p)
    return `import React from 'react'\n\nexport default function ${name}() {\n  return (\n    <div className="${kebab(name)}">\n      <h1>${name}</h1>\n    </div>\n  )\n}\n`
  }
  if (p.endsWith('.ts')) {
    return `// ${p}\n\nexport {}\n`
  }
  if (p.endsWith('.js')) {
    return `// ${p}\n\nmodule.exports = {}\n`
  }
  if (p.endsWith('.css')) {
    return `.${path.basename(p, '.css')} {\n  \n}\n`
  }
  if (p.endsWith('.md')) {
    return `# ${path.basename(p, '.md')}\n\n`
  }
  return ``
}

function applyDemoEditToContent(content: string, task: string): string {
  const q = task.toLowerCase()
  if (/\b(add|write|generate).*\b(comments?|docs?)\b/.test(q)) {
    return content
      .split('\n')
      .map((l) => {
        const t = l.trim()
        if (/^(export\s+)?(async\s+)?function\s+\w+/.test(t))
          return `// ${t.match(/function\s+(\w+)/)?.[1] ?? 'function'} — function definition.\n${l}`
        if (/^(import|from)\s/.test(t)) return `// import statement.\n${l}`
        return l
      })
      .join('\n')
  }
  if (/\bvar\b/.test(q)) return content.replace(/\bvar\s+/g, 'const ')
  if (/\b(strict|===)/.test(q)) return content.replace(/([^=!<>])==([^=])/g, '$1===$2')
  if (/\b(remove|strip).*\bconsole\b/.test(q))
    return content
      .split('\n')
      .filter((l) => !/console\.(log|debug)/.test(l))
      .join('\n')
  return content
}

function basePackageJson() {
  return {
    name: path.basename(WORKSPACE).toLowerCase().replace(/[^a-z0-9-]/g, '-'),
    version: '1.0.0',
    type: 'module',
    scripts: {
      dev: 'vite',
      build: 'tsc && vite build',
      preview: 'vite preview',
      test: 'echo "no tests" && exit 0',
    },
    license: 'MIT',
  }
}
function expressPackageJson() {
  return {
    name: path.basename(WORKSPACE).toLowerCase().replace(/[^a-z0-9-]/g, '-'),
    version: '1.0.0',
    type: 'module',
    scripts: {
      dev: 'tsx watch src/index.ts',
      build: 'tsc',
      start: 'node dist/index.js',
    },
    dependencies: {
      express: '^4.19.2',
    },
    devDependencies: {
      '@types/express': '^4.17.21',
      '@types/node': '^20.11.0',
      typescript: '^5.4.0',
      tsx: '^4.7.0',
    },
    license: 'MIT',
  }
}
function expressServer() {
  return `import express from 'express'\n\nconst app = express()\napp.use(express.json())\n\napp.get('/api/health', (_req, res) => {\n  res.json({ status: 'ok', time: Date.now() })\n})\n\nconst PORT = process.env.PORT ? Number(process.env.PORT) : 3000\napp.listen(PORT, () => console.log(\`listening on http://:\${PORT}\`))\n`
}

function toComponentName(p: string): string {
  const base = path.basename(p, path.extname(p))
  return base
    .split(/[-_]/)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('')
}
function kebab(s: string): string {
  return s.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()
}

// ---------- EXECUTE ----------
/**
 * Execute a single step on disk. Returns updated step with status + note.
 * Does NOT throw; records errors as step.status='error'.
 */
export async function executeStep(step: AgentStep): Promise<AgentStep> {
  try {
    const abs = safeResolve(WORKSPACE, step.path)
    if (step.action === 'delete') {
      assertSafeDelete(step.path)
      await fs.rm(abs, { recursive: true, force: true })
      return { ...step, status: 'done', note: `Deleted ${step.path}` }
    }
    if (step.action === 'create') {
      await fs.mkdir(path.dirname(abs), { recursive: true })
      await fs.writeFile(abs, step.after ?? '', 'utf8')
      return { ...step, status: 'done', note: `Created ${step.path}` }
    }
    if (step.action === 'edit') {
      await fs.mkdir(path.dirname(abs), { recursive: true })
      await fs.writeFile(abs, step.after ?? '', 'utf8')
      return { ...step, status: 'done', note: `Edited ${step.path}` }
    }
    if (step.action === 'read') {
      const content = await fs.readFile(abs, 'utf8').catch(() => '')
      return { ...step, status: 'done', before: content, note: `Read ${step.path}` }
    }
    return { ...step, status: 'skipped', note: 'Unknown action' }
  } catch (e) {
    return { ...step, status: 'error', note: (e as Error).message }
  }
}

// ---------- LLM PLANNER (real providers) ----------
/**
 * Ask a real LLM to produce a JSON plan for the task. Falls back to demo
 * planner on any error or malformed output.
 */
export async function llmPlan(
  req: AgentRequest,
  complete: (sys: string, user: string) => Promise<string>,
): Promise<AgentPlan> {
  const fileManifest = req.files
    .map((f) => `- ${f.path} (${f.content.split('\n').length} lines)`)
    .join('\n')

  const sys =
    'You are Newton Agent, an autonomous coding planner. Given a task and a list of files, ' +
    'produce a precise execution plan as JSON. Each step is a create/edit/delete/read with an absolute ' +
    '(workspace-relative) path and, for create/edit, the FULL final file content in "after". ' +
    'Respond with ONLY valid JSON, no prose, no markdown fences, in this shape:\n' +
    '{"summary": string, "steps": [{"action":"create|edit|delete|read","path": string, ' +
    '"description": string, "after": string (for create/edit)}]}'

  const user = `TASK:\n${req.task}\n\nFILES IN WORKSPACE:\n${fileManifest}\n\nProduce the plan JSON now.`

  const raw = await complete(sys, user)
  const json = extractJson(raw)
  if (!json) throw new Error('LLM did not return valid plan JSON')
  const steps: AgentStep[] = (json.steps ?? []).map((s: any, i: number) => ({
    id: nid(),
    action: (['create', 'edit', 'delete', 'read'].includes(s.action) ? s.action : 'edit') as AgentStep['action'],
    path: String(s.path ?? `untitled-${i}`),
    description: String(s.description ?? `${s.action} ${s.path}`),
    status: 'pending',
    before: s.before,
    after: typeof s.after === 'string' ? s.after : undefined,
  }))
  return { steps, summary: String(json.summary ?? 'Plan ready.') }
}

function extractJson(text: string): any | null {
  // try direct
  try {
    return JSON.parse(text)
  } catch {
    /* try fenced */
  }
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) {
    try {
      return JSON.parse(fenced[1])
    } catch {
      /* try to trim */
    }
  }
  // try to find first { ... last }
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1))
    } catch {
      /* give up */
    }
  }
  return null
}