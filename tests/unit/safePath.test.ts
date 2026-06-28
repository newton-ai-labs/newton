import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { safeResolve, assertSafeDelete } from '../../server/safePath.js'

const ROOT = path.resolve('/fake/workspace')

describe('safeResolve', () => {
  it('resolves a simple relative path inside the workspace', () => {
    expect(safeResolve(ROOT, 'src/app.tsx')).toBe(path.join(ROOT, 'src/app.tsx'))
  })

  it('resolves nested paths', () => {
    expect(safeResolve(ROOT, 'a/b/c/d.txt')).toBe(path.join(ROOT, 'a/b/c/d.txt'))
  })

  it('normalizes redundant segments', () => {
    expect(safeResolve(ROOT, 'src/./foo/../bar.ts')).toBe(path.join(ROOT, 'src/bar.ts'))
  })

  it('allows paths that contain ".." but stay within root', () => {
    // src/../other/file.ts → other/file.ts (still inside root)
    expect(safeResolve(ROOT, 'src/../other/file.ts')).toBe(path.join(ROOT, 'other/file.ts'))
  })

  it('rejects parent-directory traversal (../)', () => {
    expect(() => safeResolve(ROOT, '../secret.txt')).toThrow('escapes workspace root')
  })

  it('rejects deeply nested traversal that escapes root', () => {
    expect(() => safeResolve(ROOT, 'src/../../../etc/passwd')).toThrow('escapes workspace root')
  })

  it('rejects traversal disguised with trailing slash', () => {
    expect(() => safeResolve(ROOT, '../')).toThrow('escapes workspace root')
  })

  it('handles empty relative path as the root itself', () => {
    expect(safeResolve(ROOT, '')).toBe(ROOT)
  })

  it('handles dot as the root itself', () => {
    expect(safeResolve(ROOT, '.')).toBe(ROOT)
  })
})

describe('assertSafeDelete', () => {
  it('allows deleting a normal file path', () => {
    expect(() => assertSafeDelete('src/old.ts')).not.toThrow()
  })

  it('allows deleting a nested directory', () => {
    expect(() => assertSafeDelete('tmp/cache/junk')).not.toThrow()
  })

  it('throws when deleting the workspace root (".")', () => {
    expect(() => assertSafeDelete('.')).toThrow('protected path')
  })

  it('throws when deleting "./"', () => {
    expect(() => assertSafeDelete('./')).toThrow('protected path')
  })

  it('throws when deleting the empty string', () => {
    expect(() => assertSafeDelete('')).toThrow('protected path')
  })

  it('throws when deleting ".git"', () => {
    expect(() => assertSafeDelete('.git')).toThrow('protected path')
  })

  it('throws when deleting ".git/" with trailing slash', () => {
    expect(() => assertSafeDelete('.git/')).toThrow('protected path')
  })

  it('throws when deleting a path inside .git', () => {
    expect(() => assertSafeDelete('.git/config')).toThrow('protected path')
    expect(() => assertSafeDelete('.git/refs/heads/main')).toThrow('protected path')
  })

  it('allows deleting ".github" (not the same as .git)', () => {
    expect(() => assertSafeDelete('.github/workflows/ci.yml')).not.toThrow()
  })
})