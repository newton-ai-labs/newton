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

export const PROVIDER_MODELS: Record<Exclude<Provider, 'demo'>, string[]> = {
  openai: ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo', 'gpt-3.5-turbo', 'o1-mini'],
  anthropic: [
    'claude-3-5-sonnet-20241022',
    'claude-3-5-haiku-20241022',
    'claude-3-opus-20240229',
  ],
  ollama: ['llama3.1', 'qwen2.5-coder', 'deepseek-coder-v2', 'mistral'],
}