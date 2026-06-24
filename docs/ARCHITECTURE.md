# 🏗️ Newton — Architecture

Newton is a full-stack AI-native code editor. The frontend is a React SPA; the backend is an Express server that handles file I/O, AI proxying, and codebase indexing.

```
┌─────────────────────────────────────────────────────────┐
│                    Browser (Client)                       │
│                                                          │
│  React 18 + Zustand (state) + Monaco (editor)           │
│                                                          │
│  ┌──────────┐  ┌────────────┐  ┌──────────────────────┐ │
│  │ Sidebar  │  │  Editor    │  │  AI Panel            │ │
│  │ (files)  │  │  (Monaco)  │  │  (Chat/Agent/Voice)  │ │
│  └──────────┘  │  + Terminal│  │  + Copilot + ⌘K     │ │
│                └────────────┘  └──────────────────────┘ │
└─────────────────────────┬───────────────────────────────┘
                          │  HTTP / SSE (Vite proxy)
                          ▼
┌─────────────────────────────────────────────────────────┐
│                  Express Backend (tsx)                   │
│                                                          │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐ │
│  │ File System │  │  AI Router   │  │  Codebase      │ │
│  │ (sandboxed) │  │  (streaming) │  │  Indexer       │ │
│  └─────────────┘  └──────────────┘  └────────────────┘ │
│         │                │                   │          │
│         │           ┌────┴────┐              │          │
│         │           ▼         ▼              │          │
│         │     OpenAI   Anthropic             │          │
│         │     /Ollama  /Demo AI              │          │
└─────────┴───────────────────────────────────┴──────────┘
```

---

## Frontend (`src/`)

| File | Responsibility |
|---|---|
| `main.tsx` | React entry point |
| `App.tsx` | Top-level layout: activity bar, sidebar, editor, AI panel, terminal, status bar |
| `store.ts` | Zustand store — all app state (files, tabs, chat, settings, agents, etc.) |
| `index.css` | Global styles + design tokens (CSS variables) |

### Components (`src/components/`)

| Component | Purpose |
|---|---|
| `FileExplorer.tsx` | File tree with create/delete/rename, nested folders |
| `EditorArea.tsx` | Monaco host + tab bar + Copilot ghost text + ⌘K inline edit |
| `ChatPanel.tsx` | Streaming AI chat with @-mentions, context chips, code-block apply |
| `AgentPanel.tsx` | Agent mode: plan steps, show diffs, accept/reject per step |
| `CommandPalette.tsx` | ⌘P fuzzy file find + commands |
| `SettingsModal.tsx` | Provider config (OpenAI/Anthropic/Ollama), model selection |
| `InlineEditWidget.tsx` | ⌘K inline edit overlay with diff review |
| `TerminalPanel.tsx` | Integrated terminal + NL→shell translation |
| `VoicePanel.tsx` | Voice coding overlay (Web Speech API) |
| `fileIcons.tsx` | Language-specific file icons |

### State Management

All state flows through a single Zustand store (`store.ts`). Key slices:

- **File state:** `tree`, `openTabs`, `activeTabPath`, dirty tracking
- **Chat state:** `messages`, `streaming`, `attachedFiles` (from @-mentions)
- **Agent state:** `agentPlan`, `agentSteps`, `agentRunning`
- **UI state:** `sidebarVisible`, `chatVisible`, `paletteOpen`, `settingsOpen`
- **Settings:** `provider`, `apiKey`, `model`, `baseUrl`

---

## Backend (`server/`)

| File | Responsibility |
|---|---|
| `index.ts` | Express app — all API routes + file system + AI proxy + serve frontend |
| `agent.ts` | Agent mode logic — plan generation, step execution, diff application |
| `demoAi.ts` | Built-in simulated AI (no API key needed) |
| `indexing.ts` | TF-IDF codebase indexer with symbol-aware chunking |

### Request Flow (Chat Example)

1. User types a message in `ChatPanel` with optional `@file` context chips
2. Frontend calls `POST /api/chat` with `{ messages, context, attachedFiles, provider, apiKey, model }`
3. Server (`index.ts:238`):
   - Runs `getContextForQuery()` against the TF-IDF index to find relevant code
   - Builds a system prompt including: retrieved context + attached files + active file
   - Routes to the AI provider (OpenAI/Anthropic/Ollama/Demo)
   - Streams the response back via **Server-Sent Events (SSE)**
4. Frontend reads the SSE stream and appends tokens to the chat bubble in real-time

### AI Provider Router

The server abstracts providers behind a common interface:

```
provider ∈ { 'demo', 'openai', 'anthropic', 'ollama' }
```

- **Demo:** Returns simulated, helpful responses using `demoAi.ts` — no network calls
- **OpenAI:** Streaming chat completions via `OPENAI_BASE_URL` (supports Azure/proxies)
- **Anthropic:** Streaming via Claude Messages API
- **Ollama:** Local streaming via Ollama's API

All providers stream via SSE for a responsive UX.

---

## Security Model

- **File sandbox:** All file operations resolve to within `NEWTON_WORKSPACE`. Path traversal (`../`) is blocked.
- **API keys:** Stored in browser `localStorage`, sent only to the local server per-request. Never persisted server-side.
- **Exec endpoint:** `/api/exec` runs in the workspace directory — designed for local single-user use only.

---

## Production vs Development

| Mode | Frontend | Backend | How |
|---|---|---|---|
| **Dev** | Vite dev server (5173) | Express via `tsx watch` (8787) | `npm run dev` (concurrently) |
| **Prod** | Served by Express | Express (8787) | `npm run build && npm start` |

In dev mode, Vite proxies `/api/*` to `localhost:8787`. In production, Express serves the built `dist/` folder and the API on a single port.