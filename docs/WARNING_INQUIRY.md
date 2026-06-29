# Warning Inquiry

The mission goal submitted was simply a question:

> What is the warning?

This is not an actionable file-change request, so no source files were modified.
Below is a catalog of the warning-related code paths in the repository to help
identify which "warning" the question refers to. Please re-submit a concrete
goal (e.g. "fix the chunk-size warning" or "explain the no-trailing-spaces
warning") once the intended warning is known.

## Candidate warnings found in the codebase

### 1. Vite build chunk-size warning
File: `vite.config.ts`

```ts
build: {
  // Monaco editor is inherently large (~800KB); suppress warning for local desktop app
  chunkSizeWarningLimit: 1000,
  ...
}
```

Vite emits a "chunk size limit" warning during `npm run build` when a bundle
exceeds the configured limit. Here it is raised to 1000 KB because Monaco is
large by design.

### 2. Diagnostics "warning" severity
Files: `src/components/ProblemsPanel.tsx`, `server/index.ts`

Diagnostics carry a `severity: 'error' | 'warning'` field. The Problems panel
renders warnings with a yellow triangle (`WarningIcon`) and a `warningCount`
badge. Example heuristic warnings include `no-trailing-spaces` and `TODO`
markers (see `tests/e2e/diagnostics-fix-contract.spec.ts`).

```ts
interface Diagnostic {
  filePath: string
  line: number
  column: number
  severity: 'error' | 'warning'
  message: string
  code?: string
  source: string
}
```

### 3. Code-review finding warnings
File: `shared/types.ts` (`CodeReviewFinding`)

```ts
export interface CodeReviewFinding {
  severity: 'critical' | 'warning' | 'info' | 'praise'
  ...
}
```

AI code review can surface findings with `severity: 'warning'`.

### 4. Settings "experimental" / unsaved warnings (UI banners)
Files: `src/components/SettingsModal.tsx`, `src/components/constellation/EditorNodeView.tsx`

- The Layout section shows an `experimental` badge styled with `--yellow`.
- The editor shows a yellow `● unsaved` indicator when content is dirty.

## Next step

Reply with the specific warning to act on, for example:
- "Suppress the Vite chunk-size warning differently"
- "Explain the `no-trailing-spaces` diagnostic warning"
- "Style the `● unsaved` warning indicator"
