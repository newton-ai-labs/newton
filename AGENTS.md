# Repository Guidelines

## Project Structure & Module Organization

- `src/`: React frontend. Components live in `src/components/`, shared client state in `src/store.ts`, and app entry points in `src/App.tsx` and `src/main.tsx`.
- `server/`: Express API and backend features, including agents, indexing, memory, missions, and repo graphs.
- `shared/`: Cross-client/server types and provider definitions, especially `shared/types.ts`.
- `docs/`: Architecture, API, and semantic search documentation.
- `public/`: Static assets such as `favicon.svg`.
- `scripts/`: Local utilities, including port cleanup before development.

## Build, Test, and Development Commands

- `npm install`: Install project dependencies.
- `npm run dev`: Start both the Vite client on `http://localhost:5173` and the Express server on `http://localhost:8787`.
- `npm run dev:client`: Start only the frontend.
- `npm run dev:server`: Start only the backend in watch mode.
- `npm run build`: Run TypeScript checks and build the frontend into `dist/`.
- `npm start`: Start the production server from `server/index.ts`.
- `npm test`: Placeholder command; points contributors to browser smoke tests.
- `npm run test:e2e`: Run Playwright browser smoke tests.

## Coding Style & Naming Conventions

Use strict TypeScript and prefer `const` unless reassignment is required. Prefer `interface` for object shapes and `type` for unions. React code should use functional components and hooks, with Zustand for shared state.

Name component files with `PascalCase.tsx`, utilities with `camelCase.ts`, functions and variables with `camelCase`, types and interfaces with `PascalCase`, and environment variables with `UPPER_SNAKE_CASE`. Follow the existing two-space indentation and semicolon-free TypeScript style.

## Testing Guidelines

Before opening a PR, run `npm run build` and use `npm run test:e2e` for browser smoke coverage. Manually check affected flows: file explorer operations, Demo-mode chat streaming, semantic search, agent plans, inline edit, command palette, and provider settings. Put Playwright specs in `tests/e2e/*.spec.ts`; use `*.test.ts` or `*.test.tsx` for future unit tests.

## Commit & Pull Request Guidelines

Git history follows Conventional Commits, including scoped forms such as `feat(search): add Code/File search panel` and `fix(search): align CSS class names`. Use `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, or `chore:` as appropriate.

Pull requests should describe what changed, why it changed, how to test it, and any breaking changes. Include screenshots or recordings for UI changes, and update `docs/` or `README.md` when behavior, APIs, or setup steps change.

## Security & Configuration Tips

Keep provider keys out of source control. Backend file operations must sanitize paths with existing safe path helpers before reading or writing workspace files.
