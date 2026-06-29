import { useEffect, useState } from 'react'

/**
 * One-shot "first run in constellation mode" flag, persisted to localStorage.
 *
 * Used to drive:
 *   - the canvas entrance animation (nodes ease in instead of just appearing)
 *   - the floating hint near the prompt ("click any node to explore…")
 *
 * Both auto-suppress after the first session. Users can replay from
 * Settings → Layout → Replay onboarding.
 */

const KEY = 'newton.constellation.onboarded'

/** Custom event so any "replay onboarding" trigger anywhere re-fires the
    animation, even if the component is already mounted. */
const REPLAY_EVENT = 'newton:replay-onboarding'

function read(): boolean {
  if (typeof localStorage === 'undefined') return false
  return localStorage.getItem(KEY) === '1'
}

export function markOnboarded(): void {
  if (typeof localStorage === 'undefined') return
  try { localStorage.setItem(KEY, '1') } catch { /* ignore */ }
}

export function replayOnboarding(): void {
  if (typeof localStorage === 'undefined') return
  try { localStorage.removeItem(KEY) } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent(REPLAY_EVENT))
}

/**
 * Returns true on the first session for this user (in constellation mode).
 * Re-fires when `replayOnboarding()` is called.
 */
export function useFirstRun(): boolean {
  const [firstRun, setFirstRun] = useState<boolean>(() => !read())

  useEffect(() => {
    const onReplay = () => setFirstRun(true)
    window.addEventListener(REPLAY_EVENT, onReplay)
    return () => window.removeEventListener(REPLAY_EVENT, onReplay)
  }, [])

  return firstRun
}
