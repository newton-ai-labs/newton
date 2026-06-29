/**
 * Map a workspace-relative file path to a "subsystem" label + color.
 * Used by the constellation to color nodes so users see codebase shape
 * at a glance.
 *
 * Multi-stack — works on:
 *   - JS/TS (React/Next/Vue/Vite/Node/Express/Nest)
 *   - Python (Django/Flask/FastAPI)
 *   - Go modules
 *   - Rust crates
 *   - Ruby on Rails
 *   - Java (Spring / Maven layout)
 *   - PHP (Laravel)
 *   - Mobile (React Native, Flutter, native Android/iOS)
 *
 * Rules are ordered most-specific first; the first matching pattern wins.
 * To support a new convention: add a row near the top of `SUBSYSTEMS`.
 */

export interface Subsystem {
  id: string
  label: string
  /** stroke + label color (must read on dark + light themes) */
  color: string
}

const SUBSYSTEMS: Array<{ match: RegExp; sub: Subsystem }> = [
  // -------- Tests — check FIRST so test dirs aren't classified as src --------
  {
    match: /(^|\/)(tests?|__tests__|__specs__|spec|specs|e2e|integration)\//,
    sub: { id: 'tests', label: 'tests', color: '#4ade80' },
  },
  {
    // *.test.ts, *.spec.tsx, foo_test.go, foo_test.rs, test_foo.py
    match: /(\.test|\.spec|_test|^test_)\.[a-z0-9]+$/i,
    sub: { id: 'tests', label: 'tests', color: '#4ade80' },
  },

  // -------- Migrations / schema — before models so they win --------
  {
    match: /(^|\/)(migrations?|alembic|db\/migrate|prisma\/migrations|knexfile)\//,
    sub: { id: 'migrations', label: 'migrations', color: '#d4a8a8' },
  },

  // -------- API / server / backend / routes --------
  {
    match: /(^|\/)(server|backend|cmd|api|controllers?|handlers?)\//,
    sub: { id: 'server', label: 'server', color: '#5b6a98' },
  },
  {
    match: /(^|\/)(pages\/api|app\/api|src\/server|src\/api|routes|endpoints?)\//,
    sub: { id: 'server', label: 'server', color: '#5b6a98' },
  },
  {
    // Django / Flask / FastAPI conventional filenames (views.py, urls.py,
    // routes.py, admin.py) plus single-file app entrypoints.
    match: /(^|\/)(main|app|server|index|wsgi|asgi|views?|urls?|admin|routes)\.py$/,
    sub: { id: 'server', label: 'server', color: '#5b6a98' },
  },

  // -------- UI / components / views / pages --------
  {
    match: /(^|\/)(components?|widgets?|views?|partials|templates)\//,
    sub: { id: 'ui', label: 'ui', color: '#7891b5' },
  },
  {
    // Next.js 13+ App Router files: page.tsx, layout.tsx, loading.tsx,
    // error.tsx, not-found.tsx, template.tsx — these are the actual UI
    // surfaces of the route, regardless of directory.
    match: /(^|\/)(page|layout|loading|error|not-found|template|default)\.(tsx?|jsx?|svelte|vue)$/,
    sub: { id: 'ui', label: 'ui', color: '#7891b5' },
  },
  {
    // Next/Remix/Nuxt pages dirs (non-api: api was already caught above).
    match: /(^|\/)pages\//,
    sub: { id: 'ui', label: 'ui', color: '#7891b5' },
  },

  // -------- React-flavored hooks --------
  {
    match: /(^|\/)hooks?\//,
    sub: { id: 'hooks', label: 'hooks', color: '#c8b8e8' },
  },
  {
    // useFoo.ts / useBar.tsx
    match: /(^|\/)use[A-Z][A-Za-z0-9]*\.(ts|tsx|js|jsx)$/,
    sub: { id: 'hooks', label: 'hooks', color: '#c8b8e8' },
  },

  // -------- Models / entities / schemas (ORM, DB, GraphQL) --------
  {
    // entity OR entities — Java/Spring uses singular, Rails/Mongoose plural.
    match: /(^|\/)(models?|entit(?:y|ies)|schemas?|domain)\//,
    sub: { id: 'models', label: 'models', color: '#d4a574' },
  },
  {
    match: /(^|\/)prisma\//,
    sub: { id: 'models', label: 'models', color: '#d4a574' },
  },

  // -------- Stores / state / reducers --------
  {
    match: /(^|\/)(stores?|state|reducers?|slices?|atoms|recoil)\//,
    sub: { id: 'stores', label: 'stores', color: '#b8a8e8' },
  },

  // -------- Services / jobs / business logic / workers --------
  {
    match: /(^|\/)(services?|jobs?|workers?|tasks?|use_cases?|usecase|interactors?)\//,
    sub: { id: 'services', label: 'services', color: '#a89bff' },
  },

  // -------- Themes (Newton-flavored but harmless elsewhere) --------
  {
    match: /(^|\/)themes?\//,
    sub: { id: 'themes', label: 'themes', color: '#a89bff' },
  },

  // -------- Styles --------
  {
    match: /\.(css|scss|sass|less|styl|stylus|pcss)$/,
    sub: { id: 'styles', label: 'styles', color: '#cba6f0' },
  },
  {
    match: /(^|\/)(styles?|stylesheets?)\//,
    sub: { id: 'styles', label: 'styles', color: '#cba6f0' },
  },

  // -------- Utils / lib / helpers / shared / common --------
  {
    match: /(^|\/)(utils?|lib|libs|helpers?|common|shared|core)\//,
    sub: { id: 'utils', label: 'utils', color: '#a8b5d8' },
  },
  {
    // Monorepo conventions
    match: /^(packages|pkg|workspaces)\//,
    sub: { id: 'utils', label: 'utils', color: '#a8b5d8' },
  },

  // -------- Types / interfaces / typings --------
  {
    match: /(^|\/)(types?|typings|interfaces?|@types)\//,
    sub: { id: 'types', label: 'types', color: '#a8c8d8' },
  },
  {
    match: /\.d\.ts$/,
    sub: { id: 'types', label: 'types', color: '#a8c8d8' },
  },

  // -------- i18n / locales / translations --------
  {
    match: /(^|\/)(locales?|i18n|translations?|messages)\//,
    sub: { id: 'i18n', label: 'i18n', color: '#e8b8c8' },
  },

  // -------- Public / static / assets --------
  {
    match: /(^|\/)(public|static|assets?|resources?|fixtures?|seed_data)\//,
    sub: { id: 'assets', label: 'assets', color: '#9ca3af' },
  },

  // -------- Mobile-specific dirs --------
  {
    match: /^(android|ios|native|expo)\//,
    sub: { id: 'mobile', label: 'mobile', color: '#84cc16' },
  },

  // -------- Docs --------
  {
    match: /(^|\/)docs?\//,
    sub: { id: 'docs', label: 'docs', color: '#b8a474' },
  },
  {
    match: /\.(md|mdx|rst|adoc)$/,
    sub: { id: 'docs', label: 'docs', color: '#b8a474' },
  },

  // -------- Scripts / bin / CLI --------
  {
    match: /(^|\/)(scripts?|bin|tools|cli|tasks)\//,
    sub: { id: 'scripts', label: 'scripts', color: '#82b5a8' },
  },

  // -------- Config — both directories and root-level files --------
  {
    match: /(^|\/)(config|conf|settings)\//,
    sub: { id: 'config', label: 'config', color: '#b8a474' },
  },
  {
    // Bare config filenames (no .config. infix) — package.json, tsconfig.json.
    match: /(^|\/)(package|tsconfig|jsconfig)\.[a-z]+$/i,
    sub: { id: 'config', label: 'config', color: '#b8a474' },
  },
  {
    // Any *.config.* file — vite.config.ts, postcss.config.cjs, tailwind.config.js,
    // jest.config.js, etc. The middle `.config.` is the giveaway.
    match: /(^|\/)[a-z0-9_-]+\.config\.[a-z]+$/i,
    sub: { id: 'config', label: 'config', color: '#b8a474' },
  },
  {
    // Per-language manifest / lockfile / build descriptors
    match: /(^|\/)(go\.mod|go\.sum|Cargo\.toml|Cargo\.lock|pyproject\.toml|setup\.py|setup\.cfg|requirements\.txt|Pipfile|poetry\.lock|Gemfile|Gemfile\.lock|composer\.json|composer\.lock|pom\.xml|build\.gradle|build\.gradle\.kts|Makefile|Dockerfile|docker-compose\.(yml|yaml))$/i,
    sub: { id: 'config', label: 'config', color: '#b8a474' },
  },
  {
    // Generic config-y extensions
    match: /\.(toml|yaml|yml|ini|env|env\.\w+)$/i,
    sub: { id: 'config', label: 'config', color: '#b8a474' },
  },

  // -------- Generic src catch-all (must come AFTER the specific dirs) --------
  {
    match: /^(src|source|app|lib)\//,
    sub: { id: 'src', label: 'src', color: '#00d4ff' },
  },
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
