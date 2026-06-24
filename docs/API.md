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

| Provider | `provider` | `model` examples | `apiKey` | `baseUrl` |
|---|---|---|---|---|
| Demo | `"demo"` | `"demo"` | — | — |
| OpenAI | `"openai"` | `gpt-4o-mini`, `gpt-4o` | ✅ | optional |
| Anthropic | `"anthropic"` | `claude-3-5-sonnet-20241022` | ✅ | — |
| Ollama | `"ollama"` | `llama3.1`, `qwen2.5-coder` | — | optional |

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