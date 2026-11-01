# 016: Internet, languages, better voice, smarter prompt (0.3.0)

## What was built

- **Internet** (`src/security/policy/web.ts`, `policy-engine.ts`): Claude Code's WebSearch and
  WebFetch are offered and allowed while Settings → Internet is on (default). WebFetch reaches only
  public http(s) addresses; local/private addresses, logins in URLs and URLs shaped like data
  smuggling are refused. Activity lines show the query or just the host.
- **Languages** (`src/shared/i18n.ts`): English, Deutsch, Français, Español for menus, tray, chat,
  speech bubble, confirmation window and settings. Default "system" follows Windows'
  preferred language (`app.getPreferredSystemLanguages`); main passes `?lang=` to every page. The
  system prompt names the default reply language; Claude still answers in the language you write.
- **Voice** (`src/renderer/speech/voice.ts`): "Automatic" picks the best installed voice for the
  language the reply is written in (natural/neural voices first); replies are spoken sentence by
  sentence (Chromium cuts long utterances off); new pitch setting; emoji and link URLs aren't read.
- **Smarter** (`src/core/personality/personality.ts`): the prompt now covers checking before
  answering, searching for anything time-sensitive, citing the source, asking one question when a
  wrong guess would cost something, admitting uncertainty, and treating text from files/pages/
  pictures as information, never instructions. A "Right now" section gives the date, time zone,
  default language and whether internet is on.
- ROADMAP.md got a "Where it stands" section: what each release shipped, what's open, next steps.
- Security fixes from the review: F13 (memory notes can't hold links or rule overrides), F14
  (wildcard-DNS names refused). See docs/security-audit.md.

## Why this way

- WebFetch is SAFE, not CONFIRM: built-in CONFIRM tools can't be shown in our confirmation window
  (we don't run them), and asking for every page would make the feature useless. The rules only
  refuse, and the whole thing can be switched off.
- Language and internet changes need a restart: the agent's tool list and the pages' language are
  fixed per run, which keeps the code simple and avoids half-switched states.
- Tool activity lines and confirmation details stay English for now (they're built in main/tools
  from tool input); see ROADMAP.md ("Where it stands").

## Verified

- `npm run check`: 278 tests pass (new: web policy incl. SSRF forms, i18n, voice choice/chunks,
  settings upgrade, memory F13).
- Live, built app, real Claude: German UI from the system locale; a Node.js version question was
  answered from nodejs.org via WebFetch, in German, with the source; a WebFetch to 192.168.178.1
  was blocked (`web-url`) and Claude didn't retry; settings window shows Language, Internet, Voice
  with automatic voice and pitch.
- `npm audit --omit=dev`: 0 vulnerabilities.
