/**
 * Clears stale processes on the dev ports (5173, 5174, 8787) before starting.
 * This prevents the EADDRINUSE crashes that happen when previous dev servers
 * didn't shut down cleanly.
 */
import { execSync } from 'node:child_process'

const PORTS = [5173, 5174, 8787]
let killed = 0

for (const port of PORTS) {
  try {
    const out = execSync(`lsof -ti:${port} 2>/dev/null`, { encoding: 'utf8' })
    const pids = out.trim().split('\n').filter(Boolean)
    for (const pid of pids) {
      try {
        process.kill(Number(pid), 'SIGKILL')
        killed++
      } catch {
        /* process may have already exited */
      }
    }
  } catch {
    /* no process on this port — good */
  }
}

if (killed > 0) {
  console.log(`\n  🧹 Cleared ${killed} stale process(es) on dev ports.\n`)
} else {
  console.log('\n  ✓ Dev ports are clear.\n')
}