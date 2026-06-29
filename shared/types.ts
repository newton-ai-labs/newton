// Shared types between client and server.

/** Wire protocol a provider speaks — determines how we format requests/parse streams. */
export type ProviderProtocol = 'openai-compat' | 'anthropic' | 'ollama'

export type Provider =
  | 'demo'
  | 'openai'
  | 'anthropic'
  | 'ollama'
  | 'groq'
  | 'mistral'
  | 'deepseek'
  | 'openrouter'
  | 'together'
  | 'xai'
  | 'gemini'

/** Static metadata for each provider — the single source of truth. */
export interface ProviderDef {
  id: Provider
  name: string
  desc: string
  /** hex color for the icon chip */
  color: string
  /** lucide-react icon name */
  icon: string
  models: string[]
  needsKey: boolean
  needsBaseUrl: boolean
  protocol: ProviderProtocol
  defaultBaseUrl: string
  keyHint: string
}

/**
 * The provider registry. To add a new provider, add ONE entry here.
 * Everything else (server dispatch, settings UI, status bar) is driven by this table.
 */
export const PROVIDER_REGISTRY: ProviderDef[] = [
  {
    id: 'demo',
    name: 'Demo (no key)',
    desc: 'Built-in offline assistant — try Newton with zero setup.',
    color: '#7c5cff',
    icon: 'Zap',
    models: ['demo'],
    needsKey: false,
    needsBaseUrl: false,
    protocol: 'openai-compat',
    defaultBaseUrl: '',
    keyHint: '',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    desc: 'GPT-4o, o1, o3-mini and more.',
    color: '#10a37f',
    icon: 'Cpu',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'o1-preview', 'o1-mini', 'o3-mini'],
    needsKey: true,
    needsBaseUrl: true,
    protocol: 'openai-compat',
    defaultBaseUrl: 'https://api.openai.com/v1',
    keyHint: 'sk-...',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    desc: 'Claude 3.5 Sonnet, Haiku, and Opus.',
    color: '#d97757',
    icon: 'Shield',
    models: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'],
    needsKey: true,
    needsBaseUrl: false,
    protocol: 'anthropic',
    defaultBaseUrl: 'https://api.anthropic.com',
    keyHint: 'sk-ant-...',
  },
  {
    id: 'ollama',
    name: 'Ollama (local)',
    desc: 'Run models locally — free and completely private.',
    color: '#6b7280',
    icon: 'Cpu',
    models: ['llama3.1', 'qwen2.5-coder', 'deepseek-coder-v2', 'mistral', 'phi3'],
    needsKey: false,
    needsBaseUrl: true,
    protocol: 'ollama',
    defaultBaseUrl: 'http://localhost:11434',
    keyHint: '',
  },
  {
    id: 'groq',
    name: 'Groq',
    desc: 'Ultra-low-latency inference. Llama, Mixtral, Gemma.',
    color: '#f55036',
    icon: 'Zap',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768', 'gemma2-9b-it'],
    needsKey: true,
    needsBaseUrl: false,
    protocol: 'openai-compat',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    keyHint: 'gsk_...',
  },
  {
    id: 'mistral',
    name: 'Mistral AI',
    desc: 'Mistral Large, Codestral, and open models.',
    color: '#ff7000',
    icon: 'Cpu',
    models: ['mistral-large-latest', 'mistral-small-latest', 'codestral-latest', 'open-mistral-nemo'],
    needsKey: true,
    needsBaseUrl: false,
    protocol: 'openai-compat',
    defaultBaseUrl: 'https://api.mistral.ai/v1',
    keyHint: '...',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    desc: 'DeepSeek-V3, DeepSeek-R1 — great at reasoning & code.',
    color: '#4d6bfe',
    icon: 'Cpu',
    models: ['deepseek-chat', 'deepseek-reasoner', 'deepseek-coder'],
    needsKey: true,
    needsBaseUrl: false,
    protocol: 'openai-compat',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    keyHint: 'sk-...',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    desc: 'Access 100+ models through one API. GPT, Claude, Llama, Gemini…',
    color: '#8b5cf6',
    icon: 'Share2',
    models: [
      'openai/gpt-4o',
      'openai/gpt-4o-mini',
      'anthropic/claude-3.5-sonnet',
      'anthropic/claude-3.5-haiku',
      'google/gemini-flash-1.5',
      'meta-llama/llama-3.3-70b-instruct',
      'deepseek/deepseek-chat',
      'x-ai/grok-2',
    ],
    needsKey: true,
    needsBaseUrl: false,
    protocol: 'openai-compat',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    keyHint: 'sk-or-...',
  },
  {
    id: 'together',
    name: 'Together AI',
    desc: 'Fast open-source model hosting. Llama, Qwen, CodeLlama.',
    color: '#0f6fff',
    icon: 'Cpu',
    models: [
      'meta-llama/Llama-3.3-70B-Instruct-Turbo',
      'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
      'Qwen/Qwen2.5-Coder-32B-Instruct',
      'codellama/CodeLlama-70b-Instruct-hf',
    ],
    needsKey: true,
    needsBaseUrl: false,
    protocol: 'openai-compat',
    defaultBaseUrl: 'https://api.together.xyz/v1',
    keyHint: '...',
  },
  {
    id: 'xai',
    name: 'xAI (Grok)',
    desc: 'Grok models from xAI.',
    color: '#1d9bf0',
    icon: 'Cpu',
    models: ['grok-2-latest', 'grok-2', 'grok-beta'],
    needsKey: true,
    needsBaseUrl: false,
    protocol: 'openai-compat',
    defaultBaseUrl: 'https://api.x.ai/v1',
    keyHint: 'xai-...',
  },
  {
    id: 'gemini',
    name: 'Google Gemini',
    desc: 'Gemini 2.0 Flash, 1.5 Pro & Flash — via OpenAI-compat endpoint.',
    color: '#4285f4',
    icon: 'Sparkles',
    models: ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-1.5-flash-8b'],
    needsKey: true,
    needsBaseUrl: false,
    protocol: 'openai-compat',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyHint: 'AIza...',
  },
]

export const PROVIDER_MAP: Record<string, ProviderDef> = Object.fromEntries(
  PROVIDER_REGISTRY.map((p) => [p.id, p]),
)

export function getProviderDef(id: string): ProviderDef | undefined {
  return PROVIDER_MAP[id]
}

/** Determine the protocol for a given provider id. Defaults to openai-compat. */
export function getProtocol(id: string): ProviderProtocol {
  return PROVIDER_MAP[id]?.protocol ?? 'openai-compat'
}

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
/**
 * A single find/replace within a `patch` action. `find` must appear EXACTLY
 * once in the target file (else the executor rejects with an explanatory
 * error — multi-match is ambiguous and zero-match means the snippet drifted).
 */
export interface PatchEdit {
  find: string
  replace: string
}

export interface AgentStep {
  id: string
  action: 'create' | 'edit' | 'delete' | 'read' | 'patch'
  path: string
  description: string
  status: 'pending' | 'running' | 'done' | 'error' | 'skipped'
  /** content before edit (for diff) */
  before?: string
  /** proposed/ final content after (used by create/edit) */
  after?: string
  /** find/replace operations applied left-to-right (used by patch) */
  edits?: PatchEdit[]
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

/** Per-provider config stored in Settings. */
export interface PerProviderSettings {
  model: string
  apiKey: string
  baseUrl: string
}

export interface Settings {
  /** Increment when the persisted shape changes so migration can detect old versions. */
  schemaVersion: number
  provider: Provider
  /** Generic per-provider config map — supports any provider in the registry. */
  providerConfigs: Partial<Record<Provider, PerProviderSettings>>
  theme: 'newton-dark' | 'newton-light'
  fontSize: number
  systemPrompt: string
  /**
   * App shell layout.
   *   - 'classic'       — the original VS-Code-style layout (activity bar, tabs, panels)
   *   - 'constellation' — codebase-as-graph view; click a node to zoom into Monaco
   *
   * Defaults to 'classic' until the constellation shell is fully featured.
   */
  layout: 'classic' | 'constellation'
}

/** Current persisted-settings schema version. Bump when shape changes. */
export const SETTINGS_SCHEMA_VERSION = 3

/** Build default provider configs from the registry (first model as default). */
function buildDefaultProviderConfigs(): Partial<Record<Provider, PerProviderSettings>> {
  const map: Partial<Record<Provider, PerProviderSettings>> = {}
  for (const def of PROVIDER_REGISTRY) {
    if (def.id === 'demo') continue
    map[def.id] = {
      model: def.models[0],
      apiKey: '',
      baseUrl: def.defaultBaseUrl,
    }
  }
  return map
}

export const DEFAULT_SETTINGS: Settings = {
  schemaVersion: SETTINGS_SCHEMA_VERSION,
  provider: 'demo',
  providerConfigs: buildDefaultProviderConfigs(),
  theme: 'newton-dark',
  fontSize: 13,
  systemPrompt:
    'You are Newton, a friendly, expert AI pair programmer embedded in a code editor. Be concise and practical. When sharing code, use fenced code blocks with the language tag. If the user shares a file, use it as context.',
  layout: 'classic',
}

/**
 * Migrate legacy settings (pre-registry) to the new generic format.
 * Legacy shape had openaiModel/openaiApiKey/etc flat fields.
 */
export function migrateSettings(raw: Record<string, unknown>): Settings {
  const rawVersion = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 1

  // If already in new format, deep-merge each provider config with defaults
  if (raw.providerConfigs && typeof raw.providerConfigs === 'object') {
    const mergedConfigs = { ...DEFAULT_SETTINGS.providerConfigs }
    for (const [providerId, userCfgRaw] of Object.entries(raw.providerConfigs as Record<string, unknown>)) {
      const def = mergedConfigs[providerId as Provider]
      const userCfg = (userCfgRaw ?? {}) as Partial<PerProviderSettings>
      mergedConfigs[providerId as Provider] = {
        model: userCfg.model ?? def?.model ?? '',
        apiKey: userCfg.apiKey ?? def?.apiKey ?? '',
        baseUrl: userCfg.baseUrl ?? def?.baseUrl ?? '',
      }
    }
    // Validate provider against the registry
    const knownIds = new Set<string>(PROVIDER_REGISTRY.map((p) => p.id))
    const provider: Provider = typeof raw.provider === 'string' && knownIds.has(raw.provider) ? (raw.provider as Provider) : 'demo'
    return {
      ...DEFAULT_SETTINGS,
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      provider,
      providerConfigs: mergedConfigs,
      theme: raw.theme === 'newton-light' ? 'newton-light' : 'newton-dark',
      fontSize: typeof raw.fontSize === 'number' && raw.fontSize >= 8 && raw.fontSize <= 32 ? raw.fontSize : 13,
      systemPrompt: typeof raw.systemPrompt === 'string' ? raw.systemPrompt : DEFAULT_SETTINGS.systemPrompt,
      layout: raw.layout === 'constellation' ? 'constellation' : 'classic',
    }
  }

  // Legacy (v1) migration — flat openaiModel/openaiApiKey/etc fields
  const legacy = raw as Record<string, string | undefined>
  const configs = buildDefaultProviderConfigs()
  if (legacy.openaiModel || legacy.openaiApiKey || legacy.openaiBaseUrl) {
    configs.openai = {
      ...(configs.openai ?? {}),
      model: legacy.openaiModel || 'gpt-4o-mini',
      apiKey: legacy.openaiApiKey || '',
      baseUrl: legacy.openaiBaseUrl || 'https://api.openai.com/v1',
    }
  }
  if (legacy.anthropicModel || legacy.anthropicApiKey) {
    configs.anthropic = {
      ...(configs.anthropic ?? {}),
      model: legacy.anthropicModel || 'claude-3-5-sonnet-20241022',
      apiKey: legacy.anthropicApiKey || '',
      baseUrl: 'https://api.anthropic.com',
    }
  }
  if (legacy.ollamaModel || legacy.ollamaBaseUrl) {
    configs.ollama = {
      ...(configs.ollama ?? {}),
      model: legacy.ollamaModel || 'llama3.1',
      apiKey: '',
      baseUrl: legacy.ollamaBaseUrl || 'http://localhost:11434',
    }
  }
  void rawVersion // version tracked above; reserved for future versioned migrations
  // Validate provider against the registry — fall back to demo on unknown values
  const knownProviderIds = new Set<string>(PROVIDER_REGISTRY.map((p) => p.id))
  const provider: Provider = typeof raw.provider === 'string' && knownProviderIds.has(raw.provider) ? (raw.provider as Provider) : 'demo'
  return {
    ...DEFAULT_SETTINGS,
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    provider,
    providerConfigs: configs,
    theme: typeof raw.theme === 'string' ? (raw.theme as Settings['theme']) : 'newton-dark',
    fontSize: typeof raw.fontSize === 'number' ? raw.fontSize : 13,
    systemPrompt: typeof raw.systemPrompt === 'string' ? raw.systemPrompt : DEFAULT_SETTINGS.systemPrompt,
    layout: raw.layout === 'constellation' ? 'constellation' : 'classic',
  }
}

// ---------- Composer (multi-file editing) ----------
export interface ComposerRequest {
  instruction: string
  provider: ProviderConfig
  /** files included as context */
  files: { path: string; content: string }[]
  forceDemo?: boolean
}

export interface ComposerFileChange {
  path: string
  /** original content (empty if creating) */
  before: string
  /** proposed new content */
  after: string
  /** one-line summary of what changed */
  description: string
  status: 'pending' | 'accepted' | 'rejected' | 'applied'
}

export interface ComposerResponse {
  changes: ComposerFileChange[]
  summary: string
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
  action: 'create' | 'edit' | 'delete' | 'read' | 'patch'
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
  /**
   * Concrete file action this step performs. When present, the executor
   * runs it directly (no second-tier planning needed).
   */
  action?: 'create' | 'edit' | 'delete' | 'read' | 'patch'
  /** workspace-relative file path for create/edit/delete/read/patch */
  path?: string
  /** full final file content for create/edit */
  after?: string
  /** captured content for diff display */
  before?: string
  /** find/replace edits for patch action */
  edits?: PatchEdit[]
  /** optional agent steps produced for this mission step (legacy two-tier path) */
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
