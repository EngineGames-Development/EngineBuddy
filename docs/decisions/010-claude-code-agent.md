# 010 — ClaudeCodeAgent (Phase 1, step 8)

Date: 2026-11-01 · Agent SDK 0.3.316 (pinned) · Claude Code 2.1.316 · model claude-opus-5-5

## What exists now

| File | Role |
|---|---|
| `src/integrations/claude-code/claude-code-agent.ts` | Warm session, gates, MCP server, cancel, error mapping |
| `src/integrations/claude-code/translate.ts` | SDK message → AgentEvent; friendly error lines |
| `src/integrations/claude-code/environment.ts` | Billing-variable stripping, locating `claude.exe`, tool → activity line |
| `src/core/personality/personality.ts` | The appended system prompt, local narration line pools |
| `src/core/agent/async-queue.ts` | Push-based async iterable (session input, per-turn message routing) |
| `src/main/agent-setup.ts` | Builds registry, policy, audit, runner, and the agent from settings |
| `test/fixtures/claude-code/` | Four transcripts recorded in spike 0b |

New settings: `agent` (`claude-code` | `mock`), `claudeExecutable`, `claudeModel`, `projectRoots`.
With no project roots, Claude Code works in an empty `userData/workspace` folder.

## Decisions

1. **One warm session in streaming-input mode**, fed through a queue; one pump routes its messages
   to the running turn. If the session dies, the next turn starts a new one with `resume`.
2. **The session starts at app start (`prewarm`)**, but Claude Code only sends `init` after the
   first message arrives. Starting the process early still pays off: the first real turn's first
   token came 2.4 s after sending (vs ~14 s to `init` cold in spike 0b).
3. **No-billing guard on every session**: billing variables are stripped (case-insensitively), and
   an `init` with `apiKeySource` other than `none` aborts the session; every later turn is refused
   with "I'm not logged in the free way…". A race where the session ended just before a turn
   registered (the turn waited forever) was caught by the unit test and fixed: the session now
   records that it ended, and a new turn checks.
4. **Gates:** the PreToolUse hook and `canUseTool` both call the PolicyEngine and both write to the
   audit log (`by: hook` / `by: canUseTool`). Our MCP tools then go through the ToolRunner, which
   checks a third time and logs the result. A hook "allow" returns nothing, so `canUseTool` still runs.
5. **Built-ins exposed: Read, Glob, Bash.** Bash is listed so that a request for it reaches the
   gates and is refused visibly and audited (the integration test relies on this); Grep stays out
   (decision 009). ARCHITECTURE.md §6.2 updated.
6. **Local narration** is emitted when the model reaches for a tool without saying anything first
   (deterministic, not the ~800 ms timer from ARCHITECTURE.md §6.4: the translator knows whether
   text came first).
7. **Menu intents become a plain prompt** (`system_check` → "use get_system_info, then tell me…"),
   so they take the same path as typed text.
8. **The SDK is ESM-only and main is CommonJS**: it's loaded with a dynamic `import()`, which the
   bundle keeps as is. Types come from `import type`.

## Verified

- 12 tests without tokens: the translator replays the four spike transcripts (MCP tool, built-in
  Read, denied Bash with our reason, interrupted → cancelled vs unexpected error), and the agent runs
  against a fake SDK (one session for two turns, env stripped, options, billing refusal that
  persists, menu intent prompt, both gates deny Bash and audit it, cancel → `interrupt()`).
- **Live, opt-in** (`EB_INTEGRATION=1 npx vitest run test/integration`): with a fake
  `ANTHROPIC_API_KEY` in the environment, the model asked for Bash, the hook denied it, the marker
  file was never created, the denial was audited, and no `agent_error` (so no billing refusal).
- **Live, in the built app**, typed into the bubble (DevTools-protocol page input):
  - "what's a linker script, short version?" → first token after 2.4 s, streamed reply,
    `THINKING@496 → TALKING@2882 → IDLE@5356` (ms after sending).
  - "how's my PC doing?" → `get_system_info` (hook allow, canUseTool allow, runner result
    `CPU 63%, RAM 12/13.9 GB, C: 17 GB free`, 414 ms) → WORKING → HAPPY, then a real answer.
    Capture: `docs/images/bubble/live-system-check.png`.
  - "run `dir C:\` in a terminal" → the model said it can't run commands and how to do it by hand,
    *without* requesting Bash, so the audit log has no Bash entry for it and the avatar went
    THINKING → TALKING → IDLE rather than CONFUSED. See step 11.

## Known issues

- The live test's temp folder sometimes stays locked for a while after `claude.exe` exits
  (no process is left running); cleanup is best effort.
- When Claude Code can't be found, the app falls back to the MockAgent and only logs why. The
  greeting (step 10) should say so.
