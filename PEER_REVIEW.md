# Newton Codebase Peer Review

**Date:** 2026-06-26
**Scope:** Full audit of backend, frontend, shared types, config, tests, and documentation

---

## Executive Summary

Newton is an impressive, feature-rich AI code editor with a genuinely useful demo mode. The architecture is sound and the codebase is well-organized. However, there are **3 critical security issues**, **8 high-severity bugs**, and numerous medium/low improvements worth addressing. The most urgent are a path-traversal bypass in the workspace guard, an inaccurate `SECURITY.md`, and a race condition in the abort controller.

---

## 🔴 CRITICAL

### C1. `safeJoin()` path traversal bypass — `server/index.ts`, `server/agent.ts:19-23`

Every `safeJoin()` implementation uses `resolved.startsWith(WORKSPACE)` which is **bypassable**:

```ts
function safeJoin(rel: string): string {
  const resolved = path.resolve(WORKSPACE, rel)
  if (!resolved.startsWith(WORKSPACE)) throw new Error('...')
  return resolved
}
```

If `WORKSPACE = /Users/jessie/project`, then `path.resolve(WORKSPACE, '../project-evil/secret')` resolves to `/Users/jessie/project-evil/secret`, which **passes** the `startsWith('/Users/jessie/project')` check but escapes the intended workspace.

**Fix:** Append `path.sep` to the check: `if (resolved !== WORKSPACE && !resolved.startsWith(WORKSPACE + path.sep))` — or use the cross-platform `path.relative()` check:
```ts
const rel = path.relative(WORKSPACE, resolved)
if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Path escapes workspace')
```

### C2. `SECURITY.md` factually misrepresents API key handling — `SECURITY.md:9-11`

The docs state:
> Keys are sent directly from your browser to the AI provider... Newton's backend never stores, logs, or proxies your API keys

**The backend DOES proxy keys.** In `server/index.ts`, the `/api/chat`, `/api/edit`, `/api/gen-tests`, and all AI endpoints receive `provider.apiKey` in the request body and attach it to outbound `fetch()` calls in the `Authorization` or `x-api-key` headers. This is a security misrepresentation that could cause users to share keys they believe never touch a server.

**Fix:** Correct the documentation to accurately describe the browser → local server → provider flow, and note that keys are held in memory only (not persisted to disk).

### C3. `agent.ts:340` — recursive `fs.rm` with `force: true` and weak path guard

```ts
if (step.action === 'delete') {
  await fs.rm(abs, { recursive: true, force: true })
}
```

Combined with C1's `safeJoin` bypass, a crafted agent step path could delete arbitrary directories outside the workspace. Even within the workspace, there is no guard against deleting `.` (the workspace root itself) or critical files like `.git/`.

**Fix:** (1) Fix `safeJoin` per C1. (2) Add an explicit denylist for root and `.git`:
```ts
if (step.path === '.' || step.path === '/' || step.path.startsWith('.git')) 
  throw new Error('Cannot delete protected path')
```

---

## 🟠 HIGH

### H1. Module-level `abortCtrl` race condition — `src/store.ts:335`

```ts
let abortCtrl: AbortController | null = null
```

`sendMessage` assigns to this module-level singleton. If two messages are sent in quick succession (the `chatBusy` guard is not atomic across event loop turns), the second assignment overwrites the first. Calling `stopGeneration()` would then abort the wrong request, or leave the first request unabortable.

**Fix:** Store the controller on the state object (or in a ref), and check identity before aborting.

### H2. No CORS restriction — `server/index.ts`

No CORS middleware is configured. While the dev proxy handles local requests, in production (serving from `:8787`), any website the user visits could make requests to `localhost:8787` and read/write workspace files. This is an **SSRF-to-localhost** vector.

**Fix:** Add `cors` middleware restricted to `localhost` origins, or validate the `Origin` header.

### H3. No rate limiting on any endpoint — `server/index.ts`

The `/api/exec`, `/api/chat`, `/api/nlsh`, and file operation endpoints have zero rate limiting. A malicious page (via H2) could spam these endpoints to exhaust resources or rapidly modify/delete files.

**Fix:** Add `express-rate-limit` to sensitive endpoints.

### H4. Settings migration shallow merge — `shared/types.ts:333`

```ts
return {
  ...DEFAULT_SETTINGS,
  ...raw,  // <-- raw is Record<string, any>
  providerConfigs: { ...DEFAULT_SETTINGS.providerConfigs, ...raw.providerConfigs },
}
```

A partial `providerConfigs` entry (e.g. `{openai: {model: 'gpt-4'}}`) wholly replaces the default OpenAI entry, silently dropping `apiKey`/`baseUrl`. Additionally, `...raw` spreads unvalidated values — `raw.fontSize` could be a string or negative.

**Fix:** Deep-merge per provider config, and validate `provider`, `theme`, and `fontSize` against their unions/ranges.

### H5. `gitBusy` not reset on success path — `src/store.ts:1010-1071`

Multiple Git actions (`stageFiles`, `unstageFiles`, `gitCommit`, `gitInit`) set `gitBusy: true` but only reset it in the `catch` block. On the success path, they rely on `refreshGit()` to set `gitBusy: false`. If `refreshGit` fails or the response is malformed, `gitBusy` stays `true` forever, permanently locking the SCM UI.

**Fix:** Always reset `gitBusy` in a `finally` block.

### H6. Potential XSS in `SearchPanel.tsx:268` — `dangerouslySetInnerHTML`

```tsx
<span className="search-line-preview" 
  dangerouslySetInnerHTML={{ __html: highlight(m.preview, query, useRegex, caseSensitive) }} />
```

While `highlight()` calls `escapeHtml()` on the preview text, in **regex mode** the highlight wrapping is built from the raw user query. If a user searches with a regex containing HTML metacharacters, the resulting `__html` string may contain unescaped angle brackets in the highlight `<mark>` wrapper context.

**Fix:** Use `React.createElement` with children instead of `dangerouslySetInnerHTML`, or ensure the highlight wrapper construction also escapes.

### H7. `/api/exec` endpoint allows arbitrary command execution — `server/index.ts`

The `execCommand` endpoint passes user input directly to a shell. While this is an intentional feature (NL shell), there is:
- No authentication
- No command allowlist or sandboxing
- No output size limit
- Combined with H2 (no CORS), any website can execute shell commands

**Fix:** At minimum, add CORS protection (H2) and rate limiting (H3). Consider a confirmation flow for destructive commands.

### H8. `migrateSettings` has no schema version — `shared/types.ts:330`

There's no version field in persisted settings. Once a second format change lands, migrations become ambiguous. The current migration guesses format by checking for `providerConfigs` existence, which is fragile.

**Fix:** Add `schemaVersion: 1` to `Settings` and bump on future breaking changes.

---

## 🟡 MEDIUM

### M1. Duplicate `safeJoin` implementations — `server/index.ts` + `server/agent.ts:19`

Both files define their own `safeJoin()`. Duplicated security-critical code means fixes must be applied in multiple places (and C1 affects both).

**Fix:** Extract to `server/safePath.ts` and import everywhere.

### M2. `demoCodeReview` regex for loose equality has false positives — `server/index.ts:2401`

```ts
if (/==[^=]/.test(line) && !/===/.test(line))
```

This flags `a == b` correctly, but also flags `x <= y` and `x >= y` (the `=` after `<`/`>` matches `=[^=]`). Additionally, `!===` is not handled correctly.

**Fix:** Use a more precise regex: `/(?<![=!<>])==(?!=[=])/`

### M3. Provider validation gap — `shared/types.ts:347`

```ts
provider: raw.provider || 'demo'
```

Arbitrary strings pass through. A typo'd provider like `'opennia'` silently falls back to `openai-compat` behavior in `PROVIDER_MAP`, confusing the user.

**Fix:** Validate against the `Provider` union and default to `'demo'` on invalid values.

### M4. Missing error boundaries — `src/App.tsx`

No React error boundary wraps the component tree. An uncaught error in any panel (e.g., malformed API response) will white-screen the entire app.

**Fix:** Add an `<ErrorBoundary>` component at the root.

### M5. Git status parser assumes `|` doesn't appear in commit messages — `server/index.ts:2094`

```ts
const [hash, message, author, date] = headRaw.split('|')
```

A commit message containing `|` (e.g. `fix: handle a|b cases`) will truncate and misparse fields.

**Fix:** Use a delimiter unlikely in text (e.g. `\x1f` ASCII unit separator) or use `--format` with JSON output (`--pretty=format:{"hash":"%H",...}`).

### M6. `Memory` and `repoGraph` cache writes are not atomic — `server/memory.ts`, `server/repoGraph.ts`

Cache files (`.newton/memory.json`, `.newton/repo-graph.json`) are written with `fs.writeFile` directly. If the process is killed mid-write, the cache file is left corrupt.

**Fix:** Write to a temp file then rename atomically: `fs.writeFile(tmp, data).then(() => fs.rename(tmp, final))`.

### M7. Accessibility gaps in modals — `SettingsModal.tsx`, `FixPreviewModal.tsx`, `TemplatesModal.tsx`

Modals lack:
- `role="dialog"` and `aria-modal="true"`
- Focus trap (focus can escape to elements behind the modal)
- `Escape` key handler to close (some have it, some don't)
- Return focus to trigger element on close

**Fix:** Add a reusable `<Modal>` component with proper ARIA, focus trap, and escape handling.

### M8. No responsive/mobile layout — `src/index.css`

The three-panel layout (sidebar + editor + chat) has no breakpoints. On narrow screens, panels overlap or clip with no way to recover.

**Fix:** Add `@media (max-width: 768px)` breakpoints to stack/hide panels.

---

## 🟢 LOW

### L1. Magic numbers throughout
Examples: toast timeout `2600ms` (`store.ts`), git timeout `15000ms` (`server/index.ts:2028`), diff slice limits `8000`/`10000`/`12000`. Extract to named constants.

### L2. Inconsistent error response format
Some endpoints return `{ error: string }`, others return `{ ok: false }`, others return `{ findings: [...], summary: '...' }`. Standardize on `{ error: string }` for failures.

### L3. `package.json` — `npm test` is a placeholder
```json
"test": "echo \"no tests\" && exit 0"
```
Now that vitest is configured and tests exist, this should run `vitest run`.

### L4. Dead CSS classes
`src/index.css` contains classes like `.editor-toolbar` that were removed from the component tree in a prior refactor.

### L5. `.env.example` missing provider base URLs
Ollama (`OLLAMA_BASE_URL`) and Azure OpenAI base URLs are documented in code but missing from `.env.example`.

### L6. `tests/unit/types.test.ts` — test coverage is minimal
Only tests `migrateSettings` happy path. No tests for: provider config validation, invalid provider strings, negative fontSize, or partial providerConfigs.

### L7. Documentation drift — 4 documented endpoints don't exist
Per the docs audit, `docs/API.md` references endpoints that aren't implemented in the backend. Run a doc-to-code reconciliation.

---

## ✅ Strengths

- **Architecture is clean** — clear separation between `server/`, `shared/`, `src/`, and well-named modules
- **Demo mode is genuinely useful** — the heuristic planners, test generators, and code reviewers provide real value without an API key
- **Streaming implementation is solid** — proper AbortController usage and incremental UI updates
- **TypeScript is strict** — `tsc --noEmit` passes cleanly with strict mode
- **Git integration is thorough** — status parsing, staging, commit, diff, and AI-assisted commit messages
- **Agent consequence engine** (`server/consequence.ts`) is a thoughtful safety layer not seen in most editors

---

## Recommended Priority Order

1. **Fix C1 + C3** — path traversal guard (one-line fix, highest impact)
2. **Fix C2** — correct `SECURITY.md` (documentation accuracy)
3. **Fix H1** — abort controller race condition
4. **Fix H2 + H3** — add CORS + rate limiting
5. **Fix H4** — deep-merge settings migration
6. **Fix H5** — gitBusy finally blocks
7. **Fix H6** — remove `dangerouslySetInnerHTML`
8. Address M-tier items as time permits