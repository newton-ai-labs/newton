import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { atomicWrite } from '../../server/atomicWrite.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'newton-atomic-'))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('atomicWrite', () => {
  it('writes a string to the target file', async () => {
    const target = path.join(tmpDir, 'out.json')
    await atomicWrite(target, '{"ok":true}')
    expect(await fs.readFile(target, 'utf8')).toBe('{"ok":true}')
  })

  it('writes a Buffer to the target file', async () => {
    const target = path.join(tmpDir, 'bin.dat')
    const buf = Buffer.from([0x00, 0x01, 0x02, 0xff])
    await atomicWrite(target, buf)
    const written = await fs.readFile(target)
    expect(written).toEqual(buf)
  })

  it('overwrites existing content completely (no partial remnants)', async () => {
    const target = path.join(tmpDir, 'c.txt')
    await fs.writeFile(target, 'OLD-CONTENT-THAT-IS-LONG')
    await atomicWrite(target, 'new')
    expect(await fs.readFile(target, 'utf8')).toBe('new')
  })

  it('creates parent directories that do not exist', async () => {
    const target = path.join(tmpDir, 'nested', 'deep', 'out.txt')
    await atomicWrite(target, 'hello')
    expect(await fs.readFile(target, 'utf8')).toBe('hello')
  })

  it('leaves no temp files behind on success', async () => {
    const target = path.join(tmpDir, 'clean.txt')
    await atomicWrite(target, 'data')
    const entries = await fs.readdir(tmpDir)
    expect(entries).toEqual(['clean.txt'])
  })

  it('preserves a previously good file when re-writing (read-after-overwrite)', async () => {
    const target = path.join(tmpDir, 'r.txt')
    await atomicWrite(target, 'version-1')
    await atomicWrite(target, 'version-2')
    await atomicWrite(target, 'version-3')
    expect(await fs.readFile(target, 'utf8')).toBe('version-3')
  })

  it('supports concurrent atomic writes to different files', async () => {
    const targets = Array.from({ length: 10 }, (_, i) => path.join(tmpDir, `f${i}.txt`))
    await Promise.all(targets.map((t, i) => atomicWrite(t, `content-${i}`)))
    for (let i = 0; i < targets.length; i++) {
      expect(await fs.readFile(targets[i], 'utf8')).toBe(`content-${i}`)
    }
  })

  it('cleans up temp files on failure', async () => {
    // Make the target directory read-only so the final rename fails
    const readOnlyDir = path.join(tmpDir, 'readonly')
    await fs.mkdir(readOnlyDir)
    const target = path.join(readOnlyDir, 'x.txt')

    // Remove write permission on the directory (rename needs write access)
    await fs.chmod(readOnlyDir, 0o555)
    try {
      await expect(atomicWrite(target, 'nope')).rejects.toThrow()
      const entries = await fs.readdir(readOnlyDir)
      // No leftover .tmp files
      expect(entries.filter((e) => e.endsWith('.tmp'))).toHaveLength(0)
    } finally {
      // Restore so cleanup in afterEach can run
      await fs.chmod(readOnlyDir, 0o755)
    }
  })
})