# CLAUDE.md

EngineBuddy: a Windows desktop companion (Electron + TypeScript + React) whose brain is the user's
installed Claude Code, via the Claude Agent SDK. Read ARCHITECTURE.md for the design and
SECURITY.md for the permission model before changing anything in `src/security`, `src/tools`,
`src/main/ipc`, `src/preload` or the confirmation window.

## Hard rules

- **Subscription only, never per-request billing.** Claude runs on the user's claude.ai login.
  Keep the `apiKeySource === 'none'` check, the billing-env stripping (for Claude Code *and* for
  `run_command`), and the regression tests. Never add an API-key option or `ClaudeApiAgent`.
- **Default deny.** A tool not in the PolicyEngine table can't run. New tools need: a strict zod
  input, a `permission()` rule, an `activity()` line, and `describe()` if it can be CONFIRM.
- **Nothing runs a shell built from model text** except `run_command`, and only after the user
  clicks Allow in the confirmation window. Everything else is an executable + argument array.
- **The command classifier only escalates** to BLOCKED. Never make it "allow" anything.
- **Renderers are untrusted.** No Node/Electron in `src/renderer`; every renderer → main message is
  schema-checked in main; model text is rendered as text nodes only, never HTML.
- **Layer rules are enforced by lint** (`eslint.config.mjs`, ARCHITECTURE.md §10): `renderer` →
  `shared` only; `core` → `shared`; `tools`/`security` → `core`, `shared`; `integrations` →
  everything but `main`. Tests that need several layers go in `test/`.

## Commands

| Command | What |
|---|---|
| `npm run dev` | Run with hot reload |
| `npm run build` then `npm run preview` | Production build / run it |
| `npm run check` | typecheck + lint + Prettier check + tests. Run before every commit |
| `npm test` | Unit tests only (no tokens) |
| `EB_INTEGRATION=1 npx vitest run test/integration` | Live test against real Claude (uses the subscription) |
| `npm run dist` | Windows build in `release/` (see README) |

If Electron fails to start after `npm install`: `node node_modules/electron/install.js`.

## Where things are

| Path | What |
|---|---|
| `src/shared/` | Types crossing processes: BuddyEvent, commands (zod), IPC contract, layout |
| `src/core/` | Pure TS: EventBus, AgentController, personality, placement, ToolDef |
| `src/security/` | PolicyEngine, paths + secret denylist, command classifier, ConfirmationBroker, audit log, ToolRunner |
| `src/tools/` | Tool implementations (system info, apps, VS Code, run_command) |
| `src/integrations/` | ClaudeCodeAgent (+ translator), MockAgent, local turns |
| `src/main/` | Electron main: windows, tray, menu, IPC router, settings |
| `src/renderer/avatar/`, `speech/`, `confirm/` | Avatar engine, speech bubble, confirmation window |
| `docs/decisions/` | One record per step: what was built, why, how it was verified |
| `docs/security-audit.md` | Findings, fixes, residual risks. Update it with security-relevant changes |

## Conventions

- Avatar behaviour is data: add rows to `src/renderer/avatar/reactions.ts` and poses to
  `poses.ts`; the agent layer only emits facts (BuddyEvents).
- UI work uses the MockAgent (`"agent": "mock"` in `%APPDATA%\enginebuddy\settings.json`), so it
  costs no tokens.
- Window behaviour is checked by hand (`test/manual/window.md`); never drive the user's real mouse.
- Exact dependency versions (`--save-exact`). The Agent SDK is ESM-only: load it with dynamic
  `import()` from main.
- Comments explain *why*; user-facing strings sound like a friend ("Done.", not "Operation
  completed successfully.").
- Each piece of work gets a decision record in `docs/decisions/` and its own commit.
