# 005 — Avatar window shell (Phase 1, step 3)

Date: 2026-11-01

## What exists now

| Piece | Where |
|---|---|
| Window geometry (shared by main and renderer) | `src/shared/layout.ts` |
| Restore / clamp / snap / rescue, pure and tested | `src/core/window/placement.ts` |
| Window controller (drag, snap animation, scale, persistence, display changes) | `src/main/windows/avatar-window.ts` |
| Settings JSON file (`userData/settings.json`) | `src/main/settings/` |
| Tray: Show/Hide, Pause, Exit; icon drawn in code | `src/main/tray.ts` |
| Hit-testing, drag, Ctrl+scroll | `src/renderer/avatar/window-interaction.ts` |
| Manual checklist | `test/manual/window.md` |

## Decisions

1. **One fixed-shape window with the avatar at its centre**, not a window that grows when the
   bubble opens. The window is avatar + room for the bubble on every side (460×636 at scale 1).
   The empty area is click-through, so it costs nothing in interaction, and the renderer can place
   the bubble above/below/shifted without asking main to resize and reposition in sync (no
   flicker, no resize race). Keeping the avatar at the centre also keeps the window's centre on
   the avatar's monitor, which is what Windows uses to pick the window's DPI.
   The window may extend past the screen edge; only the **avatar's rectangle** is clamped, snapped
   and saved.
2. **Scale is 0.75–1.5 in steps of 0.125.** At 1.5 the window is 954 px tall; larger would exceed
   a 1080p screen, and Windows clamps windows taller than the screen.
3. **The renderer derives the scale from its own width** (`innerWidth / WINDOW_BASE.width`), so
   no "scale changed" event is needed.
4. **`type: 'toolbar'`** (WS_EX_TOOLWINDOW) keeps the window out of Alt-Tab, not just the taskbar.
5. **Pause = Sleep mode.** The tray's Pause broadcasts `mode_changed: sleep`; the avatar sleeps
   (step 4) and the AgentController refuses turns (step 5).
6. **Settings fields fall back one by one** (`zod .catch`), so a hand-edit with one bad value
   doesn't reset everything. Writes are debounced and atomic (temp file + rename).
7. **Positions are saved per display ID**, plus the last display used. If that display is gone at
   startup, the avatar goes to the default spot on the primary display.

## Verified

- Unit tests for placement (restore, fallback when a monitor is gone, clamping after a resolution
  change, rescue, corner snapping) and for settings parsing.
- Built app, driven over the DevTools protocol (no mouse): see the bottom of `test/manual/window.md`.

## Not yet verified (needs your mouse and screens)

Everything in `test/manual/window.md` that depends on real input: click-through, drag feel,
snapping, Ctrl+scroll, tray, Alt-Tab, 150 % scaling, two monitors.
