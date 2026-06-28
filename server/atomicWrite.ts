import fs from 'node:fs/promises'
import path from 'node:path'
import { randomBytes } from 'node:crypto'

/**
 * Write a file atomically: write to a temp file in the same directory, fsync it,
 * then rename over the target. This prevents readers from seeing a partially
 * written file if the process is interrupted mid-write.
 *
 * `data` may be a string or Buffer. The temp file uses a random suffix and is
 * cleaned up on failure.
 */
export async function atomicWrite(filePath: string, data: string | Buffer): Promise<void> {
  const dir = path.dirname(filePath)
  await fs.mkdir(dir, { recursive: true })
  const tmp = `${filePath}.${randomBytes(6).toString('hex')}.tmp`
  const fh = await fs.open(tmp, 'w')
  try {
    await fh.writeFile(data)
    await fh.sync() // flush to disk so the rename is durable
    await fh.close()
    await fs.rename(tmp, filePath)
  } catch (err) {
    // Best-effort cleanup of the temp file on failure
    try {
      await fh.close()
    } catch {
      /* ignore */
    }
    try {
      await fs.unlink(tmp)
    } catch {
      /* ignore */
    }
    throw err
  }
}