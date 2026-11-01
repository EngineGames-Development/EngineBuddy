# 015: Chat window, pictures, file edits, settings, memory, voice

## What was built

- **Chat window** (`src/renderer/chat`): conversations on the left, messages with the activity
  list, live streaming. Opened from the context menu, tray, or ⤢ in the bubble. The bubble stays
  quiet for chat-window turns.
- **History** (`src/main/history/conversation-store.ts`): one JSON file per conversation in
  `userData/history`, fed from the BuddyEvent bus, so bubble and menu turns are recorded too. Each
  conversation stores Claude Code's session ID; opening it resumes that session
  (`AgentProvider.switchConversation`). At startup the last conversation continues.
- **Pictures**: Ctrl+V, drag and drop, or 📷 (main hides the chat window and uses
  `desktopCapturer`). Renderers redraw pictures on a canvas and scale them to 1568 px; main
  re-checks type, file signature and size (`src/shared/images.ts`). Sent to Claude as image blocks.
- **File edits** (`src/tools/files/file-edits.ts`): `write_file` and `edit_file`, CONFIRM, only in
  project folders, never `.env` or secret paths. The confirmation window shows a real diff
  (`src/core/diff/line-diff.ts`) computed from the file on disk. `edit_file` needs the old text
  exactly once, checks again when it runs, keeps CRLF, and writes atomically.
- **Settings window** (`src/renderer/settings`): project folders (added only through main's folder
  picker), voice, brain/model, bubble time, memory list. Accepted only from that window.
  Folder/model/brain changes offer a restart.
- **Memory** (`src/tools/memory/memory.ts`): `remember` / `forget` (SAFE), stored in
  `userData/memory.json`, appended to the system prompt as notes, never instructions.
- **Voice** (`src/renderer/speech/voice.ts`): finished replies are read aloud with Windows voices
  via the Web Speech API in the avatar window; Markdown and code are left out.

## Why this way

- History lives in main, not the renderer: the chat window shows model text, so it's untrusted,
  and the files must survive the window.
- Screenshots in main keep the "pages get no media permissions" rule (audit F1).
- Diffs are built from the disk, not from anything the model says about the change.

## Verified

- `npm run check`: 237 tests pass (new: line diff, file tools, history, memory, images/commands,
  voice text).
- Live, built app with real Claude: chat and settings windows open and render; a picture sent from
  the chat window was read correctly ("HALLO" in white on red); the conversation was saved to
  `userData/history`.
- Not yet checked by hand: the 📷 button, drag and drop, the diff confirmation with a real edit,
  hearing the voice.
