# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Newton is an AI-native browser-based code editor built with React + Express. It features Monaco editor, multi-provider LLM support (10+ providers), agent mode, Copilot-style autocomplete, inline AI edits, and semantic codebase search.

## Commands

```bash
# Development (starts both client:5173 and server:8787)
npm run dev

# Run E2E tests (auto-starts dev server on ports 5273/5274)
npm run test:e2e

# Type-check and build for production
npm run build

# Start production server (serves built app + API on 8787)
npm start
```

## Architecture

```
src/                    # React frontend (Vite)
├── components/         # UI components (ChatPanel, AgentPanel, EditorArea, etc.)
├── store.ts           # Zustand global state (single store for all app state)
├── ghostCompletions.ts # Copilot completion logic
└── App.tsx            # Top-level layout

server/                 # Express backend (tsx runtime)
├── index.ts           # API routes + file system + AI dispatch
├── agent.ts           # Agent mode: plan generation, step execution
├── indexing.ts        # TF-IDF semantic codebase indexer
├── repoGraph.ts       # Dependency graph builder + impact analysis
├── memory.ts          # Workspace memory (tech stack, TODOs)
├── consequence.ts     # Risk assessment for agent steps
└── demoAi.ts          # Built-in simulated AI responses

shared/types.ts        # Shared types + PROVIDER_REGISTRY (all 10 providers)
```

### Key Patterns

- **Table-driven providers**: `PROVIDER_REGISTRY` in `shared/types.ts` defines all AI providers. Add new providers by adding entries (no server code changes if using existing protocols).
- **SSE streaming**: All AI endpoints stream responses via Server-Sent Events.
- **Zustand store**: Single store in `src/store.ts` for all global state.
- **File sandboxing**: All file operations use `safeJoin()` in `server/index.ts` to prevent path traversal.
- **Incremental indexing**: TF-IDF index caches to `.newton-index.json`, only reindexes changed files.

### Data Flow

1. Frontend sends request to `/api/*` (proxied via Vite in dev)
2. Server enriches with semantic search context + workspace memory
3. Routes to appropriate AI provider via registry-driven dispatch
4. Streams response back via SSE

## Key Files

| File | Purpose |
|------|---------|
| `src/store.ts` | Zustand store with all actions (sendMessage, runInlineEdit, etc.) |
| `server/index.ts` | All API routes, `safeJoin()` utility |
| `shared/types.ts` | `PROVIDER_REGISTRY`, shared type definitions |
| `server/indexing.ts` | TF-IDF search engine |
| `server/agent.ts` | Agent mode planning and execution |

## Code Conventions

- TypeScript strict mode enabled
- Functional React components only (no classes)
- Two-space indentation, semicolon-free style
- File naming: `PascalCase.tsx` (components), `camelCase.ts` (utilities)
- Keep components under 300 lines; split if larger
- Always sanitize file paths with `safeJoin()` in server code

## Testing

```bash
# Run all tests (unit + e2e)
npm test

# Run unit tests only (Vitest)
npm run test:unit

# Run unit tests in watch mode
npm run test:watch

# Run E2E tests (Playwright, auto-starts dev server)
npm run test:e2e
```

Unit tests are in `tests/unit/` using Vitest. E2E tests are in `tests/e2e/` using Playwright.

## Environment Variables

See `.env.example` for all options. Key variables:
- `NEWTON_PORT` (default 8787) - backend port
- `NEWTON_CLIENT_PORT` (default 5173) - Vite dev server port
- `NEWTON_WORKSPACE` - restrict file access to workspace root
