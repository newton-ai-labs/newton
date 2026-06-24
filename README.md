# 🟣 Newton — Better Than Cursor

**Newton** is a polished, AI-native code editor that runs in your browser — a genuine Cursor alternative built from scratch. It bundles a full Monaco editor, multi-provider LLM assistant, autonomous agent mode, Copilot-style autocomplete, inline AI edits, voice coding, a natural-language terminal, and one-click test generation.

Works out-of-the-box in **Demo mode** (no API key needed), and supports **OpenAI**, **Anthropic**, and local **Ollama** when you add keys.

---

## ✨ Features

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

| Provider | Needs | Notes |
|---|---|---|
| **Demo** | Nothing | Built-in simulated AI — works instantly |
| **OpenAI** | API key | GPT-4o, GPT-4o-mini, o1… |
| **Anthropic** | API key | Claude 3.5 Sonnet / Haiku |
| **Ollama** | Local Ollama | Run fully offline |

API keys are configured via the **Settings** panel (gear icon or `⌘,`) and stored in your browser's `localStorage`.

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
  ├── /api/chat          — streaming AI chat (SSE)
  ├── /api/edit          — inline AI edit (⌘K)
  ├── /api/copilot       — ghost-text completion
  ├── /api/agent/*       — plan + apply agent steps
  ├── /api/nlsh          — natural-language → shell
  ├── /api/exec          — run shell command
  ├── /api/gen-tests     — AI test generation
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