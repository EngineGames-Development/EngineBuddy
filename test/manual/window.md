# Manual checklist: avatar window (Phase 1, step 3)

Window behaviour is checked by hand with a real mouse, not by an automated driver on your live
desktop (docs/decisions/001-window-spike.md, finding 2). Run `npm run dev` (or `npm run build`
then `npm run preview`) and tick each item. Record the date, scaling and monitor setup.

Settings live in `%APPDATA%\enginebuddy\settings.json`. Delete it to get back to the defaults.

| # | Check | How | Result |
|---|---|---|---|
| 1 | Starts bottom-right, above the taskbar | Delete settings.json, start | |
| 2 | Clicks on empty space around the avatar reach the window underneath | Put a text editor behind it, click right next to the avatar | |
| 3 | Hovering the avatar makes it clickable (cursor turns into a grab hand) | Hover | |
| 4 | Drag moves it smoothly, and a drag doesn't also count as a click | Drag | |
| 5 | Dropping it near a screen corner snaps it into the corner | Drag to within ~50 px of a corner | |
| 6 | Dropping it half off-screen pulls it back | Drag past an edge, release | |
| 7 | Ctrl+scroll on the avatar scales it (0.75–1.5), around its centre | Ctrl+wheel up/down | |
| 8 | Restart keeps position and scale | Move, scale, Exit from tray, start again | |
| 9 | Unplugging a monitor (or changing resolution) brings it back on-screen | Move it to monitor 2, unplug / change resolution | |
| 10 | Tray: left-click toggles Show/Hide; menu has Hide/Show, Pause, Exit, and each works | Tray icon | |
| 11 | Not in Alt-Tab, not in the taskbar | Alt-Tab | |
| 12 | Starting it a second time doesn't create a second avatar (and shows a hidden one) | Hide, start again | |
| 13 | It never steals focus when it appears | Start while typing in an editor | |
| 14 | 150 % display scaling: items 2–7 still hold | Windows display settings | |
| 15 | Two monitors: drag across, snap on monitor 2, restart remembers monitor 2 | | |

## Already verified without the mouse (2026-11-01, one 1920×1080 display @ 100 %)

Via the DevTools protocol on the built app: default spot bottom-right; `scaleBy(2)` → scale 1.25
with the window growing around the avatar's centre; `moveBy` + `dragEnd` saves the position per
display ID; a restart restores position and scale; a 5000 px `moveBy` is rejected by main's schema.
