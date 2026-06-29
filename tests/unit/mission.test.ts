/**
 * End-to-end coverage for the Mission Control planner + executor path.
 *
 * The bug this guards against: missions reporting "8/8 steps done" while no
 * files were actually touched. We mock the LLM, run the planner, then feed
 * its output through executeStep just like the real /api/missions/:id/execute
 * route does. The assertions check that files actually exist on disk.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

let tmpDir: string

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'newton-mission-'))
  process.env.NEWTON_WORKSPACE = tmpDir
})

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
  delete process.env.NEWTON_WORKSPACE
})

describe('mission planner + executor', () => {
  it('produces typed steps and writes the files on disk', async () => {
    const { llmMissionPlan } = await import('../../server/mission.js')
    const { executeStep } = await import('../../server/agent.js')

    const complete = async () =>
      JSON.stringify({
        summary: 'Add a theme toggle',
        steps: [
          {
            action: 'create',
            path: 'src/theme.ts',
            description: 'Create theme module',
            after: "export type Theme = 'light' | 'dark'\nexport const DEFAULT: Theme = 'light'\n",
          },
          {
            action: 'edit',
            path: 'src/settings.ts',
            description: 'Add theme to settings',
            after: "import { DEFAULT } from './theme'\nexport const settings = { theme: DEFAULT }\n",
          },
        ],
        outcomes: [{ label: 'Build succeeds', kind: 'build', expected: 'exit 0' }],
      })

    const plan = await llmMissionPlan('Add light mode to settings', [], complete, ['src/settings.ts'], '')

    expect(plan.steps).toHaveLength(2)
    expect(plan.steps[0].action).toBe('create')
    expect(plan.steps[0].path).toBe('src/theme.ts')
    expect(plan.steps[1].action).toBe('edit')
    expect(plan.steps[1].after).toContain('theme: DEFAULT')

    // Mimic the executor: run each typed step via executeStep.
    for (const s of plan.steps) {
      const result = await executeStep({
        id: s.id,
        action: s.action!,
        path: s.path!,
        description: s.description,
        status: 'pending',
        after: s.after,
      })
      expect(result.status).toBe('done')
    }

    const themeContent = await fs.readFile(path.join(tmpDir, 'src/theme.ts'), 'utf8')
    expect(themeContent).toContain("type Theme = 'light' | 'dark'")
    const settingsContent = await fs.readFile(path.join(tmpDir, 'src/settings.ts'), 'utf8')
    expect(settingsContent).toContain('theme: DEFAULT')
  })

  it('refuses an edit that wildly shrinks an existing non-trivial file', async () => {
    const { executeStep } = await import('../../server/agent.js')

    // Seed a "real" file that's substantially larger than the snippet the LLM
    // might emit instead of full contents.
    const target = path.join(tmpDir, 'Big.tsx')
    const original = 'x'.repeat(500) + '\n' + 'y'.repeat(500)
    await fs.writeFile(target, original, 'utf8')

    const result = await executeStep({
      id: 'edit-snippet',
      action: 'edit',
      path: 'Big.tsx',
      description: 'replace with snippet',
      status: 'pending',
      after: '<Foo /> <Bar />',
    })

    expect(result.status).toBe('error')
    expect(result.note).toMatch(/snippet|ratio/i)
    // File on disk MUST NOT have been clobbered.
    const after = await fs.readFile(target, 'utf8')
    expect(after).toBe(original)
  })

  it('allows a normal edit that keeps most of the file', async () => {
    const { executeStep } = await import('../../server/agent.js')

    const target = path.join(tmpDir, 'Normal.ts')
    const original = `export const x = 1\nexport const y = 2\nexport const z = 3\n`.repeat(20)
    await fs.writeFile(target, original, 'utf8')
    // Tweak: rename z to zz everywhere, keep the rest.
    const edited = original.replace(/z/g, 'zz')

    const result = await executeStep({
      id: 'edit-normal',
      action: 'edit',
      path: 'Normal.ts',
      description: 'rename z',
      status: 'pending',
      after: edited,
    })

    expect(result.status).toBe('done')
    expect(await fs.readFile(target, 'utf8')).toBe(edited)
  })

  it('refuses to write an empty file when after is missing', async () => {
    const { executeStep } = await import('../../server/agent.js')

    const result = await executeStep({
      id: 'x',
      action: 'create',
      path: 'should-not-exist.ts',
      description: 'broken step',
      status: 'pending',
    })

    expect(result.status).toBe('error')
    expect(result.note).toMatch(/no content provided/i)
    await expect(fs.stat(path.join(tmpDir, 'should-not-exist.ts'))).rejects.toThrow()
  })

  it('passes the repo map into the planner prompt when provided', async () => {
    const { llmMissionPlan } = await import('../../server/mission.js')

    let capturedSystem = ''
    let capturedUser = ''
    const complete = async (sys: string, user: string) => {
      capturedSystem = sys
      capturedUser = user
      return JSON.stringify({
        summary: 'ok',
        steps: [{ action: 'create', path: 'noop.md', description: 'noop', after: '# noop\n' }],
        outcomes: [],
      })
    }

    const repoMap = 'src/App.tsx\n  function: App\nsrc/components/SettingsModal.tsx\n  function: SettingsModal'
    await llmMissionPlan('add a button', [], complete, ['src/App.tsx'], '', [], repoMap)

    // System prompt doesn't include the map (it's data, not rules); the
    // user message does.
    expect(capturedUser).toContain('REPO MAP')
    expect(capturedUser).toContain('SettingsModal')
    expect(capturedSystem).toContain('Newton Mission Control')
  })

  it('drops planner-emitted read steps so they cannot pad the plan', async () => {
    const { llmMissionPlan } = await import('../../server/mission.js')

    const complete = async () =>
      JSON.stringify({
        summary: 'noisy plan',
        steps: [
          { action: 'read', path: 'src/components/SettingsModal.tsx', description: 'read settings' },
          { action: 'edit', path: 'src/theme.ts', description: 'add theme', after: "export const t = 'light'\n" },
          { action: 'read', path: 'src/store.ts', description: 'read store' },
        ],
        outcomes: [],
      })

    const plan = await llmMissionPlan('do stuff', [], complete, [], '')
    expect(plan.steps).toHaveLength(1)
    expect(plan.steps[0].action).toBe('edit')
  })

  it('applies a single-edit patch surgically', async () => {
    const { executeStep } = await import('../../server/agent.js')

    const target = path.join(tmpDir, 'patch.ts')
    const original = "export const x = 1\nexport const y = 2\nexport const z = 3\n"
    await fs.writeFile(target, original, 'utf8')

    const result = await executeStep({
      id: 'p1',
      action: 'patch',
      path: 'patch.ts',
      description: 'rename y to yy',
      status: 'pending',
      edits: [{ find: 'export const y = 2', replace: 'export const yy = 22' }],
    })

    expect(result.status).toBe('done')
    expect(await fs.readFile(target, 'utf8')).toBe(
      "export const x = 1\nexport const yy = 22\nexport const z = 3\n",
    )
  })

  it('applies multiple patch edits left-to-right', async () => {
    const { executeStep } = await import('../../server/agent.js')

    const target = path.join(tmpDir, 'multi.ts')
    await fs.writeFile(target, "const a = 1\nconst b = 2\nconst c = 3\n", 'utf8')

    const result = await executeStep({
      id: 'p2',
      action: 'patch',
      path: 'multi.ts',
      description: 'bump a and c',
      status: 'pending',
      edits: [
        { find: 'const a = 1', replace: 'const a = 100' },
        { find: 'const c = 3', replace: 'const c = 300' },
      ],
    })

    expect(result.status).toBe('done')
    expect(await fs.readFile(target, 'utf8')).toBe("const a = 100\nconst b = 2\nconst c = 300\n")
  })

  it('rejects a patch when find string does not exist', async () => {
    const { executeStep } = await import('../../server/agent.js')

    const target = path.join(tmpDir, 'nofind.ts')
    const original = 'export const x = 1\n'
    await fs.writeFile(target, original, 'utf8')

    const result = await executeStep({
      id: 'p3',
      action: 'patch',
      path: 'nofind.ts',
      description: 'find missing string',
      status: 'pending',
      edits: [{ find: 'something not in the file', replace: 'replacement' }],
    })

    expect(result.status).toBe('error')
    expect(result.note).toMatch(/find-string not found/)
    expect(await fs.readFile(target, 'utf8')).toBe(original)
  })

  it('rejects a patch when find string is ambiguous (multiple matches)', async () => {
    const { executeStep } = await import('../../server/agent.js')

    const target = path.join(tmpDir, 'ambig.ts')
    const original = "const x = 1\nconst x = 2\n"  // same line twice — pathological but possible
    await fs.writeFile(target, original, 'utf8')

    const result = await executeStep({
      id: 'p4',
      action: 'patch',
      path: 'ambig.ts',
      description: 'ambiguous find',
      status: 'pending',
      edits: [{ find: 'const x =', replace: 'const xx =' }],
    })

    expect(result.status).toBe('error')
    expect(result.note).toMatch(/ambiguous/)
    expect(await fs.readFile(target, 'utf8')).toBe(original)
  })

  it('does not interpret $& in replace string as a backreference', async () => {
    const { executeStep } = await import('../../server/agent.js')

    const target = path.join(tmpDir, 'dollar.ts')
    await fs.writeFile(target, 'const a = 1\n', 'utf8')

    const result = await executeStep({
      id: 'p5',
      action: 'patch',
      path: 'dollar.ts',
      description: 'literal dollar sign',
      status: 'pending',
      edits: [{ find: 'const a = 1', replace: "const a = '$&'" }],
    })

    expect(result.status).toBe('done')
    expect(await fs.readFile(target, 'utf8')).toBe("const a = '$&'\n")
  })

  it('parses LLM output even when wrapped in markdown fences', async () => {
    const { llmMissionPlan } = await import('../../server/mission.js')

    const complete = async () =>
      '```json\n' +
      JSON.stringify({
        summary: 'fenced',
        steps: [{ action: 'create', path: 'fenced.md', description: 'create fenced', after: '# fenced\n' }],
        outcomes: [],
      }) +
      '\n```'

    const plan = await llmMissionPlan('whatever', [], complete, [], '')
    expect(plan.steps).toHaveLength(1)
    expect(plan.steps[0].path).toBe('fenced.md')
  })
})
