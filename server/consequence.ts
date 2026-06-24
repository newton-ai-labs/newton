/**
 * RecourseOS — the Consequence Engine.
 *
 * Before the agent executes any plan, every step is assessed for:
 *   - Destructiveness (delete > edit > create)
 *   - Blast radius (how many dependent files could break)
 *   - Sensitivity (touching config, secrets, lockfiles, CI, migrations)
 *   - Mass (huge churn / generated files)
 *   - Safety (irreversible ops, force pushes, rm -rf)
 *
 * The engine returns a ConsequenceReport that the UI uses to gate execution
 * behind approval confirmations. This is the "measure twice, cut once" layer
 * that makes Newton safer than a fire-and-forget agent.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type {
  AgentStep,
  ConsequenceFlag,
  ConsequenceReport,
  RiskLevel,
  Reversibility,
  StepAssessment,
} from '../shared/types.js'

const WORKSPACE = process.env.NEWTON_WORKSPACE
  ? path.resolve(process.env.NEWTON_WORKSPACE)
  : process.cwd()

// ---------- sensitivity heuristics ----------

/** Files where a mistake is expensive: config, secrets, CI, infra, migrations. */
const SENSITIVE_PATTERNS: Array<{ pattern: RegExp; reason: string; weight: number }> = [
  { pattern: /(^|\/)\.env(\.|$)/i, reason: 'Environment / secrets file', weight: 40 },
  { pattern: /(^|\/)package\.json$/i, reason: 'Dependency manifest', weight: 25 },
  { pattern: /(^|\/)package-lock\.json$|yarn\.lock$|pnpm-lock\.yaml$|Cargo\.lock$|poetry\.lock$/i, reason: 'Lockfile (mass churn)', weight: 30 },
  { pattern: /(^|\/)(tsconfig|jsconfig|vite\.config|webpack\.config|rollup\.config)\./i, reason: 'Build configuration', weight: 20 },
  { pattern: /(^|\/)\.github\/(workflows|actions)\//i, reason: 'CI/CD pipeline', weight: 35 },
  { pattern: /(^|\/)(Dockerfile|docker-compose)/i, reason: 'Container definition', weight: 25 },
  { pattern: /(^|\/)(terraform|.*\.tf)$/i, reason: 'Infrastructure as Code', weight: 35 },
  { pattern: /migrat/i, reason: 'Database migration', weight: 30 },
  { pattern: /(^|\/)(LICENSE|COPYING)/i, reason: 'License file', weight: 15 },
  { pattern: /(^|\/)\.git\/(config|HEAD|hooks)/i, reason: 'Git internals', weight: 50 },
  { pattern: /(^|\/)(README|CHANGELOG|CONTRIBUTING)/i, reason: 'Project documentation', weight: 10 },
]

/** Directories where deletions are catastrophic. */
const PROTECTED_DIRS = [/node_modules/i, /\.git/i, /dist/i, /build/i, /\.next/i, /vendor/i]

/** Extensions that are typically generated (mass edits here are noisy). */
const GENERATED_EXT = /\.(min\.js|min\.css|map|lock|snap)$/i

// ---------- risk math ----------

const RISK_RANK: Record<RiskLevel, number> = {
  safe: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
}

function maxRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  return RISK_RANK[a] >= RISK_RANK[b] ? a : b
}

function scoreToRisk(score: number): RiskLevel {
  if (score >= 90) return 'safe'
  if (score >= 70) return 'low'
  if (score >= 45) return 'medium'
  if (score >= 20) return 'high'
  return 'critical'
}

function linesChanged(before?: string, after?: string): number {
  if (before == null || after == null) return 0
  const b = before.split('\n')
  const a = after.split('\n')
  // simple LCS-free estimate
  const max = Math.max(b.length, a.length)
  const min = Math.min(b.length, a.length)
  return Math.abs(max - min) + Math.round(min * 0.1)
}

/** Does the file exist and is it tracked by git? (cheap proxy via .git existence) */
function isTrackedByGit(relPath: string): boolean {
  return existsSync(path.join(WORKSPACE, '.git'))
}

// ---------- per-step assessment ----------

function assessStep(step: AgentStep, allPaths: Set<string>): StepAssessment {
  const flags: ConsequenceFlag[] = []
  let safety = 100 // start safe, subtract for issues
  let reversibility: Reversibility = 'trivial'

  // 1. Action destructiveness
  if (step.action === 'delete') {
    flags.push({
      code: 'DELETE',
      message: `Deletes ${step.path}`,
      dimension: 'destructive',
      weight: 35,
    })
    safety -= 35
    reversibility = isTrackedByGit(step.path) ? 'git' : 'irreversible'
  } else if (step.action === 'edit') {
    safety -= 5
    reversibility = isTrackedByGit(step.path) ? 'git' : 'difficult'
  } else if (step.action === 'create') {
    // safe by default
    reversibility = 'trivial'
  } else {
    // read
    reversibility = 'trivial'
    safety = 100
  }

  // 2. Sensitive file patterns
  for (const p of SENSITIVE_PATTERNS) {
    if (p.pattern.test(step.path)) {
      flags.push({
        code: 'SENSITIVE',
        message: `${p.reason}: ${step.path}`,
        dimension: 'sensitive',
        weight: p.weight,
      })
      safety -= p.weight
      if (p.weight >= 35) reversibility = 'difficult'
    }
  }

  // 3. Protected directory deletion
  if (step.action === 'delete') {
    for (const pd of PROTECTED_DIRS) {
      if (pd.test(step.path)) {
        flags.push({
          code: 'PROTECTED_DIR',
          message: `Removes protected/system directory: ${step.path}`,
          dimension: 'destructive',
          weight: 60,
        })
        safety -= 60
        reversibility = 'irreversible'
      }
    }
  }

  // 4. Mass / churn detection
  const volume = linesChanged(step.before, step.after)
  if (step.action === 'edit' && volume > 200) {
    flags.push({
      code: 'MASS_EDIT',
      message: `Large edit: ~${volume} lines changed in ${step.path}`,
      dimension: 'mass',
      weight: 20,
    })
    safety -= 20
  }
  if (GENERATED_EXT.test(step.path)) {
    flags.push({
      code: 'GENERATED',
      message: `Editing a generated/vendored file: ${step.path}`,
      dimension: 'mass',
      weight: 15,
    })
    safety -= 15
  }

  // 5. Wildcard / dangerous content in "after"
  const after = step.after ?? ''
  if (/rm\s+-rf/i.test(after)) {
    flags.push({
      code: 'RM_RF',
      message: 'Content contains `rm -rf` — extremely dangerous',
      dimension: 'safety',
      weight: 80,
    })
    safety -= 80
    reversibility = 'irreversible'
  }
  if (/git\s+push\s+.*--force/i.test(after)) {
    flags.push({
      code: 'FORCE_PUSH',
      message: 'Content contains force-push — rewrites history',
      dimension: 'safety',
      weight: 70,
    })
    safety -= 70
    reversibility = 'irreversible'
  }
  if (/(sudo|chmod\s+777)/i.test(after)) {
    flags.push({
      code: 'PRIVILEGE',
      message: 'Content references privilege escalation',
      dimension: 'safety',
      weight: 40,
    })
    safety -= 40
  }

  // 6. Blast radius: does this path appear as a dependency of others?
  //    (We approximate by counting how many other steps touch related paths.)
  const dir = path.dirname(step.path)
  const related = [...allPaths].filter(
    (p) => p !== step.path && (p.startsWith(dir + '/') || p === dir),
  )
  if (related.length >= 3) {
    flags.push({
      code: 'BLAST_RADIUS',
      message: `${related.length} other changes in the same area (${dir}/)`,
      dimension: 'blast-radius',
      weight: 10,
    })
    safety -= 10
  }

  safety = Math.max(0, Math.min(100, safety))
  return {
    stepId: step.id,
    path: step.path,
    action: step.action,
    risk: scoreToRisk(safety),
    reversibility,
    changeVolume: volume || undefined,
    flags,
    safetyScore: safety,
  }
}

// ---------- public API ----------

/**
 * Assess an entire plan and return a ConsequenceReport.
 * Optionally pass dependency edges (from repo graph) to compute true blast radius.
 */
export function assessPlan(
  steps: AgentStep[],
  opts?: { dependencyEdges?: Array<{ source: string; target: string }> },
): ConsequenceReport {
  const allPaths = new Set(steps.map((s) => s.path))
  const stepReports = steps.map((s) => assessStep(s, allPaths))

  let overallRisk: RiskLevel = 'safe'
  let hasIrreversible = false
  let minScore = 100

  for (const sr of stepReports) {
    overallRisk = maxRisk(overallRisk, sr.risk)
    if (sr.reversibility === 'irreversible') hasIrreversible = true
    minScore = Math.min(minScore, sr.safetyScore)
  }

  // Blast radius from dependency graph
  let blastRadius = 0
  if (opts?.dependencyEdges && opts.dependencyEdges.length > 0) {
    const impacted = new Set<string>()
    for (const s of steps) {
      const direct = opts.dependencyEdges
        .filter((e) => e.source === s.path)
        .map((e) => e.target)
      direct.forEach((d) => impacted.add(d))
    }
    blastRadius = impacted.size
  } else {
    // heuristic: count related files in steps
    blastRadius = stepReports.filter((s) => s.risk !== 'safe').length
  }

  // Approval gate: any high/critical risk, or any irreversible op, or large blast radius
  const requiresApproval =
    RISK_RANK[overallRisk] >= RISK_RANK.high ||
    hasIrreversible ||
    blastRadius >= 8

  const recommendations: string[] = []
  if (hasIrreversible) {
    recommendations.push('⚠️ This plan includes irreversible operations. Review carefully before approving.')
  }
  if (overallRisk === 'critical') {
    recommendations.push('🔴 Critical risk detected. Consider breaking this into smaller, reversible steps.')
  }
  if (blastRadius >= 8) {
    recommendations.push(`High blast radius (${blastRadius} potentially affected files). Run tests after execution.`)
  }
  if (stepReports.some((s) => s.flags.some((f) => f.code === 'MASS_EDIT'))) {
    recommendations.push('Large edits detected. Diff each file before accepting.')
  }
  if (stepReports.some((s) => s.flags.some((f) => f.code === 'RM_RF'))) {
    recommendations.push('🚨 `rm -rf` detected in generated content. This is almost certainly unintended.')
  }
  if (recommendations.length === 0 && overallRisk === 'safe') {
    recommendations.push('✅ All changes are low-risk and reversible.')
  }

  const summary = buildSummary(stepReports, overallRisk, blastRadius)

  return {
    steps: stepReports,
    overallRisk,
    requiresApproval,
    hasIrreversible,
    blastRadius,
    overallSafetyScore: minScore,
    summary,
    recommendations,
  }
}

function buildSummary(
  steps: StepAssessment[],
  risk: RiskLevel,
  blastRadius: number,
): string {
  const counts = {
    create: 0,
    edit: 0,
    delete: 0,
    read: 0,
  } as Record<string, number>
  for (const s of steps) counts[s.action] = (counts[s.action] ?? 0) + 1

  const parts: string[] = []
  if (counts.create) parts.push(`${counts.create} create`)
  if (counts.edit) parts.push(`${counts.edit} edit`)
  if (counts.delete) parts.push(`${counts.delete} delete`)
  if (counts.read) parts.push(`${counts.read} read`)

  const riskLabel =
    risk === 'safe'
      ? 'safe'
      : risk === 'low'
        ? 'low risk'
        : risk === 'medium'
          ? 'medium risk'
          : risk === 'high'
            ? '⚠️ high risk'
            : '🔴 critical risk'

  return `${parts.join(', ') || 'no changes'} · ${riskLabel} · blast radius ${blastRadius}`
}

/**
 * Decide whether a given risk level is auto-approvable based on settings.
 * Default policy: safe/low auto-run; medium+ requires a click; critical requires typing a confirmation.
 */
export function autoApprovable(report: ConsequenceReport): boolean {
  if (report.hasIrreversible) return false
  return RISK_RANK[report.overallRisk] <= RISK_RANK.low
}