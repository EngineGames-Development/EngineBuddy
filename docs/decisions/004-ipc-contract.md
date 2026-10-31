# 004 — Shared contracts and IPC (Phase 1, step 2)

Date: 2026-11-01

## What exists now

| File | Role |
|---|---|
| `src/shared/events.ts` | `BuddyEvent` union (ARCHITECTURE.md §4.1), plain types |
| `src/shared/commands.ts` | zod schemas for everything a renderer may ask: `user_input`, `cancel_turn`, and window commands `set_click_through`, `move_by` |
| `src/shared/ipc.ts` | Channel names + the `BuddyApi` interface. No runtime dependencies |
| `src/preload/api.ts` | `createBuddyApi(ipc)`: maps typed calls onto three channels. Pure, unit-tested |
| `src/main/ipc/ipc-router.ts` | The trust boundary: sender check + schema parse, then dispatch |
| `src/main/ipc/broadcast.ts` | Sends a BuddyEvent to every window |

Until the AgentController exists (Step 5), `user_input` is broadcast back as a `user_input` event and nothing answers.

## Decisions

1. **Events are plain types; commands are zod schemas.** Events flow from main (trusted) to
   renderers, and message deltas are the hottest path in the app, so they aren't re-validated.
   Commands come from renderers, which display model output and are treated as untrusted
   (ARCHITECTURE.md §3), so every one is parsed.
2. **Strict schemas.** Unknown command types and unknown keys are *rejected*, not stripped. A
   renderer can't claim `source: 'proactive'` (that's main's to use), text is capped at 8000 chars,
   and drag steps must be integers within ±4000 px.
3. **Sender check before parsing.** A message counts only if it comes from the *top-level* frame of
   one of our own pages (same `isOwnRendererUrl` check that guards navigation).
4. **Rejections are logged without the payload.** A payload may contain what the user typed.
5. **The preload doesn't validate and doesn't import zod.** It stays a ~20-line mapping layer; main is
   the only place where trust is decided. `window.buddy` and `window.buddy.window` are frozen.
6. **Window commands carry no window ID.** Main acts on the window that sent the message
   (`BrowserWindow.fromWebContents(sender)`), so a renderer can't move another window.
7. **The contract grows per step.** Step 3 adds drag-end (persist + snap) and scale to
   `windowCommandSchema` and `BuddyApi.window`, rather than this step stubbing them.

## Verified

- `npm run check`: 29 tests (command schemas: 4 accepted / 14 rejected cases; preload API shape,
  freezing, channels, unsubscribe; layer boundaries).
- In the built app, via the DevTools protocol (one-off check, not a committed test):
  - `window.buddy` keys are exactly as above, and it's frozen.
  - `require`, `process` and `module` are undefined in the page.
  - `user_input` makes the round trip to main and back as an event.
  - A forged `source: 'proactive'` and an unknown `run_command` are both rejected and logged by main.

A committed end-to-end smoke test (Playwright for Electron) is worth adding once there is UI to
drive. Proposed for Step 6, when the bubble's input exists.
