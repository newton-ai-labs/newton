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
| `AgentPanel.tsx` | Agent mode: plan steps, show diffs, accept/reject per step, consequence-gated |
| `CommandPalette.tsx` | ⌘P fuzzy file find + commands |
| `SettingsModal.tsx` | Provider config (OpenAI/Anthropic/Ollama), model selection |
| `InlineEditWidget.tsx` | ⌘K inline edit overlay with diff review |
| `TerminalPanel.tsx` | Integrated terminal + NL→shell translation |
| `VoicePanel.tsx` | Voice coding overlay (Web Speech API) |
| `SourceControlPanel.tsx` | Inline Git: status/stage/commit/log + AI commit messages, explain-diff, code review |
| `GraphPanel.tsx` | Repository dependency graph visualization + impact analysis |
| `MemoryPanel.tsx` | Workspace Memory view — tech stack, TODOs, manual entries, AI refresh |
| `MissionPanel.tsx` | Mission Control — launch/track/verify goal-oriented multi-step workflows |
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
| `repoGraph.ts` | Static import-graph builder + impact/blast-radius analysis |
| `memory.ts` | Workspace memory — tech-stack detection, structure scan, TODO scan, persistence |
| `consequence.ts` | RecourseOS Consequence Engine — risk/blast-radius/reversibility assessment |
| `mission.ts` | Mission Control — long-running goal workflows with verifiable outcomes |

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

## Differentiator Subsystems

### 🔎 Semantic Indexer (`indexing.ts`)
A dependency-free TF-IDF engine with symbol-aware chunking. It splits each file into chunks by symbols (functions, classes, methods) using lightweight regex per language, builds an inverted index, and ranks by TF-IDF cosine similarity. The index rebuilds in the background on every file save and powers `/api/search` and chat auto-context. See [`docs/SEMANTIC_SEARCH.md`](SEMANTIC_SEARCH.md) for a full deep dive.

### 🧠 Workspace Memory (`memory.ts`)
Newton maintains a persistent `WorkspaceMemory` object (JSON in `.newton/memory.json` under the workspace) containing:
- **Tech stack** — detected from manifests (`package.json`, `Cargo.toml`, `go.mod`, etc.) and file extensions
- **Structure** — total files/dirs, top-level directory breakdown, language percentages
- **TODOs/FIXMEs/HACKs** — scanned across the codebase with file + line
- **Entries** — user- and AI-sourced decisions, notes, and patterns

A compact digest of this memory is injected into every chat system prompt, so the AI always knows your stack and conventions. The frontend `MemoryPanel` lets you browse, add, and remove entries and trigger a rescan.

### 🛡️ RecourseOS Consequence Engine (`consequence.ts`)
Before any agent step is applied, it is assessed for risk. The engine evaluates:
- **Destructiveness** — `delete` ops, especially outside version control
- **Blast radius** — files beyond the plan that import or depend on changed files (via `repoGraph.ts`)
- **Sensitivity** — edits to secrets/config/lockfiles/CI
- **Mass** — large change volume or many files at once

Each step gets a `RiskLevel`, `Reversibility`, and `safetyScore` (0–100). The aggregate `ConsequenceReport` tells the UI whether explicit approval is required and flags any irreversible operations. High-risk plans are gated behind an approval dialog in `AgentPanel`.

### 🎯 Mission Control (`mission.ts`)
Missions are long-running, goal-oriented workflows that go beyond single-turn agent edits. A `Mission` has:
- A **goal** and a **plan** (mission steps, each possibly backed by agent steps)
- **Outcomes** — verifiable success criteria (`build` passes, `tests` pass, `lint` clean, or a manual check)
- **Metrics** — files changed, lines added/removed, test/build results

`POST /api/missions/:id/verify` runs build/tests/lint and records whether each outcome passed, turning the mission into a measured, auditable unit of work. Missions are persisted under `.newton/missions/`.

### 🗺️ Repository Dependency Graph (`repoGraph.ts`)
A static import-graph builder that parses `import` / `require` / `from` statements for JS/TS, Python, Go, Rust, and more. `/api/graph` returns the full graph; `/api/graph/impact` computes transitive reverse-dependencies (blast radius) for a given file. This powers the `GraphPanel` UI and feeds blast-radius data into the Consequence Engine.

### 🌿 AI Source Control
The Git subsystem (`/api/git/*`) wraps `git` CLI calls and adds three AI-powered features on top:
- **suggest-commit** — generates a conventional-commit message from a diff
- **explain-diff** — natural-language summary of what changed
- **review** — structured code review with severity-tagged findings and a 0–100 health score

The `SourceControlPanel` integrates these into a single inline Git workflow.

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