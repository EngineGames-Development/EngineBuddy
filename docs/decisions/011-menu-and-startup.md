# 011 — Context menu, menu intents, startup (Phase 1, steps 9–10)

Date: 2026-11-01

Steps 9 and 10 share most of their wiring (main's startup sequence, a main → renderer UI
request), so they're one commit.

## What exists now

| Piece | Where |
|---|---|
| Native context menu: Ask EngineBuddy, System check, Open in VS Code…, Pause/Resume, Exit | `src/main/context-menu.ts` |
| Right-click on the avatar → `context_menu` window command | `src/renderer/avatar/window-interaction.ts` |
| Main → one window: `UiRequest` (`open_bubble`) on `buddy:ui`, `window.buddy.onUi` | `src/shared/ipc.ts`, `src/preload/api.ts` |
| Local turns: a turn whose events come from code, not the model | `AgentController.submit(input, local)` |
| "Open in VS Code…" as a local turn through the ToolRunner | `src/integrations/local/local-tool-turn.ts` |
| Fade-in + greeting ("Hey." → "What are we building today?") | `src/renderer/avatar/greeting.ts`, `avatar.css` |

## Decisions

1. **System check is a structured intent through the AgentController** (`intent: 'system_check'`),
   so tool use, narration and the avatar's reaction follow the same path as typed text.
2. **"Open in VS Code…" doesn't ask the model.** The folder picker already gives the exact input,
   so it runs as a *local turn*: same turn boundaries, events, policy check and audit entry, no
   tokens, no chance of the model opening something else.
3. **Paused disables the menu's agent items** (greyed out) and shows Resume.
4. **The greeting lines come from main in the page URL**, like the bubble settings, so there's no
   race with React subscribing. If Claude Code can't be found, the greeting adds a third line
   saying so (the fallback from decision 010).
5. **Greeting lines are DOM events (`eb-say`)** inside the renderer; the avatar waves (EXCITED →
   HAPPY art) on the first and talks on the rest; the bubble shows them outside any turn and never
   over a running one.
6. **Claude Code is prewarmed only after the window is shown.** Starting it at app start (loading
   the SDK module, spawning `claude.exe`) delayed the window by seconds.
7. **The renderer bundle is now minified** (565 kB → 331 kB, with source maps). Revises decision
   003 #5: parse time showed up in the startup measurement.

## Verified

- Tests: local turn (events, policy, audit, launch with the path as one argument; a blocked path
  fails visibly and launches nothing), bubble `say` (and that it never talks over a turn),
  `context_menu` command schema, preload API shape. 160 tests pass.
- Built app, menus captured in the main process instead of shown on screen (inspector patch of
  `Menu.prototype.popup`), items clicked in code:
  - Items: `Ask EngineBuddy | — | System check | Open in VS Code… | — | Pause | Exit`.
  - Ask EngineBuddy → bubble opens, input focused.
  - Pause → SLEEPING, agent items greyed out, label becomes Resume → IDLE.
  - System check from the menu runs the same turn as step 8's live system check.
  - Open in VS Code…: not clicked live, to avoid opening a VS Code window on your desktop. The
    launch is covered by the unit test; `Code.exe` is found at the installer default
    (`%LOCALAPPDATA%\Programs\Microsoft VS Code\Code.exe`; `code` isn't on PATH in this environment).
- **Cold start → "Hey."** (built app, no DevTools load on main, measured by the page against the
  main process's start time):

  | Change | Runs (ms) |
  |---|---|
  | Prewarm at app start | 4050, 4021, 4444, 6377, 11155 |
  | Prewarm after the window shows | 2754, 3124, (9935 shown) |
  | + minified renderer | **2565, 2823**, 6565 shown → 7781, 4817 shown → ~6000 |

  Under 3 s when the machine isn't busy. The slow runs lose their time between `ready` (~0.4 s)
  and the window being shown, i.e. in Electron creating the window and renderer process. This
  machine was at ~95 % RAM use during the measurements (13.9 GB total, per `get_system_info`), so
  that's likely paging. **Target met on a quiet machine, not reliably on this one.** Worth
  re-measuring after a reboot; if it stays slow, show the window before the renderer is ready.
