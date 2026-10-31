# 003 — Project scaffold (Phase 1, step 1)

Date: 2026-11-01

## What exists now

| Piece | Where | Notes |
|---|---|---|
| Build | `electron.vite.config.ts` | Three builds: main, preload, renderer (one HTML entry per window; just `avatar` so far) |
| Types | `tsconfig.node.json`, `tsconfig.web.json` | One per runtime. Renderer code gets DOM types and **no** Node types, so `fs` doesn't even typecheck there |
| Lint | `eslint.config.mjs` | `MAY_IMPORT` table = ARCHITECTURE.md §10 import rules, enforced with `import-x/no-restricted-paths`; plus banned modules per layer (electron, child_process, Node builtins in renderers) |
| Tests | `vitest.config.mts`, `test/lint/boundaries.test.ts` | The boundary rules are tested like code: 5 forbidden imports must error, 2 allowed ones must not |
| Window | `src/main/windows/avatar-window.ts` | 160×160 transparent, frameless, always-on-top (`'floating'`), skips taskbar, shown inactive (doesn't steal focus) |
| Hardening | `src/main/security/harden.ts` | Every WebContents: no popups, no navigation off our pages, no `<webview>`. Sandboxed renderers, context isolation |
| Single instance | `src/main/index.ts` | A second launch exits |

`npm run check` = typecheck + lint + format check + tests.

## Verified

- `npm run dev` and `npm run preview` (production build) both open the window; main logs
  `avatar window shown { x: 1736, y: 896, width: 160, height: 160 }`. No renderer warnings or errors.
- The built page carries the strict CSP (`script-src 'self'`, no inline scripts).
- `npm run check` passes, 3 consecutive runs.

## Decisions

1. **TypeScript 6.0.3, not 7.0.** typescript-eslint 8.72 supports `<6.1`. Revisit when it supports 7.
2. **No `"type": "module"`.** Main and preload build to CommonJS. Sandboxed preload scripts must be
   CommonJS, and keeping main the same avoids a mixed setup. Config files that must be ESM use
   `.mts`/`.mjs`.
3. **Two CSPs, one source.** The HTML has the strict production CSP; a dev-only Vite plugin
   (`devCsp` in `electron.vite.config.ts`) loosens it for hot reload. Production never sees the loosened one.
4. **Renderer console → terminal in dev** (`forwardRendererProblems`), so CSP violations and React
   errors are visible without opening DevTools.
5. **Renderer bundle is unminified** (565 kB, React production build). That's electron-vite's default;
   for local files the size doesn't matter and stack traces stay readable. Revisit for the installer.
6. **Versions are pinned exactly** (`--save-exact`). Electron upgrades are deliberate (SECURITY.md §7).

## Known issues

- **Electron's binary isn't downloaded by `npm install` on this machine** (happened twice). Fix:
  `node node_modules/electron/install.js`. Cause not yet understood. If it recurs on a clean
  clone, add a `postinstall` check.
- **`npm audit`: 12 moderate warnings, all one advisory** (`minimatch` < 11.0.1, a ReDoS) inside
  ESLint and its plugins. Dev-only, run on our own globs. Runtime dependencies: 0 vulnerabilities.
  Will clear when ESLint updates.
- **The placeholder window still catches clicks** on its transparent corners. Click-through arrives in Step 3.
- **The first ESLint run in tests is slow** (cold TypeScript resolver). The boundary test warms it up in `beforeAll`; without that, it flaked once on the 5 s default timeout.
