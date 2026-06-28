import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  getOrCreateMemory,
  loadMemory,
  refreshMemory,
  addEntry,
  removeEntry,
  buildWelcomeDigest,
  buildMemoryContext,
  type WorkspaceMemory,
} from '../../server/memory'

let workspace: string

beforeEach(async () => {
  workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'newton-mem-'))
})

afterEach(async () => {
  await fs.rm(workspace, { recursive: true, force: true })
})

function assertMemoryShape(mem: WorkspaceMemory) {
  expect(mem).toBeDefined()
  expect(typeof mem.version).toBe('number')
  expect(typeof mem.workspaceName).toBe('string')
  expect(Array.isArray(mem.techStack)).toBe(true)
  expect(Array.isArray(mem.entries)).toBe(true)
  expect(Array.isArray(mem.openTasks)).toBe(true)
  expect(Array.isArray(mem.recentFiles)).toBe(true)
}

describe('getOrCreateMemory', () => {
  it('creates initial memory on first call', async () => {
    const mem = await getOrCreateMemory(workspace)
    assertMemoryShape(mem)
    expect(mem.entries).toEqual([])
    expect(mem.visitCount).toBe(1)
    expect(mem.digest).not.toBeNull()
    expect(mem.digest?.totalFiles).toBeGreaterThanOrEqual(0)
    // persisted to disk
    expect(existsSync(path.join(workspace, '.newton', 'memory.json'))).toBe(true)
  })

  it('returns the existing memory on subsequent calls (idempotent)', async () => {
    const first = await getOrCreateMemory(workspace)
    const second = await getOrCreateMemory(workspace)
    expect(second.createdAt).toBe(first.createdAt)
    expect(second.visitCount).toBe(first.visitCount)
  })

  it('honors a workspace name derived from the directory basename', async () => {
    const mem = await getOrCreateMemory(workspace)
    expect(mem.workspaceName).toBe(path.basename(workspace))
  })
})

describe('loadMemory', () => {
  it('returns null when no memory file exists', async () => {
    const mem = await loadMemory(workspace)
    expect(mem).toBeNull()
  })

  it('returns the persisted memory after creation', async () => {
    await getOrCreateMemory(workspace)
    const mem = await loadMemory(workspace)
    expect(mem).not.toBeNull()
    assertMemoryShape(mem as WorkspaceMemory)
  })
})

describe('addEntry + removeEntry round-trip', () => {
  it('adds an entry and returns updated memory', async () => {
    const mem = await addEntry(workspace, 'decision', 'Use Zustand for state')
    expect(mem.entries.length).toBe(1)
    const entry = mem.entries[0]
    expect(entry.id).toBeTruthy()
    expect(entry.type).toBe('decision')
    expect(entry.text).toBe('Use Zustand for state')
    expect(entry.createdAt).toBeTruthy()
  })

  it('persists entries across calls', async () => {
    await addEntry(workspace, 'note', 'Remember to run tests')
    const mem = await addEntry(workspace, 'task', 'Fix the bug')
    expect(mem.entries.length).toBe(2)
    // newest first
    expect(mem.entries[0].type).toBe('task')
    expect(mem.entries[1].type).toBe('note')
  })

  it('removes an entry by id and returns updated memory', async () => {
    const afterAdd = await addEntry(workspace, 'pattern', 'Prefer interfaces over types')
    expect(afterAdd.entries.length).toBe(1)
    const id = afterAdd.entries[0].id
    const afterRemove = await removeEntry(workspace, id)
    expect(afterRemove.entries.length).toBe(0)
  })

  it('removing a non-existent id is a no-op (does not throw)', async () => {
    await addEntry(workspace, 'decision', 'A')
    const mem = await removeEntry(workspace, 'does-not-exist')
    expect(mem.entries.length).toBe(1)
  })

  it('source is optional and stored when provided', async () => {
    const withSource = await addEntry(workspace, 'pattern', 'p1', 'src/foo.ts')
    expect(withSource.entries[0].source).toBe('src/foo.ts')
    const withoutSource = await addEntry(workspace, 'note', 'n1')
    expect(withoutSource.entries[0].source).toBeUndefined()
  })
})

describe('refreshMemory', () => {
  it('preserves user entries while refreshing auto-detected fields', async () => {
    await addEntry(workspace, 'decision', 'Use Vite')
    await addEntry(workspace, 'note', 'Important note')
    const before = await loadMemory(workspace)
    expect(before).not.toBeNull()

    const refreshed = await refreshMemory(workspace)
    // entries preserved
    expect(refreshed.entries.length).toBe(2)
    // visit count increments
    expect(refreshed.visitCount).toBe((before as WorkspaceMemory).visitCount + 1)
    // digest regenerated (new generatedAt timestamp)
    expect(refreshed.digest).not.toBeNull()
    expect(refreshed.digest?.generatedAt).not.toBe((before as WorkspaceMemory).digest?.generatedAt)
  })

  it('creates memory if none exists yet', async () => {
    const mem = await refreshMemory(workspace)
    assertMemoryShape(mem)
    expect(mem.visitCount).toBe(1)
    expect(mem.entries).toEqual([])
  })
})

describe('buildWelcomeDigest', () => {
  it('produces a non-empty greeting string', async () => {
    const mem = await getOrCreateMemory(workspace)
    const text = buildWelcomeDigest(mem)
    expect(typeof text).toBe('string')
    expect(text.length).toBeGreaterThan(0)
    expect(text).toContain(mem.workspaceName)
  })

  it('includes a decisions count when entries exist', async () => {
    const mem = await addEntry(workspace, 'decision', 'A big choice')
    const text = buildWelcomeDigest(mem)
    expect(text).toContain('Decisions')
  })

  it('handles an empty memory object gracefully', () => {
    const emptyMem: WorkspaceMemory = {
      version: 1,
      workspaceName: 'empty',
      createdAt: new Date().toISOString(),
      lastVisited: new Date().toISOString(),
      visitCount: 1,
      techStack: [],
      entries: [],
      openTasks: [],
      recentFiles: [],
      digest: null,
    }
    const text = buildWelcomeDigest(emptyMem)
    expect(text).toContain('empty')
    // should not throw even with no stack/tasks/recent files
    expect(text).toContain('Welcome back')
  })
})

  describe('buildMemoryContext', () => {
    it('builds a compact context string for chat injection', async () => {
      const mem = await addEntry(workspace, 'decision', 'Use Zustand for state')
      const ctx = buildMemoryContext(mem)
      expect(typeof ctx).toBe('string')
      expect(ctx).toContain(mem.workspaceName)
      // decision surfaced
      expect(ctx).toContain('Use Zustand for state')
    })
  })

  describe('scanOpenTasks — string-literal safety (regression)', () => {
    it('ignores TODO/FIXME markers embedded inside string literals', async () => {
      // Reproduces the generated-test scaffold that previously leaked into the
      // welcome digest as a bogus "Next:" task. The `# TODO:` here lives inside
      // a single-quoted string literal and must NOT be reported as a task.
      // (\\n writes a literal backslash-n to disk, matching real source text.)
      const leaking = [
        "const args = '\\n        # TODO: provide realistic arguments\\n        '",
        "  + f.params.map((p) => `${p}=${guessDefaultPython(p)}`).join(', ')",
        '',
      ].join('\n')
      await fs.writeFile(path.join(workspace, 'scaffold.ts'), leaking, 'utf8')

      // A real TODO comment in a separate file — this MUST still be detected.
      await fs.writeFile(
        path.join(workspace, 'real.ts'),
        '// TODO: wire up the settings modal\n',
        'utf8',
      )

      const mem = await getOrCreateMemory(workspace)

      // The string-literal TODO must not leak through.
      const scaffoldTasks = mem.openTasks.filter((t) => t.file === 'scaffold.ts')
      expect(scaffoldTasks).toEqual([])
      expect(mem.openTasks.some((t) => t.text.includes('provide realistic arguments'))).toBe(false)

      // The real TODO must be detected.
      const realTask = mem.openTasks.find((t) => t.file === 'real.ts')
      expect(realTask).toBeDefined()
      expect(realTask?.tag).toBe('TODO')
      expect(realTask?.text).toBe('wire up the settings modal')
    })

    it('honors the 50-task cap across nested directories (regression)', async () => {
      // The cap must be checked at EVERY recursion level. Previously the
      // `tasks.length >= 50` check only returned the innermost walk frame, so
      // once a child directory hit the cap the parent kept scanning siblings
      // and pushed tasks past 50. We reproduce this by overflowing a child dir,
      // then adding more tasks in a sibling dir + the root — the result must
      // be capped at exactly 50, never more.
      const todoFile = (n: number) => `// TODO: task number ${n}\n`

      // child1: 50 tasks → fills the cap inside a child walk frame
      await fs.mkdir(path.join(workspace, 'child1'), { recursive: true })
      for (let i = 0; i < 50; i++) {
        await fs.writeFile(path.join(workspace, 'child1', `t${i}.ts`), todoFile(i), 'utf8')
      }
      // child2: 10 tasks in a SIBLING dir — the parent would reach these after
      // child1 returns, so under the bug this pushes past 50.
      await fs.mkdir(path.join(workspace, 'child2'), { recursive: true })
      for (let i = 0; i < 10; i++) {
        await fs.writeFile(path.join(workspace, 'child2', `t${i}.ts`), todoFile(100 + i), 'utf8')
      }
      // root: 1 more task, scanned directly by the top-level walk loop.
      await fs.writeFile(path.join(workspace, 'root.ts'), todoFile(999), 'utf8')

      const mem = await getOrCreateMemory(workspace)

      // The cap must hold regardless of directory nesting.
      expect(mem.openTasks.length).toBeLessThanOrEqual(50)
      expect(mem.openTasks.length).toBe(50)
    })
  })
