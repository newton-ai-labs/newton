/**
 * Mission Control — goal-oriented, long-running agent workflows.
 *
 * A Mission is a higher-level abstraction over the agent: instead of a single
 * plan-execute cycle, a Mission pursues a GOAL through phases:
 *
 *   understand → plan → execute → verify → report
 *
 * Each phase produces artifacts (a plan, executed steps, test/build outcomes)
 * and the mission only reports "done" when its defined OUTCOMES pass.
 * This makes Newton genuinely useful for multi-step refactors, feature
 * implementation, and "fix all the failing tests" style work.
 */

import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import type {
  Mission,
  MissionOutcome,
  MissionStep,
} from '../shared/types.js'

const WORKSPACE = process.env.NEWTON_WORKSPACE
  ? path.resolve(process.env.NEWTON_WORKSPACE)
  : process.cwd()

// ---------- in-memory mission store ----------
// (Persisted to disk in a real multi-session scenario; here per-process.)
const missions = new Map<string, Mission>()

export function createMission(goal: string, contextFiles: string[] = []): Mission {
  const now = Date.now()
  const mission: Mission = {
    id: randomUUID(),
    goal,
    status: 'planning',
    phase: 'understand',
    steps: [],
    outcomes: [],
    createdAt: now,
    updatedAt: now,
    contextFiles,
  }
  missions.set(mission.id, mission)
  return mission
}

export function getMission(id: string): Mission | undefined {
  return missions.get(id)
}

export function listMissions(): Mission[] {
  return [...missions.values()].sort((a, b) => b.updatedAt - a.updatedAt)
}

export function updateMission(id: string, patch: Partial<Mission>): Mission | undefined {
  const m = missions.get(id)
  if (!m) return undefined
  const updated = { ...m, ...patch, updatedAt: Date.now() }
  missions.set(id, updated)
  return updated
}

export function deleteMission(id: string): boolean {
  return missions.delete(id)
}

// ---------- demo mission planner ----------
/**
 * Heuristic planner that turns a goal into structured MissionSteps + Outcomes.
 * In demo mode we recognize common goal patterns and produce real, useful plans.
 * With an LLM provider, we call llmMissionPlan() instead.
 */

export function demoMissionPlan(goal: string): { steps: MissionStep[]; outcomes: MissionOutcome[]; summary: string } {
  const g = goal.toLowerCase()
  const steps: MissionStep[] = []
  const outcomes: MissionOutcome[] = []
  let n = 0
  const stepId = () => `mstep-${++n}`

  // Pattern: "add tests for <file>" / "test the X module"
  const testMatch = goal.match(/(?:add\s+)?tests?\s+(?:for|of|to|covering)\s+[`"']?([\w./-]+)[`"']?/i)
  if (testMatch || /\b(testing|coverage)\b/i.test(g)) {
    const target = testMatch?.[1] ?? 'src'
    steps.push(
      { id: stepId(), description: `Analyze ${target} to identify units to test`, status: 'pending' },
      { id: stepId(), description: `Generate test file for ${target}`, status: 'pending' },
      { id: stepId(), description: `Run tests and fix any failures`, status: 'pending' },
    )
    outcomes.push({
      label: 'Tests pass',
      kind: 'test',
      target: target,
      expected: 'exit code 0',
    })
    outcomes.push({
      label: 'Test file created',
      kind: 'manual',
      target: target,
      expected: 'file exists',
    })
    return {
      steps,
      outcomes,
      summary: `I'll analyze ${target}, generate comprehensive tests, and run them until they pass.`,
    }
  }

  // Pattern: "fix the build" / "make it compile"
  if (/\b(fix|repair|resolve)\b.*\b(build|compile|typescript|tsc)\b/i.test(g) || /\bmake it (compile|build)\b/i.test(g)) {
    steps.push(
      { id: stepId(), description: 'Run the build to capture errors', status: 'pending' },
      { id: stepId(), description: 'Categorize and prioritize errors', status: 'pending' },
      { id: stepId(), description: 'Fix type errors one file at a time', status: 'pending' },
      { id: stepId(), description: 'Re-run build to confirm clean', status: 'pending' },
    )
    outcomes.push({
      label: 'Build succeeds',
      kind: 'build',
      expected: 'exit code 0',
    })
    return {
      steps,
      outcomes,
      summary: "I'll run the build, triage every error, fix them in order, and confirm a clean build.",
    }
  }

  // Pattern: "add a <feature>" / "implement <X>"
  const featMatch = goal.match(/(?:add|implement|create|build)\s+(?:a\s+|an\s+|the\s+)?([\w\s-]+?)(?:\.|$)/i)
  if (featMatch) {
    const feature = featMatch[1].trim()
    steps.push(
      { id: stepId(), description: `Understand requirements for: ${feature}`, status: 'pending' },
      { id: stepId(), description: `Plan file changes needed`, status: 'pending' },
      { id: stepId(), description: `Implement ${feature}`, status: 'pending' },
      { id: stepId(), description: `Add or update tests`, status: 'pending' },
      { id: stepId(), description: `Verify build passes`, status: 'pending' },
    )
    outcomes.push({
      label: 'Build succeeds',
      kind: 'build',
      expected: 'exit code 0',
    })
    outcomes.push({
      label: 'Feature implemented',
      kind: 'manual',
      expected: 'code present and functional',
    })
    return {
      steps,
      outcomes,
      summary: `I'll design ${feature}, implement it across the right files, add tests, and verify the build.`,
    }
  }

  // Pattern: "refactor <X>"
  if (/\brefactor\b/i.test(g)) {
    steps.push(
      { id: stepId(), description: 'Map current structure and dependencies', status: 'pending' },
      { id: stepId(), description: 'Plan refactoring strategy', status: 'pending' },
      { id: stepId(), description: 'Apply refactoring incrementally', status: 'pending' },
      { id: stepId(), description: 'Run tests to confirm behavior preserved', status: 'pending' },
    )
    outcomes.push({
      label: 'Tests pass',
      kind: 'test',
      expected: 'exit code 0',
    })
    outcomes.push({
      label: 'Build succeeds',
      kind: 'build',
      expected: 'exit code 0',
    })
    return {
      steps,
      outcomes,
      summary: "I'll map the current structure, refactor incrementally, and verify behavior is preserved via tests + build.",
    }
  }

  // Generic fallback
  steps.push(
    { id: stepId(), description: 'Break the goal into concrete tasks', status: 'pending' },
    { id: stepId(), description: 'Execute each task', status: 'pending' },
    { id: stepId(), description: 'Verify the outcome', status: 'pending' },
  )
  outcomes.push({
    label: 'Goal achieved',
    kind: 'manual',
    expected: 'user confirms',
  })
  return {
    steps,
    outcomes,
    summary: "I'll break this goal down, work through each piece, and verify the result.",
  }
}

// ---------- outcome verification ----------
/**
 * Verify a single outcome by running the relevant check.
 * Returns { passed, actual }.
 */
export function verifyOutcome(outcome: MissionOutcome): Promise<{ passed: boolean; actual: string }> {
  switch (outcome.kind) {
    case 'build':
      return verifyBuild()
    case 'test':
      return verifyTests(outcome.target)
    case 'lint':
      return verifyLint()
    default:
      // manual / metric — can't auto-verify; leave for user to confirm but
      // don't flag as failed (otherwise the whole mission looks broken).
      return Promise.resolve({ passed: true, actual: 'manual check — confirm in UI' })
  }
}

async function verifyBuild(): Promise<{ passed: boolean; actual: string }> {
  // try npm run build
  try {
    const { execSync } = await import('node:child_process')
    const out = execSync('npm run build 2>&1', {
      cwd: WORKSPACE,
      timeout: 60_000,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { passed: true, actual: 'build succeeded (exit 0)' }
  } catch (e: any) {
    const stderr = (e.stderr ?? e.stdout ?? '').toString().slice(-500)
    return { passed: false, actual: `build failed:\n${stderr}` }
  }
}

async function verifyTests(target?: string): Promise<{ passed: boolean; actual: string }> {
  try {
    const { execSync } = await import('node:child_process')
    const cmd = target && existsSync(path.join(WORKSPACE, target))
      ? `npx vitest run ${target} 2>&1` // or jest
      : 'npm test 2>&1'
    const out = execSync(cmd, {
      cwd: WORKSPACE,
      timeout: 60_000,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const pass = !/failing|failed|FAIL\b/i.test(out)
    const match = out.match(/(\d+)\s+passing/i)
    return {
      passed: pass,
      actual: match ? `${match[1]} tests passing` : 'tests ran',
    }
  } catch (e: any) {
    return { passed: false, actual: `tests failed:\n${((e.stdout ?? '') as string).slice(-500)}` }
  }
}

async function verifyLint(): Promise<{ passed: boolean; actual: string }> {
  try {
    const pkgRaw = await fs.readFile(path.join(WORKSPACE, 'package.json'), 'utf8')
    const pkg = JSON.parse(pkgRaw)
    if (!pkg?.scripts?.lint) {
      return { passed: true, actual: 'no lint script configured — skipped' }
    }
  } catch {
    return { passed: true, actual: 'no package.json — lint skipped' }
  }
  try {
    const { execSync } = await import('node:child_process')
    execSync('npm run lint 2>&1', {
      cwd: WORKSPACE,
      timeout: 30_000,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { passed: true, actual: 'lint clean' }
  } catch (e: any) {
    return { passed: false, actual: `lint errors:\n${((e.stdout ?? '') as string).slice(-500)}` }
  }
}

// ---------- LLM mission planning (real providers) ----------
/**
 * Single-tier planner: the LLM emits the concrete file actions the executor
 * will run directly. Each step is typed (patch|create|edit|delete) with a
 * workspace-relative path. `read` actions are filtered out — they're always
 * no-ops at planning time. No second-pass per-step planning happens.
 *
 * Action shapes:
 *   - patch:  { path, edits: [{find, replace}] }   — preferred for modifications
 *   - edit:   { path, after }                       — full-file rewrite
 *   - create: { path, after }                       — new file
 *   - delete: { path }                              — remove file
 *
 * Inputs:
 *   - workspaceFiles:   relative paths the LLM can target
 *   - relevantContext:  excerpts from semantic search (less authoritative)
 *   - attachedContents: FULL bytes of files the LLM is likely to edit
 *   - repoMap:          per-file outline (path + top-level symbols)
 */
export async function llmMissionPlan(
  goal: string,
  contextFiles: string[],
  complete: (sys: string, user: string) => Promise<string>,
  workspaceFiles: string[] = [],
  relevantContext = '',
  attachedContents: Array<{ path: string; content: string }> = [],
  repoMap = '',
): Promise<{ steps: MissionStep[]; outcomes: MissionOutcome[]; summary: string }> {
  const sys = [
    'You are Newton Mission Control. Given a goal and the current project state, produce a',
    'COMPLETE, EXECUTABLE plan to achieve the goal. Your steps will be run verbatim by an',
    'automated executor — there is no second planning pass and no human review.',
    '',
    'Each step MUST be a concrete file action with an action type and path. Allowed actions:',
    '  - "patch"  — surgical edit. REQUIRED: path, edits ([{find, replace}, ...]). PREFERRED for',
    '               most modifications: emit only the small region you want to change.',
    '               Each `find` MUST appear EXACTLY ONCE in the file; include enough',
    '               surrounding context to make it unique. `replace` is what `find` becomes.',
    '  - "edit"   — full-file rewrite. REQUIRED: path, after (the ENTIRE new file content).',
    '               Use ONLY when most of the file is changing; otherwise prefer "patch".',
    '  - "create" — create a new file. REQUIRED: path, after (the ENTIRE file content).',
    '  - "delete" — remove a file. REQUIRED: path.',
    '',
    'DO NOT use a "read" action. The executor does not feed read results back to you — your',
    'plan is final at submission time. The files you need to see are already in ATTACHED FILE',
    'CONTENTS below. If a file you need is not attached, work from the WORKSPACE FILES manifest',
    'and your knowledge of common project conventions; do not insert read steps as placeholders.',
    '',
    'CRITICAL RULES — violations will be rejected by the executor:',
    '  0. PREFER "patch" over "edit" when changing existing files. A patch is far less likely',
    '     to fail. Each `find` string MUST appear EXACTLY ONCE in the current file content',
    '     (the executor counts occurrences and rejects 0-match or 2+-match). Include 1–3 lines',
    '     of surrounding context to make `find` unique. Keep `find` and `replace` minimal.',
    '  1. For "edit"/"create", `after` MUST be the COMPLETE final file content from the FIRST',
    '     character to the LAST. Not a diff. Not a snippet. Not a summary. Not just the changed',
    '     lines. The string you put in `after` is written verbatim to disk and REPLACES the',
    '     entire file. If you cannot emit the full file in one response, use "patch" instead.',
    '  2. NEVER use placeholders like "// ...existing code...", "// rest unchanged", "...", or',
    '     "// (omitted for brevity)". The executor does not expand placeholders.',
    '  3. When editing, copy ALL existing code from RELEVANT CONTEXT into `after` and then apply',
    '     your changes. The resulting `after` should be a similar length to the original (a few',
    '     lines added/removed is normal; replacing 200 lines with 5 is a bug).',
    '  4. For "edit" or "delete": the `path` MUST appear verbatim in WORKSPACE FILES below.',
    '     Do NOT invent paths like "settings.json", "config.json", or "App.js" if they are not',
    '     in the list — the plan will be rejected. If the file you want does not exist, use',
    '     "create" instead.',
    '  5. For "create": the `path` must follow the project\'s existing layout. If a "src/"',
    '     directory exists, do NOT put app code at the workspace root.',
    '  6. Prefer extending existing files over creating new ones. Only create a new file when',
    '     no suitable existing file applies.',
    '  7. Order steps so each edit can build on prior ones.',
    '  8. Outcomes are how success is measured. Prefer "build" or "test" kinds when applicable;',
    '     fall back to "manual" only for genuinely non-automatable checks.',
    '',
    'Respond with ONLY valid JSON (no prose, no markdown fences) in this shape:',
    '{"summary": string,',
    ' "steps": [{"action":"patch|create|edit|delete", "path": string, "description": string,',
    '            "after"?: string,                       // for create/edit',
    '            "edits"?: [{"find": string, "replace": string}]  // for patch',
    '          }],',
    ' "outcomes": [{"label": string, "kind":"test|build|lint|manual|metric", "target"?: string, "expected"?: string}]}',
  ].join('\n')

  const fileList = workspaceFiles.length > 0
    ? workspaceFiles.slice(0, 200).map((f) => `- ${f}`).join('\n')
    : '(no workspace files indexed yet)'
  const focus = contextFiles.length > 0 ? `\n\nUSER-ATTACHED FILES (focus your edits here when sensible):\n${contextFiles.map((f) => `- ${f}`).join('\n')}` : ''
  // REPO MAP — every file with its top-level symbols. Use this to find
  // integration sites (e.g. "which file renders Settings?") even when the
  // file isn't in ATTACHED FILE CONTENTS.
  const map = repoMap ? `\n\nREPO MAP — every file and its top-level symbols:\n${repoMap}` : ''
  // FULL contents of attached files — the LLM should base its `after` strings
  // on these EXACT bytes, not on its memory of similar files.
  const attached = attachedContents.length > 0
    ? '\n\nATTACHED FILE CONTENTS — when you edit any of these files, your `after` MUST start ' +
      'from this exact content and apply your changes on top. Do not summarize or shorten:\n\n' +
      attachedContents
        .map((f) => `--- BEGIN ${f.path} (${f.content.length} chars) ---\n${f.content}\n--- END ${f.path} ---`)
        .join('\n\n')
    : ''
  const ctx = relevantContext ? `\n\nRELEVANT CONTEXT (excerpts from semantic search; less authoritative than ATTACHED FILE CONTENTS):\n${relevantContext}` : ''
  const user = `GOAL:\n${goal}\n\nWORKSPACE FILES:\n${fileList}${map}${focus}${attached}${ctx}\n\nProduce the executable mission plan JSON now.`

  const raw = await complete(sys, user)
  const json = extractJson(raw)
  if (!json) throw new Error('LLM did not return valid mission plan JSON')

  const allowedActions = new Set(['create', 'edit', 'delete', 'patch'])
  let n = 0
  // Filter out any `read` steps the LLM emitted despite instructions — they
  // are always no-ops at planning time (the executor can't feed results back
  // into the LLM's already-finalized plan) and would inflate the step count.
  const rawSteps = (Array.isArray(json.steps) ? json.steps : []).filter(
    (s: any) => s?.action !== 'read',
  )
  const steps: MissionStep[] = rawSteps.map((s: any) => {
    const action = allowedActions.has(s?.action) ? (s.action as MissionStep['action']) : undefined
    const path = typeof s?.path === 'string' && s.path.trim() ? s.path.trim() : undefined
    const after = typeof s?.after === 'string' ? s.after : undefined
    const edits = Array.isArray(s?.edits)
      ? s.edits
          .filter((e: any) => typeof e?.find === 'string' && typeof e?.replace === 'string')
          .map((e: any) => ({ find: String(e.find), replace: String(e.replace) }))
      : undefined
    const description = String(
      s?.description ?? (action && path ? `${action} ${path}` : (typeof s === 'string' ? s : 'Step')),
    )
    return {
      id: `mstep-${++n}`,
      description,
      status: 'pending' as const,
      action,
      path,
      after,
      edits,
    }
  })

  const outcomes: MissionOutcome[] = (Array.isArray(json.outcomes) ? json.outcomes : []).map((o: any) => ({
    label: String(o?.label ?? 'Outcome'),
    kind: (['test', 'build', 'lint', 'manual', 'metric'].includes(o?.kind) ? o.kind : 'manual') as MissionOutcome['kind'],
    target: o?.target ? String(o.target) : undefined,
    expected: o?.expected ? String(o.expected) : undefined,
  }))

  return {
    steps,
    outcomes,
    summary: String(json.summary ?? 'Mission plan ready.'),
  }
}

function extractJson(text: string): any | null {
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