# 008 — Speech bubble (Phase 1, step 6)

Date: 2026-11-01

## What exists now

All in `src/renderer/speech/`:

| File | Role |
|---|---|
| `bubble-model.ts` | Pure reducer: BuddyEvents (+ open/close) → what the bubble shows |
| `markdown.ts` / `MarkdownView.tsx` | Markdown subset → small tree → React text nodes. Never HTML |
| `placement.ts` | Above/below choice and sideways shift near screen edges |
| `SpeechBubble.tsx`, `bubble.css` | The component: animate in/out, streaming text, activity list, input, Stop button, auto-dismiss |

Click the avatar → the bubble opens with the input focused; Enter sends; Esc closes.
`bubbleDismissSeconds` (default 12) lives in `settings.json` and reaches the page as a URL query
parameter at load.

## Decisions

1. **The bubble shows one turn**: your question, narration, activity list, the reply. A new
   turn starts fresh. The full history belongs to the chat window (Phase 2).
2. **Above or below is chosen once per opening**, needing room for the bubble's *maximum* height,
   so it never flips while a reply streams in. Horizontal placement is recomputed on every render,
   on resize and after a drag.
3. **Text blocks around tool calls get a paragraph break**, and a final `message` is only added
   if the deltas didn't already carry it.
4. **Auto-dismiss waits** while a turn runs, while the cursor is over the bubble, and while
   there's a draft in the input.
5. **Markdown subset:** paragraphs, `-`/`*`/numbered lists, fenced code, `**bold**`, `*italic*`,
   `` `code` ``. Links and HTML stay literal text. Half-streamed markup renders as written.
6. **Settings reach the page in its URL query** (read-only, at load), instead of widening the
   preload API with a settings getter.
7. **No Playwright smoke test yet** (proposed in 004). The DevTools-protocol driver used below did
   the job without a new dependency; revisit if the UI checks need to run in CI.

## Verified

- 19 unit tests (reducer: question, tools + block breaks, final message, queued prompts, stale
  events, cancel, errors outside a turn; placement: open space, all four edges, scale 1.5;
  Markdown: inline, half-streamed, no HTML, lists, fences).
- Built app, driven over the DevTools protocol with page-level input (click the avatar, type,
  Enter; no OS mouse): a mock question and a mock system check at the centre and all four screen
  corners, at scale 1.0 and 1.5. The bubble went above or below as expected every time, stayed on
  screen, and read well. Captures: `docs/images/bubble/`.
- Auto-dismiss: still open ~9 s after the turn ended, closed by ~13 s (default 12 s).

## Found and fixed while verifying

The input didn't get focus on open, because it was still `visibility: hidden` when the focus call
ran. Now it focuses in an effect after the open class is committed.
