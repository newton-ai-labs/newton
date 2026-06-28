import path from 'node:path'

/**
 * Resolve a workspace-relative path and guarantee it stays within the workspace root.
 *
 * Uses `path.relative()` for the containment check (not `startsWith`), which is
 * robust against sibling-directory traversal attacks (e.g. `../project-evil`).
 *
 * @param workspace Absolute path to the workspace root
 * @param rel       User-supplied relative path (may contain `..`, `/`, etc.)
 * @returns Absolute, normalized path inside `workspace`
 * @throws if the resolved path escapes the workspace root
 */
export function safeResolve(workspace: string, rel: string): string {
  const resolved = path.resolve(workspace, rel)
  const relative = path.relative(workspace, resolved)

  // If the relative path starts with `..` or is absolute (e.g. on Windows a
  // different drive), the resolved path escapes the workspace.
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Path escapes workspace root')
  }
  return resolved
}

/**
 * Paths that must never be deleted, even if they're inside the workspace.
 * Protects `.git/`, the workspace root itself, and similar critical entries.
 */
const PROTECTED_DELETE_PATHS = new Set(['.', './', '', '.git', '.git/'])

export function assertSafeDelete(rel: string): void {
  const normalized = rel.replace(/\/+$/, '').trim()
  if (PROTECTED_DELETE_PATHS.has(normalized) || normalized === '.git') {
    throw new Error('Cannot delete protected path')
  }
  // Block any path under .git
  const parts = normalized.split('/').filter(Boolean)
  if (parts[0] === '.git') {
    throw new Error('Cannot delete protected path')
  }
}