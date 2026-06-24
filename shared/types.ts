// Shared types between client and server.

export type Provider = 'demo' | 'openai' | 'anthropic' | 'ollama'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface FileNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileNode[]
}

export interface ProviderConfig {
  provider: Provider
  model: string
  apiKey?: string
  baseUrl?: string
}

export interface ChatRequest {
  messages: ChatMessage[]
  provider: ProviderConfig
  activeFile?: { path: string; content: string } | null
  /** @-mentioned files attached by the user for this message */
  attachedFiles?: { path: string; content: string }[]
  /** when true, ignore configured provider and use built-in demo AI */
  forceDemo?: boolean
}

export interface EditRequest {
  /** the code to transform (selection or whole file) */
  code: string
  /** natural-language instruction */
  instruction: string
  /** language id, e.g. 'typescript' */
  language: string
  /** file path, for context */
  path?: string
  provider: ProviderConfig
  forceDemo?: boolean
}

export interface EditResponse {
  code: string
  note?: string
}

// ---------- Agent Mode ----------
export interface AgentStep {
  id: string
  action: 'create' | 'edit' | 'delete' | 'read'
  path: string
  description: string
  status: 'pending' | 'running' | 'done' | 'error' | 'skipped'
  /** content before edit (for diff) */
  before?: string
  /** proposed/ final content after */
  after?: string
  note?: string
}

export interface AgentPlan {
  steps: AgentStep[]
  summary: string
}

export interface AgentRequest {
  task: string
  provider: ProviderConfig
  /** relevant files the agent can see */
  files: { path: string; content: string }[]
  forceDemo?: boolean
}

export interface Settings {
  provider: Provider
  openaiModel: string
  openaiApiKey: string
  openaiBaseUrl: string
  anthropicModel: string
  anthropicApiKey: string
  ollamaModel: string
  ollamaBaseUrl: string
  theme: 'newton-dark' | 'newton-light'
  fontSize: number
  systemPrompt: string
}

export const DEFAULT_SETTINGS: Settings = {
  provider: 'demo',
  openaiModel: 'gpt-4o-mini',
  openaiApiKey: '',
  openaiBaseUrl: 'https://api.openai.com/v1',
  anthropicModel: 'claude-3-5-sonnet-20241022',
  anthropicApiKey: '',
  ollamaModel: 'llama3.1',
  ollamaBaseUrl: 'http://localhost:11434',
  theme: 'newton-dark',
  fontSize: 13,
  systemPrompt:
    'You are Newton, a friendly, expert AI pair programmer embedded in a code editor. Be concise and practical. When sharing code, use fenced code blocks with the language tag. If the user shares a file, use it as context.',
}

// ---------- AI SCM ----------

export interface CommitSuggestionRequest {
  diff: string
  provider: ProviderConfig
  forceDemo?: boolean
}

export interface ExplainDiffRequest {
  diff: string
  /** file path for context */
  path?: string
  provider: ProviderConfig
  forceDemo?: boolean
}

export interface CodeReviewFinding {
  severity: 'critical' | 'warning' | 'info' | 'praise'
  category: 'bug' | 'security' | 'performance' | 'maintainability' | 'style'
  message: string
  file?: string
  line?: number
}

export interface CodeReviewRequest {
  diff: string
  /** changed file paths for context */
  files: string[]
  provider: ProviderConfig
  forceDemo?: boolean
}

export interface CodeReviewResponse {
  findings: CodeReviewFinding[]
  summary: string
  score: number // 0-100 code health
}

export const PROVIDER_MODELS: Record<Exclude<Provider, 'demo'>, string[]> = {
  openai: ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo', 'o1-mini'],
  anthropic: [
    'claude-3-5-sonnet-20241022',
    'claude-3-5-haiku-20241022',
    'claude-3-opus-20240229',
  ],
  ollama: ['llama3.1', 'qwen2.5-coder', 'deepseek-coder-v2', 'mistral'],
}

// ---------- RecourseOS: Consequence Engine ----------
/**
 * Risk classification for a proposed action before it is executed.
 * The agent (or any mutation source) must pass its plan through the
 * Consequence Engine, which returns a risk assessment the UI can gate on.
 */
export type RiskLevel = 'safe' | 'low' | 'medium' | 'high' | 'critical'
export type Reversibility = 'trivial' | 'git' | 'difficult' | 'irreversible'

export interface ConsequenceFlag {
  /** machine-readable reason code */
  code: string
  /** human-readable explanation */
  message: string
  /** which risk dimension this contributes to */
  dimension: 'destructive' | 'blast-radius' | 'sensitive' | 'mass' | 'safety'
  weight: number
}

export interface StepAssessment {
  stepId: string
  path: string
  action: 'create' | 'edit' | 'delete' | 'read'
  risk: RiskLevel
  reversibility: Reversibility
  /** number of lines added/removed if determinable */
  changeVolume?: number
  /** heuristic flags explaining the risk */
  flags: ConsequenceFlag[]
  /** 0-100, higher = safer */
  safetyScore: number
}

export interface ConsequenceReport {
  /** per-step assessments */
  steps: StepAssessment[]
  /** aggregate risk = max step risk */
  overallRisk: RiskLevel
  /** does this plan require explicit approval? */
  requiresApproval: boolean
  /** does this plan contain any irreversible operations? */
  hasIrreversible: boolean
  /** estimated blast radius: number of files beyond the plan that could be affected */
  blastRadius: number
  /** 0-100, higher = safer overall */
  overallSafetyScore: number
  /** short human summary */
  summary: string
  /** recommended guardrails to apply */
  recommendations: string[]
}

// ---------- Mission Control ----------
export type MissionStatus = 'planning' | 'running' | 'paused' | 'done' | 'failed' | 'cancelled'
export type MissionPhase = 'understand' | 'plan' | 'execute' | 'verify' | 'report'

export interface MissionOutcome {
  label: string
  /** e.g. "tests pass", "build succeeds", "lint clean" */
  kind: 'test' | 'build' | 'lint' | 'manual' | 'metric'
  target?: string
  /** expected result: exit code 0, contains, etc. */
  expected?: string
  /** actual result after mission completes (filled in) */
  actual?: string
  passed?: boolean
}

export interface MissionStep {
  id: string
  description: string
  status: 'pending' | 'running' | 'done' | 'error' | 'skipped'
  /** optional agent steps produced for this mission step */
  agentSteps?: AgentStep[]
  note?: string
  startedAt?: number
  completedAt?: number
}

export interface Mission {
  id: string
  goal: string
  status: MissionStatus
  phase: MissionPhase
  steps: MissionStep[]
  outcomes: MissionOutcome[]
  createdAt: number
  updatedAt: number
  /** context: files the mission is concerned with */
  contextFiles: string[]
  summary?: string
  /** metrics from execution (filled in during/after) */
  metrics?: {
    filesChanged: number
    linesAdded: number
    linesRemoved: number
    testsRun?: number
    testsPassed?: number
    buildOk?: boolean
  }
}

// ---------- Workspace Memory ----------
export interface TechStackEntry {
  /** e.g. "React", "TypeScript", "Express" */
  name: string
  /** version if detected, e.g. "18.2.0" */
  version?: string
  /** category: framework, language, build-tool, database, etc. */
  category: string
  /** how confident we are (0-1) */
  confidence: number
}

export type MemoryEntryType = 'decision' | 'task' | 'note' | 'pattern'

export interface MemoryEntry {
  id: string
  type: MemoryEntryType
  text: string
  /** where it came from: 'ai' | 'manual' | 'scan' */
  source: 'ai' | 'manual' | 'scan'
  createdAt: number
}

export interface WorkspaceMemory {
  /** absolute path of the workspace root */
  workspace: string
  /** when the memory was first created */
  createdAt: number
  /** last time refreshMemory() ran */
  lastScannedAt: number
  /** detected tech stack */
  techStack: TechStackEntry[]
  /** project structure summary */
  structure: {
    totalFiles: number
    totalDirs: number
    topDirs: { name: string; fileCount: number; dominantLang?: string }[]
    languages: { name: string; percentage: number }[]
  }
  /** active TODOs/FIXMEs found in the codebase */
  todos: { file: string; line: number; text: string; tag: 'TODO' | 'FIXME' | 'HACK' }[]
  /** user-defined / AI-suggested project facts */
  entries: MemoryEntry[]
  /** files the user opened recently (path -> lastOpenedAt) */
  recentFiles: Record<string, number>
}
