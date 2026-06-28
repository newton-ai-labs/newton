# 📡 Newton — API Reference

All endpoints are under `/api` and are served by the Express backend (`server/index.ts`). In development, the Vite proxy forwards `/api/*` to `localhost:8787`.

Base URL: `http://localhost:8787`

---

## Files

### `GET /api/files`
Returns the workspace file tree.

**Response:**
```json
{
  "root": "/absolute/path/to/workspace",
  "tree": {
    "name": "my-project",
    "path": ".",
    "type": "directory",
    "children": [
      { "name": "index.ts", "path": "index.ts", "type": "file" }
    ]
  }
}
```

---

### `GET /api/file?path=<relative-path>`
Reads a file's content.

**Query params:**
| Param | Required | Description |
|---|---|---|
| `path` | ✅ | Relative file path (sandboxed to workspace root) |

**Response:**
```json
{ "path": "src/App.tsx", "content": "import React from 'react'..." }
```

---

### `POST /api/file`
Writes (creates or overwrites) a file. Triggers background reindex.

**Body:**
```json
{ "path": "src/new-file.ts", "content": "export const x = 1" }
```

**Response:** `{ "ok": true, "path": "src/new-file.ts" }`

---

### `POST /api/file/create`
Creates an empty file or directory.

**Body:**
```json
{ "path": "src/new-folder", "type": "directory" }
```

---

### `POST /api/file/rename`
Renames / moves a file or directory.

**Body:**
```json
{ "from": "old-name.ts", "to": "new-name.ts" }
```

---

### `DELETE /api/file?path=<relative-path>`
Deletes a file or directory (recursive for dirs).

---

## Semantic Search & Indexing

### `GET /api/search?q=<query>&limit=<n>`
Searches the codebase using the TF-IDF index with symbol-aware retrieval.

**Query params:**
| Param | Default | Description |
|---|---|---|
| `q` | *(required)* | Natural-language or code query |
| `limit` | `8` | Max results (capped at 30) |

**Response:**
```json
{
  "hits": [
    {
      "filePath": "src/store.ts",
      "startLine": 1,
      "endLine": 45,
      "symbol": "useStore",
      "kind": "function",
      "language": "typescript",
      "score": 0.0823,
      "snippet": "export const useStore = create<State>((set) => ({ ..."
    }
  ]
}
```

---

### `GET /api/index/stats`
Returns indexer statistics.

**Response:**
```json
{
  "totalFiles": 32,
  "totalChunks": 168,
  "indexedAt": 1782308730728,
  "indexing": false,
  "lastQuery": ""
}
```

---

### `POST /api/index/rebuild`
Forces a full reindex. Returns updated stats.

---

## AI Chat (Streaming)

### `POST /api/chat`
Streams an AI response via plain-text chunked transfer (acts like SSE).

**Body:** (`ChatRequest`)
```json
{
  "messages": [
    { "role": "user", "content": "How does the store work?" }
  ],
  "provider": {
    "provider": "openai",
    "model": "gpt-4o-mini",
    "apiKey": "sk-..."
  },
  "activeFile": { "path": "src/store.ts", "content": "..." },
  "attachedFiles": [
    { "path": "src/index.ts", "content": "..." }
  ]
}
```

**Provider configs:**

Newton supports 10 providers via a table-driven registry. All providers use the same `provider` object shape:

| Provider | `provider` | `model` examples | `apiKey` | `baseUrl` | Protocol |
|---|---|---|---|---|---|
| Demo | `"demo"` | `"demo"` | — | — | built-in |
| OpenAI | `"openai"` | `gpt-4o-mini`, `gpt-4o`, `o1` | ✅ | optional | openai |
| Anthropic | `"anthropic"` | `claude-3-5-sonnet-20241022`, `claude-3-5-haiku-20241022` | ✅ | — | anthropic |
| Google Gemini | `"gemini"` | `gemini-1.5-pro`, `gemini-1.5-flash`, `gemini-2.0-flash` | ✅ | — | google |
| Groq | `"groq"` | `llama-3.3-70b-versatile`, `mixtral-8x7b-32768` | ✅ | optional | openai |
| Mistral | `"mistral"` | `mistral-large-latest`, `codestral-latest` | ✅ | optional | openai |
| Together | `"together"` | `meta-llama/Llama-3.3-70B-Instruct-Turbo` | ✅ | optional | openai |
| DeepSeek | `"deepseek"` | `deepseek-chat`, `deepseek-coder` | ✅ | optional | openai |
| Ollama | `"ollama"` | `llama3.1`, `qwen2.5-coder`, `deepseek-r1` | — | optional | ollama |
| LocalAI | `"localai"` | `gpt-4`, custom | — | ✅ required | openai |

> **Protocols:** `openai` = `POST /v1/chat/completions` · `anthropic` = Claude Messages API · `google` = Gemini `streamGenerateContent` · `ollama` = `/api/chat` · `demo` = built-in simulated AI

> **Tip:** Any custom model name can be passed — the examples are defaults. Providers using the `openai` protocol accept a `baseUrl` override for self-hosted or proxy endpoints.

**Response:** Plain-text stream. Tokens are written as they arrive. The stream ends when the response closes.

**Context injection:** The server automatically:
1. Injects the `activeFile` content into the system prompt
2. Injects any `attachedFiles` (@-mentioned) with clear delimiters
3. Runs semantic search on the last user message and injects relevant codebase context

---

## Inline Edit (⌘K)

### `POST /api/edit`
Transforms selected code based on a natural-language instruction.

**Body:** (`EditRequest`)
```json
{
  "code": "function add(a, b) { return a + b }",
  "instruction": "Add type annotations",
  "language": "typescript",
  "path": "src/math.ts",
  "provider": { "provider": "demo", "model": "demo" }
}
```

**Response:** (`EditResponse`)
```json
{
  "code": "function add(a: number, b: number): number { return a + b }",
  "note": "Edited with demo."
}
```

---

## Agent Mode

### `POST /api/agent/plan`
Generates a multi-step execution plan for a task.

**Body:** (`AgentRequest`)
```json
{
  "task": "Add a dark mode toggle to the settings",
  "provider": { "provider": "demo", "model": "demo" },
  "files": [
    { "path": "src/SettingsModal.tsx", "content": "..." }
  ]
}
```

**Response:** (`AgentPlan`)
```json
{
  "summary": "Add a theme toggle to SettingsModal and wire it to localStorage.",
  "steps": [
    {
      "id": "step-1",
      "action": "edit",
      "path": "src/SettingsModal.tsx",
      "description": "Add a theme toggle switch",
      "status": "pending",
      "before": "...",
      "after": "..."
    }
  ]
}
```

**Step actions:** `create` | `edit` | `delete` | `read`

---

### `POST /api/agent/step`
Executes a single step (writes `after` content to disk).

**Body:** An `AgentStep` object (including `action`, `path`, and `after`).

**Response:** `{ "ok": true }` or `{ "error": "..." }`

---

## Consequence Engine (RecourseOS)

### `POST /api/agent/assess`
Risk-assesses one or more proposed agent steps **before** execution. The frontend uses this to gate high-risk / irreversible operations behind explicit approval.

**Body:** `{ "steps": AgentStep[] }`

**Response:** (`ConsequenceReport`)
```json
{
  "steps": [
    {
      "stepId": "step-1",
      "path": "src/store.ts",
      "action": "edit",
      "risk": "low",
      "reversibility": "git",
      "changeVolume": 12,
      "flags": [],
      "safetyScore": 88
    }
  ],
  "overallRisk": "low",
  "requiresApproval": false,
  "hasIrreversible": false,
  "blastRadius": 3,
  "overallSafetyScore": 88,
  "summary": "1 edit to a source file under version control.",
  "recommendations": ["Commit before running to make this reversible via git."]
}
```

**Risk levels:** `safe` < `low` < `medium` < `high` < `critical`
**Reversibility:** `trivial` < `git` < `difficult` < `irreversible`

---

## AI-Powered Source Control (Git)

### `GET /api/git/status`
Returns `git status --porcelain` parsed into structured file entries with staged/unstaged flags.

### `GET /api/git/diff?staged=<bool>&path=<path>`
Returns a unified diff. If `staged=true`, shows staged changes; otherwise the working-tree diff. Optional `path` scopes to one file.

### `POST /api/git/stage` · `POST /api/git/unstage`
**Body:** `{ "path": "src/App.tsx" }` — stages or unstages a single file.

### `POST /api/git/commit`
**Body:** `{ "message": "feat: add toggle" }` — commits staged changes.

### `GET /api/git/log?limit=<n>`
Returns recent commits (`hash`, `message`, `author`, `date`).

### `POST /api/git/init`
Initializes a git repo in the workspace if one doesn't exist.

### `POST /api/git/suggest-commit`
AI-generates a conventional-commit message from a diff.

**Body:** (`CommitSuggestionRequest`)
```json
{ "diff": "diff --git ...", "provider": { "provider": "demo", "model": "demo" } }
```
**Response:** `{ "message": "feat(auth): add login redirect" }`

### `POST /api/git/explain-diff`
Natural-language summary of what a diff changes and why.

**Body:** (`ExplainDiffRequest`) — `{ "diff", "path?", "provider" }`
**Response:** `{ "explanation": "This adds a dark-mode toggle and persists the choice to localStorage..." }`

### `POST /api/git/review`
AI code review of a diff. Returns findings + a health score.

**Body:** (`CodeReviewRequest`) — `{ "diff", "files": ["src/App.tsx"], "provider" }`
**Response:** (`CodeReviewResponse`)
```json
{
  "findings": [
    {
      "severity": "warning",
      "category": "security",
      "message": "User input used directly in SQL query — consider parameterizing.",
      "file": "src/db.ts",
      "line": 42
    }
  ],
  "summary": "Mostly solid; one security concern to address.",
  "score": 78
}
```
**Severities:** `critical` | `warning` | `info` | `praise`
**Categories:** `bug` | `security` | `performance` | `maintainability` | `style`

---

## Repository Dependency Graph

### `GET /api/graph`
Returns the full import dependency graph of the workspace.

**Response:**
```json
{
  "nodes": [
    { "id": "src/App.tsx", "lang": "typescript" }
  ],
  "edges": [
    { "from": "src/App.tsx", "to": "src/store.ts" }
  ]
}
```

### `GET /api/graph/impact?path=<path>`
Computes the **blast radius** of changing a file — all files that transitively depend on it.

**Response:**
```json
{
  "root": "src/store.ts",
  "impacted": ["src/App.tsx", "src/components/ChatPanel.tsx"],
  "count": 2
}
```

---

## Workspace Memory

The memory subsystem persists a per-workspace `WorkspaceMemory` document under `.newton/memory.json`. It captures the detected tech stack, a codebase structure digest, a TODO/FIXME/HACK scan, recently edited files, and user/AI-curated entries (decisions, notes, patterns, tasks). Every mutating endpoint returns the full updated memory object.

### `GET /api/memory`
Returns the full `WorkspaceMemory` object: tech stack, structure digest, TODO/FIXME scan, recent files, and user/AI entries.

**Response:** A `WorkspaceMemory` (returned directly as the JSON body).
```json
{
  "version": 1,
  "workspaceName": "my-project",
  "createdAt": "2026-06-24T15:35:33.983Z",
  "lastVisited": "2026-06-24T15:35:33.983Z",
  "visitCount": 1,
  "techStack": [
    { "name": "Node.js", "category": "runtime" },
    { "name": "TypeScript", "category": "language" },
    { "name": "React", "version": "^18.3.1", "category": "framework" },
    { "name": "Express", "version": "^4.22.2", "category": "framework" }
  ],
  "entries": [],
  "openTasks": [
    { "file": "src/store.ts", "line": 42, "tag": "TODO", "text": "refactor this" }
  ],
  "recentFiles": [
    { "path": "src/App.tsx", "lastSeen": "2026-06-24T19:18:24.171Z" }
  ],
  "digest": {
    "totalFiles": 43,
    "totalLines": 21508,
    "topLanguages": [{ "lang": "TypeScript", "count": 30, "pct": 70 }],
    "generatedAt": "2026-06-24T15:35:34.004Z"
  }
}
```

### `GET /api/memory/welcome`
Builds a natural-language "welcome back" greeting from the memory (tech stack, codebase size, open tasks, recent files, recorded decisions). Used by the Memory panel header.

**Response:**
```json
{ "digest": "👋 Welcome back to **my-project**.\nLast visit: 2d ago · Visit #3.\n\n📦 **Stack:** TypeScript, React, Express\n🔧 **Tools:** Vite, Git\n📊 **Codebase:** 43 files · 21,508 lines\n⚠️ **Open tasks:** 6 markers found\n💡 **Decisions:** 2 recorded" }
```

### `POST /api/memory/refresh`
Re-scans the workspace (tech-stack detection, structure digest, TODO markers) and bumps the visit counter. User-curated `entries` and `recentFiles` are preserved; only auto-detected fields are refreshed.

**Response:** The refreshed `WorkspaceMemory` (returned directly as the JSON body).

### `POST /api/memory/entry`
Adds a manual memory entry (decision / task / note / pattern). New entries are prepended (most recent first).

**Body:**
```json
{
  "type": "decision",
  "text": "We use Zustand for state, not Redux.",
  "source": "manual"
}
```
| field | type | required | description |
|-------|------|----------|-------------|
| `type` | `'decision' \| 'task' \| 'note' \| 'pattern'` | ✅ | Entry category |
| `text` | `string` | ✅ | Non-empty entry text |
| `source` | `string` | ❌ | Optional provenance (e.g. a file path, or `"manual"`) |

**Response:** The updated `WorkspaceMemory` (returned directly as the JSON body).

### `DELETE /api/memory/entry/:id`
Removes a memory entry by its id. The id is a **path parameter**. Removing a non-existent id is a no-op (still returns `200` with the unchanged memory).

**Response:** The updated `WorkspaceMemory` (returned directly as the JSON body).

> 💡 **Response shapes:** Every memory endpoint returns the `WorkspaceMemory` object **directly** as the top-level JSON body (not wrapped under `data` or `memory`), except `/api/memory/welcome` which returns `{ "digest": string }`. The frontend reads these accordingly (`src/store.ts` → `loadMemory`, `refreshMemory`, `addMemoryEntry`, `removeMemoryEntry`).
>
> 💡 The chat endpoint (`POST /api/chat`) automatically injects a compact workspace-memory digest (tech stack + recent entries) into the system prompt.

---

## Mission Control

### `POST /api/missions`
Creates a new mission + generates an initial plan.

**Body:**
```json
{
  "goal": "Add JWT auth to all protected routes",
  "provider": { "provider": "demo", "model": "demo" },
  "contextFiles": ["src/router.ts", "src/middleware.ts"]
}
```
**Response:** A full `Mission` object (see `shared/types.ts`).

### `GET /api/missions`
Lists all missions (newest first).

### `GET /api/missions/:id`
Returns a single mission by id.

### `PATCH /api/missions/:id`
Updates a mission's mutable fields — used to advance step status, pause/resume/cancel the mission, or change its phase.

**Body (all fields optional):**
```json
{
  "status": "paused",
  "phase": "verify",
  "steps": [
    { "id": "s1", "status": "done", "completedAt": 1719000000000 }
  ]
}
```
| field | type | description |
|-------|------|-------------|
| `status` | `MissionStatus` | `planning` \| `running` \| `paused` \| `done` \| `failed` \| `cancelled` |
| `phase` | `MissionPhase` | `understand` \| `plan` \| `execute` \| `verify` \| `report` |
| `steps` | `MissionStep[]` | Updated step array (e.g. mark a step `running`/`done`) |

**Response:** The updated `Mission`.

### `DELETE /api/missions/:id`
Deletes a mission and its history.

### `POST /api/missions/:id/verify`
Runs the mission's defined **outcomes** (build / tests / lint) and records whether each passed, along with metrics.

**Response:** The updated `Mission` with `outcomes[].passed` and `metrics` filled in.

---

## Copilot Autocomplete

### `POST /api/copilot`
Returns a ghost-text completion suggestion.

**Body:**
```json
{
  "code": "function calculateTotal(items) {\n  ",
  "language": "typescript",
  "provider": { "provider": "demo", "model": "demo" }
}
```

**Response:** `{ "suggestion": "return items.reduce((sum, item) => sum + item.price, 0)" }`

---

## Natural-Language Terminal

### `POST /api/nlsh`
Translates a natural-language request into a shell command.

**Body:**
```json
{
  "prompt": "list all files modified in the last 3 days",
  "provider": { "provider": "demo", "model": "demo" }
}
```

**Response:**
```json
{
  "command": "find . -mtime -3 -type f",
  "note": "Translated with openai."
}
```

---

### `POST /api/exec`
Executes a shell command in the workspace directory.

**Body:**
```json
{ "command": "git status" }
```

**Response:**
```json
{
  "stdout": "On branch main...",
  "stderr": "",
  "code": 0
}
```

> ⚠️ **Security:** This runs arbitrary commands. Designed for local single-user use only.

---

## Test Generation

### `POST /api/gen-tests`
Generates a test scaffold for the given source code.

**Body:**
```json
{
  "code": "export function add(a, b) { return a + b }",
  "path": "src/math.ts",
  "language": "typescript",
  "provider": { "provider": "demo", "model": "demo" }
}
```

**Response:**
```json
{
  "tests": "import { add } from './math'\n\ndescribe('math', () => {\n  it('add should work', () => { ... })\n})",
  "note": "Generated with demo."
}
```

---

## Health

### `GET /api/health`
Returns server health and configuration status.

**Response:**
```json
{
  "status": "ok",
  "workspace": "/Users/you/my-project",
  "demo": true,
  "env": {
    "hasOpenaiKey": false,
    "hasAnthropicKey": true
  }
}
```

---

## Error Handling

All endpoints return appropriate HTTP status codes:

| Code | Meaning |
|---|---|
| `200` | Success |
| `400` | Bad request (missing params, invalid input) |
| `404` | File not found |
| `500` | Server error (error message in `{ "error": "..." }`) |

For AI endpoints, errors are streamed as plain text prefixed with `⚠️`:
```
> ⚠️ Error contacting provider: OpenAI 401: Unauthorized
> Switch to Demo mode or add a valid key in Settings.
```
