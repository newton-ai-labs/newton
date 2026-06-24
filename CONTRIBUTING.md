# 🤝 Contributing to Newton

Thanks for your interest in improving Newton! This guide covers everything you need to get started.

---

## 🚀 Development Setup

### Prerequisites
- **Node.js 18+** (we recommend using [nvm](https://github.com/nvm-sh/nvm) or [fnm](https://github.com/Schniz/fnm))
- npm (comes with Node)
- A code editor (Newton works great for this 😄)

### Getting Started

```bash
# Clone
git clone https://github.com/newton-ai-labs/newton.git
cd newton

# Install dependencies
npm install

# Start dev servers (frontend + backend)
npm run dev
```

This launches:
- **Frontend:** http://localhost:5173 (Vite, hot reload)
- **Backend:** http://localhost:8787 (Express, watch mode)

### Verify Your Setup

```bash
# Type-check + build the frontend
npm run build

# Check the API is responding
curl http://localhost:8787/api/health
```

---

## 📁 Project Structure

```
newton/
├── docs/                   # 📚 You are here
│   ├── ARCHITECTURE.md
│   ├── API.md
│   └── SEMANTIC_SEARCH.md
├── server/                 # Express backend
│   ├── index.ts            # Main API routes
│   ├── agent.ts            # Agent mode logic
│   ├── demoAi.ts           # Built-in demo AI
│   └── indexing.ts         # TF-IDF codebase indexer
├── shared/                 # Shared TypeScript types
│   └── types.ts            # Types + PROVIDER_REGISTRY (table-driven provider defs)
├── src/                    # React frontend
│   ├── components/         # UI components
│   ├── store.ts            # Zustand state
│   ├── App.tsx             # Main layout
│   └── main.tsx            # Entry point
├── vite.config.ts          # Vite config (proxy, build)
├── tsconfig.json           # TypeScript config
└── package.json
```

---

## 🧪 Testing Your Changes

Newton doesn't have a formal test suite yet (contributions welcome!), but here's how to manually verify:

### Smoke Tests
1. **File ops:** Create, edit, rename, delete files in the explorer
2. **AI chat:** Send a message in Demo mode → should get a streamed response
3. **Semantic search:** Open a large file, ask "where is X?" in chat → should reference real files
4. **Agent mode:** Describe a task → should generate a plan → apply steps
5. **Inline edit (⌘K):** Select code → ⌘K → describe change → accept
6. **Command palette (⌘P):** Should fuzzy-find files

### Provider Tests
Newton supports 10 providers. Test any you have access to in Settings:
- **Cloud:** OpenAI, Anthropic, Google Gemini, Groq, Mistral, Together, DeepSeek
- **Local:** Ollama (`ollama serve`), LocalAI
- **Demo:** Always available, no key needed

> **Adding a provider** is now table-driven: just add an entry to `PROVIDER_REGISTRY` in `shared/types.ts`. If the provider uses an existing protocol (`openai`, `anthropic`, `google`, `ollama`), no server code changes are needed.

---

## 🎨 Code Style

### TypeScript
- Use **strict TypeScript** — no `any` unless absolutely necessary (document why)
- Prefer `interface` for object shapes, `type` for unions
- Use `const` by default, `let` only when reassignment is needed

### React
- **Functional components** only (no class components)
- **Hooks** for state and effects
- **Zustand** for global state (see `src/store.ts`)
- Keep components focused — if it's >300 lines, consider splitting

### Backend
- **Express** routes in `server/index.ts`
- Keep route handlers thin — extract logic into helper functions
- **Always sanitize file paths** with `safeJoin()` to prevent path traversal
- Stream AI responses via SSE/plain-text chunks

### Naming
- **Files:** `PascalCase.tsx` for components, `camelCase.ts` for utilities
- **Functions/variables:** `camelCase`
- **Types/Interfaces:** `PascalCase`
- **Constants:** `UPPER_SNAKE_CASE` for env vars, `camelCase` for app constants

---

## 🔄 Pull Request Process

1. **Fork** the repo and create your branch:
   ```bash
   git checkout -b feat/my-feature
   # or
   git checkout -b fix/my-bugfix
   ```

2. **Make your changes** following the code style above.

3. **Test locally:**
   ```bash
   npm run build   # must pass with no errors
   npm run dev     # manually verify your feature
   ```

4. **Update docs** if you added/changed an API endpoint or feature.

5. **Commit with clear messages:**
   ```bash
   git commit -m "feat: add support for Azure OpenAI endpoints"
   git commit -m "fix: prevent crash when workspace has no files"
   ```

   We use [Conventional Commits](https://www.conventionalcommits.org/):
   - `feat:` new feature
   - `fix:` bug fix
   - `docs:` documentation
   - `refactor:` code restructuring
   - `test:` tests
   - `chore:` build/tooling

6. **Push and open a PR:**
   ```bash
   git push origin feat/my-feature
   ```
   Then open a PR against `main`. Describe:
   - What you changed and why
   - How to test it
   - Any breaking changes

---

## 💡 Areas for Contribution

We'd love help with:

### High Impact
- [ ] **Embeddings support** — wire up `setEmbeddingsMode()` with OpenAI embeddings
- [ ] **Formal test suite** — Vitest + Playwright for e2e
- [ ] **Git integration** — diff view, commit UI, branch switcher
- [ ] **Multi-file agent edits** — agent can edit multiple files per step

### Polish
- [ ] **Themes** — light theme, custom themes
- [ ] **More languages** — Monaco language definitions for niche langs
- [ ] **Keyboard shortcuts editor** — let users remap shortcuts
- [ ] **Search & replace** across files

### Backend
- [ ] **Docker image** — one-command deployment
- [ ] **WebSocket terminal** — true interactive terminal (not exec-per-command)
- [ ] **Workspace projects** — support multiple root folders

---

## 🐛 Reporting Bugs

Open a [GitHub Issue](https://github.com/newton-ai-labs/newton/issues) with:
1. **Steps to reproduce**
2. **Expected vs actual behavior**
3. **Console errors** (browser dev tools + terminal output)
4. **Your setup** (OS, Node version, provider, model)

---

## 📜 License

By contributing, you agree that your contributions are licensed under the MIT License.

---

Thanks for making Newton better! 🟣