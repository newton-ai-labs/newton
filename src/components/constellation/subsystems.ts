/**
 * Map a workspace-relative file path to a "subsystem" label + color.
 * Used to color nodes on the constellation so users see codebase shape
 * at a glance. Pure path-prefix heuristic — no parsing needed.
 */

export interface Subsystem {
  id: string
  label: string
  /** stroke + label color (must read on dark + light themes) */
  color: string
}

const SUBSYSTEMS: Array<{ match: RegExp; sub: Subsystem }> = [
  { match: /^server\//,                  sub: { id: 'server',     label: 'server',     color: '#5b6a98' } },
  { match: /^shared\//,                  sub: { id: 'shared',     label: 'shared',     color: '#a8b5d8' } },
  { match: /^src\/components\//,         sub: { id: 'components', label: 'components', color: '#7891b5' } },
  { match: /^src\/themes/,               sub: { id: 'themes',     label: 'themes',     color: '#a89bff' } },
  { match: /^src\/.*\.(css|scss)$/,      sub: { id: 'styles',     label: 'styles',     color: '#cba6f0' } },
  { match: /^tests\//,                   sub: { id: 'tests',      label: 'tests',      color: '#4ade80' } },
  { match: /^scripts\//,                 sub: { id: 'scripts',    label: 'scripts',    color: '#82b5a8' } },
  { match: /^docs?\//,                   sub: { id: 'docs',       label: 'docs',       color: '#b8a474' } },
  { match: /^src\//,                     sub: { id: 'src',        label: 'src',        color: '#00d4ff' } },
]

const FALLBACK: Subsystem = { id: 'root', label: 'root', color: '#727890' }

export function subsystemFor(filePath: string): Subsystem {
  for (const { match, sub } of SUBSYSTEMS) {
    if (match.test(filePath)) return sub
  }
  return FALLBACK
}

/** Unique subsystems present in the given paths, in stable display order. */
export function uniqueSubsystems(paths: string[]): Subsystem[] {
  const seen = new Map<string, Subsystem>()
  for (const p of paths) {
    const s = subsystemFor(p)
    if (!seen.has(s.id)) seen.set(s.id, s)
  }
  return [...seen.values()]
}
