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
| `⌘P` / `⌘K` | Command palette |
| `⌘S` | Save file |
| `⌘B` | Toggle sidebar |
| `⌘J` | Toggle AI panel |
| `⌘,` | Settings |
| `⌃\`` | Toggle terminal |
| `⌘⇧V` | Voice coding |
| `⌘⇧T` | Generate tests |
| `Tab` | Accept Copilot suggestion |

---

## 🚀 Quick Start

```bash
npm install
npm run dev
```

Then open **http://localhost:5173**.

The app starts in **Demo mode** — every AI feature works with built-in simulated responses. To use real models, open **Settings (⌘,)** and choose a provider:

| Provider | Needs | Notes |
|---|---|---|
| **Demo** | Nothing | Built-in simulated AI |
| **OpenAI** | API key | GPT-4o, GPT-4o-mini, o1… |
| **Anthropic** | API key | Claude 3.5 Sonnet / Haiku |
| **Ollama** | Local Ollama | Run fully offline |

---

## 🏗️ Architecture

```
client (React + Vite + Zustand + Monaco)
  ↕
server (Express)
  ├── /api/files      — file tree
  ├── /api/file       — read / write / delete
  ├── /api/chat       — streaming AI chat (SSE)
  ├── /api/edit       — inline AI edit
  ├── /api/copilot    — ghost-text completion
  ├── /api/agent/*    — plan + apply agent steps
  ├── /api/nlsh       — natural-language → shell
  ├── /api/exec       — run shell command
  └── /api/gen-tests  — AI test generation
```

**Tech stack:** React 18 · TypeScript · Vite · Zustand · Monaco Editor · Express · `react-markdown` · `react-resizable-panels` · `lucide-react`.

---

## 🔒 Security Notes

- API keys are stored in `localStorage` (browser only) and sent only to the local server, which proxies to the provider.
- The `/api/exec` endpoint runs commands in the workspace dir — intended for local single-user use.

---

Built as a "better than Cursor" demo. Enjoy. 🟣