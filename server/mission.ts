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
      // manual / metric — can't auto-verify
      return Promise.resolve({ passed: false, actual: 'requires manual confirmation' })
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
    const { execSync } = await import('node:child_process')
    const out = execSync('npm run lint 2>&1', {
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
export async function llmMissionPlan(
  goal: string,
  contextFiles: string[],
  complete: (sys: string, user: string) => Promise<string>,
): Promise<{ steps: MissionStep[]; outcomes: MissionOutcome[]; summary: string }> {
  const sys =
    'You are Newton Mission Control. Given a high-level goal and project context, ' +
    'break it into concrete, ordered steps AND define measurable success outcomes. ' +
    'Respond with ONLY valid JSON in this shape:\n' +
    '{"summary": string, "steps": [{"description": string}], "outcomes": [{"label": string, "kind": "test|build|lint|manual|metric", "target"?: string, "expected"?: string}]}'

  const fileList = contextFiles.length > 0 ? contextFiles.map((f) => `- ${f}`).join('\n') : '(none provided)'
  const user = `GOAL:\n${goal}\n\nRELEVANT FILES:\n${fileList}\n\nProduce the mission plan JSON now.`

  const raw = await complete(sys, user)
  const json = extractJson(raw)
  if (!json) throw new Error('LLM did not return valid mission plan JSON')

  let n = 0
  const steps: MissionStep[] = (json.steps ?? []).map((s: any) => ({
    id: `mstep-${++n}`,
    description: String(s.description ?? s),
    status: 'pending' as const,
  }))
  const outcomes: MissionOutcome[] = (json.outcomes ?? []).map((o: any) => ({
    label: String(o.label ?? 'Outcome'),
    kind: (['test', 'build', 'lint', 'manual', 'metric'].includes(o.kind) ? o.kind : 'manual') as MissionOutcome['kind'],
    target: o.target ? String(o.target) : undefined,
    expected: o.expected ? String(o.expected) : undefined,
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