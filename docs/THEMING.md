# 🎨 Newton — Theming (Light & Dark Mode)

Newton ships with a self-contained light/dark theme toggle. The implementation
lives in three files and intentionally avoids touching the Zustand store so it
can be dropped into the existing UI with minimal coupling.

## Files

| File | Purpose |
|---|---|
| `src/theme.ts` | Theme manager — reads/writes the choice in `localStorage`, applies a `data-theme` attribute on `<html>`, and exposes `getTheme` / `setTheme` / `toggleTheme` / `subscribeTheme` / `initTheme`. |
| `src/theme-light.css` | CSS variable overrides applied when `<html data-theme="light">` is set. Re-skins the dark UI to light. |
| `src/components/ThemeToggle.tsx` | A reusable toggle button (sun/moon icon) that flips the theme. |

## How it works

1. On startup, call `initTheme()` once. It reads the persisted theme from
   `localStorage` (key `newton.theme`), falls back to the OS
   `prefers-color-scheme`, then to `dark`, and sets `data-theme` on the root
   `<html>` element.
2. `theme-light.css` defines `:root[data-theme='light'] { ... }` overrides for
   Newton's design tokens (background, text, border, accent, etc.). The default
   (dark) values continue to come from the existing global stylesheet, so only
   the light theme adds overrides.
3. `ThemeToggle` flips the attribute and persists the choice. Any component can
   subscribe to changes via `subscribeTheme`.

## Context visibility in both modes

The welcome digest / context banner (the strip that shows your stack, codebase
stats, open tasks, and recent files) reads several design tokens that the light
theme now overrides explicitly so the text always contrasts against its
background:

| Token | Purpose |
|---|---|
| `--context-bg` / `--digest-bg` / `--banner-bg` | Banner background fill |
| `--context-fg` / `--digest-fg` / `--banner-fg` | Banner text color |
| `--context-border` / `--digest-border` | Banner border |
| `--inline-code-bg` / `--inline-code-fg` / `--code-bg` / `--code-fg` | Inline code chips inside the digest/chat |
| `--badge-bg` / `--badge-fg` / `--chip-bg` / `--chip-fg` | Badges & pills |
| `--info-bg` / `--info-fg` / `--accent-soft-bg` / `--accent-soft-fg` | Accent-tinted info surfaces |

In dark mode these tokens fall back to the global dark stylesheet values; in
light mode they resolve to the lighter, higher-contrast variants defined in
`src/theme-light.css`. There are also scoped rules for `.welcome-digest`,
`.context-banner`, `.digest-banner`, and inline `code` to guarantee legibility
even if a component hard-codes a background.

## Wiring the toggle into the UI

Import the stylesheet and initialize the theme once at the app entry point
(`src/main.tsx`):

```ts
import './theme-light.css'
import { initTheme } from './theme'

initTheme()
```

Then drop the toggle wherever a control belongs (top bar, settings modal, etc.):

```tsx
import ThemeToggle from './components/ThemeToggle'

<ThemeToggle withLabel />
```

The toggle works on its own — no store changes required.

## Extending the light theme

If a component reads a CSS custom property that is not yet overridden, add it to
the `:root[data-theme='light']` block in `src/theme-light.css`. Keep the dark
defaults in the main stylesheet and only override what needs to change for
light mode.

## Programmatic API

```ts
import { getTheme, setTheme, toggleTheme, subscribeTheme, type Theme } from './theme'

getTheme()              // 'dark' | 'light'
setTheme('light')       // force light
toggleTheme()           // flip, returns new theme
const stop = subscribeTheme((t) => console.log('theme is now', t))
stop()                  // unsubscribe
```
