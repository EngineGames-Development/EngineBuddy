# EngineBuddy — Roadmap

Each phase ends with something you can **run and use**, plus a short written review of what
worked, what didn't, and what decisions changed (appended to `docs/decisions/`).
No phase starts until the previous one's exit criteria pass.

## Where it stands (0.3.0, 2026-11-01)

0.3.0 is the last feature release for now.

| Version | Shipped |
|---|---|
| 0.1.0 | Phase 1 complete: avatar, bubble, Claude Code on your claude.ai subscription, system check, opening programs, VS Code, `run_command` behind the confirmation window, secret-path denylist, audit log, Windows installer (part of Phase 6) |
| 0.2.0 | Most of Phase 2 and 3: chat window with history, pictures (paste, drop, screenshot; part of Phase 8), file edits with a diff confirmation, settings window, memory with a Settings inspector, voice output (part of Phase 7) |
| 0.3.0 | Internet (web search, public pages; part of Phase 8), UI in English/Deutsch/Français/Español following Windows, automatic voice per language with pitch, a smarter prompt with date/time and language context |

Still open from the phases below: inline action buttons, custom context menu, the remaining
avatar states, project awareness (Phase 4), proactive behaviour (Phase 5), desktop modes (Phase 6),
speech input (Phase 7), LocalAgent and other platforms (Phase 8).

### Next small steps

- Translate tool texts too: activity lines ("Reading nodejs.org") and confirmation details are still English.
- Switch language live, without a restart; clear the restart banner when a setting is changed back.
- A SAFE `open_url` tool for public pages in your default browser.
- Grep inside projects, with `.env` and key files excluded (blocked on purpose for now).
- Natural voices: Windows' neural voices aren't exposed to Chromium's Web Speech API; needs a small
  native helper (`Windows.Media.SpeechSynthesis`) or an offline neural TTS.

### Quality and safety

- An independent security review (docs/security-audit.md is a self-review).
- Code signing for releases, so SmartScreen stops warning.
- DNS-rebinding protection for WebFetch (audit R13), and the dev-only minimatch advisory (F12).
- Run the window checklist (`test/manual/window.md`) on a second monitor and high DPI.

---

## Phase 1 — Vertical slice *(detailed plan: [docs/PHASE-1.md](docs/PHASE-1.md))*

Desktop → transparent window → animated avatar → bubble → ask → Claude → one safe tool → avatar reacts.

**Exit:** the 11-step demo from the spec works end to end on your machine, with unit tests
for the state machine, policy and event translation.

## Phase 2 — Control & conversation

- Confirmation window + CONFIRM tier enabled (file edit with diff, `run_command`, delete → Recycle Bin)
- Full chat window: conversation list, new conversation, streaming Markdown, code blocks, tool activity, Cancel
- Inline action buttons in replies ("Fix it / Explain / Cancel"): the agent proposes, the buttons send structured intents
- Custom-styled context menu (replaces the native one)
- Settings window: opacity, scale, snap, click-through, autostart, Claude executable path, auth
- Tray menu complete (Online status, Pause, Restart)
- All 14 avatar states with real poses, plus the greeting wave

**Exit:** "Fix my build" on a deliberately broken sample project, with narration, one confirmation, a rebuild, and a HAPPY reaction.

## Phase 3 — Memory & personality

- `memory/` store: `user.json`, `preferences.json`, `facts.json`, `projects.json`, `conversations/`
- `remember …` / `forget …` / "what do you remember about me?" as tools + a Settings → Memory inspector with delete
- Relevant facts injected into turn context (small, scored; never the whole store)
- Personality tuning pass: the line pools, the system-prompt voice, a sarcasm dial

**Exit:** facts survive restart, are visible, and are deletable. A blind read of 20 replies sounds like a friend, not a support bot.

## Phase 4 — Project awareness

- ProjectRegistry: scan configured roots; detect language, build system, git, README
- Active-project detection: foreground window (VS Code title / terminal cwd) via a small Win32 helper
- Project tools: `git_*`, `project_info`, `open_project` (VS Code + optional terminal), `run_build` (CONFIRM, then remembered per project)
- "Open my SecureOS project" and "What's wrong with my compiler?" resolve without paths

**Exit:** "Hey EngineBuddy, what am I working on?" gives a correct answer for your real projects.

## Phase 5 — Proactive behaviour

- Watchers: build output (from `run_build`), CPU spikes (sustained, not momentary), git dirty-state on project switch, system idle (`powerMonitor`)
- **NotificationGate**: priorities (critical/high/normal/low), per-kind cooldowns, a global budget (e.g. ≤1 unsolicited remark per 15 min outside critical), mode-aware (Focus: high+ only; Silent: none spoken; Sleep: none), fullscreen/presentation suppression
- Every proactive remark has a "less of this" option that tunes its kind's threshold

**Exit:** a full working day with it running produces remarks you'd keep, and none you'd mute.

## Phase 6 — Desktop modes & polish

- Companion / Focus / Developer / Silent / Sleep modes fully wired (size, verbosity, event-log overlay in Developer)
- Fullscreen-app auto-hide, multi-monitor follow, smooth snapping
- Performance pass: idle CPU < 1%, RAM budget measured and documented
- Installer (electron-builder NSIS), auto-update decision

## Phase 7 — Voice (optional, off by default)

- Push-to-talk first, wake word ("Hey EngineBuddy") later
- STT: local (whisper.cpp) preferred; TTS: Windows voices via Web Speech API, with cloud as an option
- Mouth animation synced to TTS boundary events / amplitude

## Phase 8 — More brains & reach

- `LocalAgent` (Ollama) behind the same interface. No `ClaudeApiAgent`: per-request billing is ruled out (ARCHITECTURE D8)
- Screen analysis (opt-in, per request)
- Browser tool, notifications integration
- macOS / Linux builds

---

### Not planned (deliberately)

- Unrestricted shell or "auto-approve everything" mode
- Background screen capture or keystroke logging
- Reading credential stores for any reason
