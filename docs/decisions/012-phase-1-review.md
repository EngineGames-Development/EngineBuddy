# 012 — Phase 1 review (step 11)

Date: 2026-11-01/02 · Windows 11, one 1920×1080 display at 100 % · Claude Code 2.1.316, claude-opus-5-5

The demo script from docs/PHASE-1.md, run against real Claude in the built app. Input was
page-level (DevTools protocol) and menus were captured in the main process, so nothing drove your
real mouse or showed menus on your screen.

## Demo script

| # | Step | Result |
|---|---|---|
| 1 | Start → fades in near bottom-right | ✅ Greeting "Hey." 2.78 s after start (see Performance) |
| 2 | Clicks on empty space reach the window below | ✅ Click-through switches off over the avatar and back on over empty space. Real-mouse check: `test/manual/window.md` |
| 3 | Click → bubble opens with input | ✅ Opens, input focused |
| 4–6 | Ask "what's a linker script, short version?" → reply streams | ✅ First token 1.6 s after sending (warm session) |
| 7 | THINKING → TALKING → IDLE | ✅ `THINKING@14073 → TALKING@15796 → IDLE@18586` |
| 8–9 | Right-click → menu | ✅ Ask EngineBuddy, System check, Open in VS Code…, Pause, Exit |
| 10 | System check → WORKING, "● Reading system info" → ✓ | ✅ |
| 11 | Bubble reports the numbers → HAPPY | ✅ "CPU is at 75% and RAM is at 11.2 of 13.9 GB… C: 17.4 GB free of 475.5 GB"; HAPPY on the tool result |

**Negative check** ("run `dir C:\` in a terminal"): ⚠️ partly. EngineBuddy explains it can't run
commands yet and suggests doing it by hand, but the model never *requests* Bash, because the
personality prompt already says it can't. So there's no Bash entry in the audit log and no
CONFUSED; the avatar goes THINKING → TALKING → IDLE. Safe, just not the path the script expected.
The gate itself is proven by the opt-in live test (`EB_INTEGRATION=1`), where the model *is* told
to use Bash: the hook denied it, nothing ran, the denial was audited.

## Fixed during the review

- After HAPPY for a finished tool, the avatar fell back to WORKING while Claude was already
  writing the answer. A reaction can now set the state that follows it (`then`); tool results set
  THINKING. (Commit 73080de.)

## Performance

| What | Measured |
|---|---|
| Cold start → "Hey." | 2.6–2.8 s on quiet runs; 5–8 s on some runs while RAM was ~90 % used |
| First token, warm session | 1.6–2.4 s |
| Idle CPU (avatar only) | 1.6 % of the machine (6.3 % of one core) |
| Memory | ~330 MB working set across Electron's 4 processes, plus Claude Code's process |
| `get_system_info` | ~410 ms (400 ms of it is the CPU-load sample) |

## What worked

- The event table. Every avatar behaviour in the demo came from `reactions.ts`; no agent code
  knows the avatar exists.
- The MockAgent kept all UI work token-free; real Claude was needed only for step 8 and this review.
- The spike transcripts: the translator was right against real Claude on the first live run.
- Two independent gates plus the runner's re-check, all writing to one audit log.

## What didn't, or isn't done

- The negative check (above).
- Startup time depends heavily on how busy the machine is (decision 011).
- Real-mouse window checks, 150 % scaling and two monitors: `test/manual/window.md`, unticked.
- The character design still needs your OK (decision 006).

## For Phase 2

1. **Confirmation window + CONFIRM tier.** It's what makes shell commands, file edits and opening
   arbitrary programs possible without giving up control. ConfirmationBroker, `ToolDef.describe()`.
2. **Decide how the model should treat refused tools.** Either keep "say you can't" in the prompt
   (fewer tokens, no audit trail), or let it try so the refusal is visible. With confirmations,
   the question mostly goes away.
3. **Startup:** show the window before the renderer is ready, or slim the renderer, if 3 s still
   isn't met on a quiet machine.
4. **Idle cost:** fewer idle frames or a smaller window, toward Phase 6's < 1 %.
5. **Grep** as our own tool that skips secret files (decision 009).
