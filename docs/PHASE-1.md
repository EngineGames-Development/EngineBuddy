# Phase 1 — Vertical Slice Plan

Goal: the smallest end-to-end path through every layer, built so that later phases *extend* it rather than rewrite it.

```
Windows desktop → transparent window → animated avatar → speech bubble → click avatar
→ ask → AgentController → ClaudeCodeAgent → one SAFE tool → result → avatar reacts
```

## Scope

**In:** avatar window (transparent, on top, custom drag, click-through, scale, position memory),
tray (Show/Hide, Pause, Exit), avatar rig with 7 working states (IDLE, THINKING, TALKING,
WORKING, HAPPY, CONFUSED, ERROR; the other 7 fall back to these), speech bubble with streaming
text, input field and activity list, EventBus, AgentController, MockAgent, ClaudeCodeAgent,
PolicyEngine (SAFE/BLOCKED only), 2 SAFE tools, native context menu, startup greeting.

**Out:** chat window, confirmations/CONFIRM tier, memory, project detection, proactive
behaviour, voice, settings UI (Phase 1 settings live in a JSON file), installer.

**The two SAFE tools:**
- `get_system_info`: CPU model and load, RAM used/total, disk free per drive, uptime. Read-only, via `node:os` plus `systeminformation`.
- `open_in_vscode(path)`: runs `code <path>` via `execFile` (no shell). The path must exist.

Phase 1 doesn't ask for `open_in_vscode`, but it's the first "computer action" from your spec,
and it costs about 30 lines.

---

## Steps

Each step lists what gets built, how it's verified, and what's done.

### Step 0 — Spikes (throwaway, in `spikes/`, deleted after)

De-risk the two assumptions everything else rests on.

**0a. Window spike.** A bare Electron app with a transparent, frameless, always-on-top window and an SVG circle.
- Check: clicks on transparent pixels reach the desktop/VS Code; hovering the circle makes it clickable; right-click and double-click fire; custom drag works.
- Test at 100% and 150% scaling, on one monitor and on two if you have them.
- Done when: all of the above is observed. Results recorded in `docs/decisions/001-window-spike.md`.

**0b. Agent spike.** A Node script using `@anthropic-ai/claude-agent-sdk` with your `claude.exe`, `settingSources: []`, one in-process MCP tool, `canUseTool` and a `PreToolUse` hook.
- Check: streaming deltas arrive; our MCP tool is called; `canUseTool` fires for **every**
  tool, including built-in Read/Bash; denying Bash really prevents it; `resume` keeps context;
  abort works. Measure the time to first token.
- Save 3–4 real transcripts as JSON fixtures for the translator tests.
- Done when: all checks pass, or we've documented what doesn't and adjusted ARCHITECTURE.md §6.

> If 0a fails badly, stop and revisit D1 (Tauri) before writing more code.

### Step 1 — Scaffold

electron-vite + TypeScript (strict) + React (renderer only) + vitest + ESLint (with an import-boundaries rule) + Prettier. Layout as in ARCHITECTURE.md §10. Scripts: `dev`, `build`, `test`, `lint`, `typecheck`.
- Done when: `npm run dev` opens an empty transparent window; `npm test` runs a placeholder test; lint enforces that `core` can't import `electron`.

### Step 2 — Shared contracts

`src/shared/events.ts` (the BuddyEvent union), `src/shared/ipc.ts` (channel names + zod schemas), `src/shared/avatar.ts` (the 14-state enum).
- Done when: it typechecks and the preload exposes `window.buddy.{onEvent, send, window.*}` only.

### Step 3 — Avatar window shell

Main: window creation (ARCHITECTURE.md §8.1), custom drag over IPC, click-through toggling from renderer hit-tests, scale (Ctrl+scroll), position persistence per display with off-screen clamping, snap to corners, single-instance lock, tray (Show/Hide, Pause, Exit).
- Verify (manual checklist, `test/manual/window.md`): drag, click-through, restart keeps the position, unplugging a monitor brings it back on-screen, the tray works, it's not in Alt-Tab.
- Done when: every checklist item passes.

### Step 4 — Avatar engine

Rig (SVG parts), pose definitions, tween engine, AvatarStateMachine (priority, hold, return state), reactions table, idle micro-animations, frame throttling when idle.
A hidden debug keybind (Ctrl+Alt+D) cycles through states.
- Tests: state machine unit tests (priority interrupts, holds, fallback for missing states, Sleep override); reactions table → expected state sequence for a scripted event stream.
- Verify: watch every state; idle CPU measured (target < 2% in Phase 1).
- Done when: tests pass and you've seen and okayed the character concept. **This is your first design checkpoint.**

### Step 5 — EventBus, AgentController, MockAgent

The EventBus with a ring buffer; AgentController (turn IDs, single active turn, cancel); a MockAgent that plays scripted turns (thinking → narration → tool_start → tool_result → message deltas → turn_end) with realistic delays.
- Tests: controller ordering, cancel mid-turn, queueing a second input.
- Done when: the avatar animates correctly through a full mock turn with **no Claude involved**. This is what keeps UI work token-free.

### Step 6 — Speech bubble

Animate in/out, grow to fit content (capped width, scroll past N lines), streaming text, a minimal Markdown subset, the activity list (● running / ✓ done / ✕ failed), auto-dismiss after a configurable time (paused while the turn is active or the cursor hovers), edge-aware placement.
Click avatar → bubble opens with input focused; Esc closes it; Enter sends.
- Done when: a mock turn reads well in the bubble at both scale 1.0 and 1.5, near all four screen edges.

### Step 7 — Tools + PolicyEngine

ToolDef/ToolRegistry, the two SAFE tools, PolicyEngine with the default-deny table (Phase 1: SAFE vs BLOCKED), secret-path denylist + normaliser, audit log.
- Tests: policy table cases; the denylist's positive/negative/traversal cases; tool input validation.
- Done when: tests pass and the audit log records allows and denials.

### Step 8 — ClaudeCodeAgent

The SDK wrapper, translator (SDK message → BuddyEvent), personality prompt append, both permission gates wired to the PolicyEngine, `resume` across turns, cancel, error mapping
(missing executable / auth failure / network → a friendly `agent_error`), local narration fallback.
- Tests: the translator against the recorded fixtures from 0b; an integration test (opt-in, uses tokens) asserting Bash is denied and logged.
- Done when: a real question in the bubble streams back with the avatar going THINKING → TALKING → IDLE, and asking "how's my PC doing?" triggers `get_system_info` with WORKING → HAPPY.

### Step 9 — Context menu + menu intents

A native context menu containing only items that work: **Ask EngineBuddy** (opens the bubble), **System check** (sends a structured `menu:system_check` intent through the AgentController, so the tool use, narration and reaction follow the same path as a typed request), **Open in VS Code…** (folder picker → tool), **Pause/Resume**, **Exit**.
- Done when: every item works, and the system check is narrated in the bubble.

### Step 10 — Startup

Fade in; after ~1.2 s "Hey." → ~1.5 s → "What are we building today?" (local lines, no tokens); then the bubble auto-dismisses. Pre-warm the Claude session in the background.
- Done when: a cold start to the greeting takes under 3 s, measured.

### Step 11 — Slice review

Run the 11-step demo script below; fix what's broken; write `docs/decisions/00x-phase-1-review.md` (what worked, perf numbers, what changes for Phase 2).

---

## Demo script (Phase 1 exit criteria)

1. Start EngineBuddy → the avatar fades in near the bottom-right of the screen.
2. It's floating on the desktop; clicking empty space around it reaches the window underneath.
3. Click it → the bubble opens with an input.
4. Type "what's a linker script, short version?"
5. The bubble shows the reply.
6. The reply streams in.
7. The avatar goes THINKING → TALKING → IDLE.
8. Right-click the avatar.
9. The context menu opens.
10. Choose **System check** → WORKING, activity list "● Reading system info" → ✓.
11. The bubble says something like "You're fine. 23% CPU, 11 of 32 GB used, C: has 140 GB free." → HAPPY.

Plus one negative check: ask "run `dir C:\` in a terminal" → it explains it can't run commands yet → CONFUSED or shrug, and the audit log shows the Bash request denied.

---

## Rough size

About 2.5–3.5k lines of TypeScript, excluding tests, across ~11 reviewable steps.
Each step is a separate commit (or PR, if you want reviews), so you can follow the code as it grows.
