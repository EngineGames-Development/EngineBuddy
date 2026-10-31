# 001 — Window spike results (Phase 1, step 0a)

Date: 2026-10-31 · Code: `spikes/window/` · Electron 45.2.1 · Windows 11, one display 1920×1080 @ 100%

## Setup

A transparent, frameless, always-on-top 300×300 window with a 120 px purple circle (the "avatar").
The window starts with `setIgnoreMouseEvents(true, { forward: true })`; the renderer hit-tests
forwarded `mousemove` events and turns click-through off while the cursor is over the circle.
A custom pointer-capture drag moves the window over IPC. A striped "target" window sits underneath
and logs every click that reaches it, so it's always clear which window got the input.

## Results

| Check | Result | Evidence |
|---|---|---|
| Transparent background, alpha glow composited over other apps | ✅ | Screen captures (since deleted: they contained the user's screen) |
| Clicks on empty pixels pass through to the window below | ✅ | Driver run 3: target logged the click; `WindowFromPoint` skipped the avatar window |
| Forwarded hover toggles click-through | ✅ with real input | 20 toggles from real mouse movement in run 2; toggled off on reaching the circle in run 4 |
| Click / right-click / drag on the avatar | ✅ | `click`, `contextmenu`, `dragend` logged from real mouse use in run 2 |
| Double-click | ⏳ | Not observed yet. Manual checklist |
| Drag doesn't also fire a click | ⏳ | Code guards it (`moved > 3 px`); manual checklist |
| 150% scaling, second monitor | ⏳ | Only one 100% display available; untested |
| Startup to window ready | ~1 s | When launched from bash |

## Findings

1. **Synthetic `SetCursorPos` doesn't trigger click-through forwarding.** Electron's forwarding only
   sees real input events. The automated driver therefore can't test hover. This is a test
   artifact; real mouse movement worked. Any future automated test must use `SendInput`.
2. **Automated mouse tests on the user's live desktop are not acceptable.** Their apps (Chrome,
   chat) were on top of the test window, and two "transparent area" clicks landed in those apps.
   The driver now refuses to click unless `WindowFromPoint` belongs to the spike, and aborts if the
   mouse moves. Going forward, window behaviour is verified with the **self-ticking manual
   checklist** (`npm start` in `spikes/window`), not by driving the user's mouse.
3. `-webkit-app-region: drag` is not used (it would swallow clicks). Pointer-capture drag works.
4. Launching Electron via PowerShell `Start-Process` from the agent environment was unreliable
   (window appeared after 40 s or not at all); launching from bash was immediate. This only
   matters for tooling, not the app.

## Decision

D1 (Electron) **stands**. The core risk, per-pixel click-through on a transparent window, works on
this machine. Remaining items (double-click, DPI 150%, multi-monitor) go into the Step 3 manual
checklist; none of them would change the framework choice.
