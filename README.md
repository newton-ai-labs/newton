# 🟣 Newton — Better Than Cursor

**Newton** is a polished, AI-native code editor that runs in your browser — a genuine Cursor alternative built from scratch. It bundles a full Monaco editor, multi-provider LLM assistant, autonomous agent mode, Copilot-style autocomplete, inline AI edits, voice coding, a natural-language terminal, one-click test generation, AI-powered source control, a repository dependency graph, workspace memory, a consequence engine for safe agents, and mission-based long-running workflows.

Works out-of-the-box in **Demo mode** (no API key needed), and supports **10 LLM providers** including OpenAI, Anthropic, Google Gemini, Groq, Mistral, Together, DeepSeek, and local options like Ollama and LocalAI.

---

## 📚 Documentation

| Doc | Description |
|---|---|
| **[Architecture](docs/ARCHITECTURE.md)** | How the frontend, backend, and AI providers fit together |
| **[API Reference](docs/API.md)** | Every endpoint, request body, and response schema |
| **[Semantic Search](docs/SEMANTIC_SEARCH.md)** | Deep dive into the TF-IDF codebase indexer |
| **[Contributing](CONTRIBUTING.md)** | Setup, code style, and areas for contribution |

---

## ✨ Features

### 🔍 Semantic Codebase Search & @-Mentions — *Innovation*
- **Built-in TF-IDF indexer** with symbol-aware chunking (functions, classes, methods)
- Runs in the background — re-indexes on every file save
- **Auto-context:** every chat message is enriched with relevant code context
- **@-mentions:** type `@` in the chat box to search & attach files as explicit context
- Results show file paths, symbols, line numbers, and relevance scores

### Core Editor
- **Monaco-powered editor** with syntax highlighting for 25+ languages
- **File explorer** with create / delete / nested folders
- **Multi-tab editing** with unsaved indicators & `⌘S` to save
- **Resizable panels** (sidebar, editor, AI panel)
- **Command palette** (`⌘P`) for fuzzy file find + commands
- **Integrated terminal** (`⌃\``)
- **Fast fuzzy search** across file names

### AI Assistant (`⌘J`)
- **Streaming chat** with full markdown + syntax-highlighted code
- **Active-file context** automatically attached
- **Apply-to-file** action on code blocks — insert AI code straight into the open file
- **Stop generation** mid-stream
- Multi-turn conversation memory

### 🤖 Agent Mode
- Describe a task → Newton generates a **step-by-step plan**
- Each step targets a specific file with a diff
- **Run all** or **run step-by-step** with accept/reject
- Live status: pending / running / done / error
- **Consequence Engine** assesses each step's risk (destructive ops, blast radius, reversibility) and gates high-risk changes behind explicit approval

### 💡 Copilot Autocomplete
- Ghost-text completions as you type (like Cursor Tab / Copilot)
- Debounced, non-blocking, `Tab` to accept

### ✏️ Inline AI Edit (`⌘K`)
- Highlight code, press `⌘K`, describe a change
- Review the diff and accept/reject

### 🎤 Voice Coding (`⌘⇧V`) — *Innovation*
- Speak instructions using the Web Speech API
- Three modes: **Chat**, **Edit**, **Command**
- Live transcript with interim results

### 💬 Natural-Language Terminal — *Innovation*
- Toggle "NL" mode in the terminal
- Type plain English → Newton translates to a shell command → you review & run
- Full stdout/stderr/exit-code capture

### 🧪 One-Click Test Generation (`⌘⇧T`) — *Innovation*
- Open any file, hit **Gen Tests**
- Newton analyzes the code and writes a test file (`.test.ts` etc.)
- Test file opens automatically

### 🌿 AI-Powered Source Control — *Innovation*
- **Inline Git panel:** status, stage/unstage, commit, and log without leaving the editor
- **AI commit messages:** one click generates a conventional-commit message from your staged diff
- **Explain this diff:** natural-language summary of what changed and why
- **AI code review:** scans your diff for bugs, security issues, performance, and style — with a 0–100 health score

### 🗺️ Repository Dependency Graph — *Innovation*
- Click any file in the explorer to see what it imports and what imports it
- **Impact analysis:** "If I change `src/store.ts`, what else breaks?" — multi-hop reachability across the import graph
- Built by static-parsing `import`/`require`/`from` statements for JS/TS, Python, Go, Rust, and more

### 🧠 Workspace Memory — *Innovation*
- Newton **remembers your project**: detected tech stack, file/language breakdown, and all `TODO`/`FIXME`/`HACK` markers
- AI-suggested and manual **memory entries** (decisions, patterns, notes) persist across sessions
- Chat is automatically enriched with workspace memory, so the AI knows your stack and conventions
- "Welcome back" banner surfaces recent files and pending TODOs

### 🛡️ RecourseOS Consequence Engine — *Innovation*
- Every proposed agent action is **risk-assessed** before execution
- Flags destructive ops, secrets/credentials, blast radius, and mass deletions
- Classifies reversibility (`trivial` → `git` → `difficult` → `irreversible`)
- High-risk and irreversible plans require **explicit approval**

### 🎯 Mission Control — *Innovation*
- Launch **long-running, goal-oriented missions** ("migrate this app to TypeScript", "add auth", "fix all failing tests")
- Each mission has defined **outcomes** (tests pass, build succeeds, lint clean) that Newton **verifies** automatically
- Tracks files changed, lines added/removed, and test/build results as metrics
- Pause, resume, and review completed missions

---

## ⌨️ Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `⌘P` | Command palette (fuzzy file find + commands) |
| `⌘S` | Save file |
| `⌘B` | Toggle sidebar |
| `⌘J` | Toggle AI panel |
| `⌘K` | Inline AI edit (highlight code first) |
| `⌘,` | Settings |
| `⌃\`` | Toggle terminal |
| `⌘⇧V` | Voice coding |
| `⌘⇧T` | Generate tests |
| `Tab` | Accept Copilot suggestion |

---

## 🚀 Quick Start

### Prerequisites
- **Node.js 18+** and npm
- A terminal / command prompt

### Development

```bash
# 1. Clone the repo
git clone https://github.com/newton-ai-labs/newton.git
cd newton

# 2. Install dependencies
npm install

# 3. Start both the frontend and backend
npm run dev
```

This launches **two processes** via `concurrently`:
- **Frontend (client):** Vite dev server on **http://localhost:5173**
- **Backend (server):** Express API on **http://localhost:8787**

Vite proxies all `/api/*` requests to the backend automatically, so you only need to open the frontend URL: **http://localhost:5173**.

> 💡 The app starts in **Demo mode** — every AI feature works with built-in simulated responses. To use real models, open **Settings (⌘,)** and choose a provider.

### Production

```bash
# Build the frontend (outputs to dist/)
npm run build

# Start the production server (serves built frontend + API on one port)
npm start
```

Then open **http://localhost:8787** — the Express server serves both the API and the built React app.

---

## 🔧 Configuration

### AI Providers

Newton uses a **table-driven provider registry** — adding a new provider is just one entry in `PROVIDER_REGISTRY` (`shared/types.ts`). All providers support streaming and work across chat, agent mode, inline edits, and Copilot.

| Provider | ID | Needs | Default Models | Notes |
|---|---|---|---|---|
| **Demo** | `demo` | Nothing | — | Built-in simulated AI — works instantly, no key needed |
| **OpenAI** | `openai` | API key | `gpt-4o-mini`, `gpt-4o`, `o1` | Supports custom base URL (Azure, proxies) |
| **Anthropic** | `anthropic` | API key | `claude-3-5-sonnet-20241022`, `claude-3-5-haiku-20241022` | Claude Messages API |
| **Google Gemini** | `gemini` | API key | `gemini-1.5-pro`, `gemini-1.5-flash`, `gemini-2.0-flash` | Google AI Studio |
| **Groq** | `groq` | API key | `llama-3.3-70b-versatile`, `mixtral-8x7b-32768` | Ultra-fast inference |
| **Mistral** | `mistral` | API key | `mistral-large-latest`, `codestral-latest` | Mistral AI platform |
| **Together** | `together` | API key | `meta-llama/Llama-3.3-70B-Instruct-Turbo` | Open-source model hosting |
| **DeepSeek** | `deepseek` | API key | `deepseek-chat`, `deepseek-coder` | Cost-effective coding models |
| **Ollama** | `ollama` | Local Ollama | `llama3.1`, `qwen2.5-coder`, `deepseek-r1` | Run fully offline — `ollama serve` |
| **LocalAI** | `localai` | LocalAI server | `gpt-4`, custom | Self-hosted OpenAI-compatible endpoint |

> **Tip:** You can type any custom model name in the model field — the suggestions are just starting points.

API keys are configured via the **Settings** panel (gear icon or `⌘,`) and stored in your browser's `localStorage`. Keys are sent only to the local Newton server, which proxies to the provider.

### Environment Variables (optional)

The backend reads optional environment variables from a `.env` file (see `.env.example`):

| Variable | Default | Description |
|---|---|---|
| `NEWTON_PORT` | `8787` | Backend server port |
| `NEWTON_WORKSPACE` | Current directory | Root directory for the file explorer |

> Note: Server-side API keys (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`) are used only by the `/api/health` endpoint for status reporting. Actual AI requests use keys from the client Settings panel.

---

## 🏗️ Architecture

```
client (React + Vite + Zustand + Monaco)
  ↕  (Vite proxy: /api → localhost:8787)
server (Express + tsx)
  ├── /api/files         — file tree
  ├── /api/file          — read / write / delete / rename / create
  ├── /api/chat          — streaming AI chat (SSE, auto-context + memory)
  ├── /api/search        — semantic codebase search (TF-IDF)
  ├── /api/index/*       — indexer stats / rebuild
  ├── /api/edit          — inline AI edit (⌘K)
  ├── /api/copilot       — ghost-text completion
  ├── /api/agent/*       — plan + assess + apply agent steps
  ├── /api/agent/assess  — Consequence Engine risk assessment
  ├── /api/nlsh          — natural-language → shell
  ├── /api/exec          — run shell command
  ├── /api/gen-tests     — AI test generation
  ├── /api/git/*         — AI source control (status/diff/stage/commit/review)
  ├── /api/graph         — dependency graph + impact analysis
  ├── /api/memory        — workspace memory (tech stack, TODOs, entries)
  ├── /api/missions      — mission control (create/plan/verify)
  └── /api/health        — health check
```

**Tech stack:** React 18 · TypeScript · Vite · Zustand · Monaco Editor · `@monaco-editor/react` · Express · `react-markdown` · `react-syntax-highlighter` · `react-resizable-panels` · `lucide-react`.

---

## 🔒 Security Notes

- API keys are stored in `localStorage` (browser only) and sent only to the local server, which proxies to the provider.
- The `/api/exec` endpoint runs commands in the workspace dir — intended for local single-user use.
- All file operations are sandboxed to the workspace root (path traversal is blocked).

---

## 📜 Available Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start both client + server in dev mode (with hot reload) |
| `npm run dev:client` | Start only the Vite frontend |
| `npm run dev:server` | Start only the Express backend (with watch mode) |
| `npm run build` | Type-check and build the frontend for production |
| `npm start` | Start the production server (serves built app + API) |
| `npm run preview` | Preview the built frontend via Vite |

---

## 📄 License

MIT — built as a "better than Cursor" demo. Enjoy. 🟣