# EngineBuddy — Security audit

Date: 2026-11-01 · Scope: everything on `main` up to and including the confirmation window
(docs/decisions/013) · Method: code review of every trust boundary, plus the automated and live
tests named below. This is a self-review by the same assistant that wrote the code, not an
independent audit; treat it as a checklist, and get a second pair of eyes before trusting it with
anything important.

## Summary

| | Count |
|---|---|
| Fixed during this audit | 4 (F1–F4) |
| Fixed in the GitHub-readiness step | 2 (F5, F7); F8 is your call |
| Accepted residual risks, documented | 8 (R1–R8) |
| Tests guarding security behaviour | ~110 of 205 |

No finding allowed the model to run a command, change a file or read a secret without your click.
The most serious ones (F3, F4) needed a crafted folder name or a command you approved yourself.

## Threat model (short)

From SECURITY.md §1: **the model can be wrong and can be manipulated** (prompt injection from a
README, a file, a command's output). The renderer shows model output, so it's untrusted too. Out of
scope: an attacker who already runs code as you.

## Trust boundaries reviewed

| Boundary | Controls | Verdict |
|---|---|---|
| Model → tools | Default-deny PolicyEngine; PreToolUse hook + canUseTool + ToolRunner re-check; strict input schemas; path normalisation (realpath, 8.3, junctions, UNC, ADS); secret-path denylist; escalate-only command classifier; CONFIRM via a window the model can't reach | ✅ |
| Renderer → main | contextIsolation, sandbox, no nodeIntegration; frozen 4-method preload API; sender-frame check; strict zod schemas; confirmation answers only from the window showing that request | ✅ |
| Confirmation UI | Separate main-owned window, literal command from validated input, model's reason labelled, Cancel default, Enter never allows, 500 ms Allow delay enforced in main, 2 min timeout → no, close → no | ✅ |
| Claude Code config | `settingSources: []`, `strictMcpConfig`, explicit tool list, no `allowedTools`; your own Claude settings and connectors can't pre-allow anything | ✅ |
| Billing | Billing env vars stripped for Claude Code **and** for approved commands (F4); `apiKeySource` must be `none` or the session is aborted | ✅ |
| Electron shell | CSP; navigation, popups, `<webview>` denied; permission requests denied (F1); no app menu (F2); fuses (F5) | ✅ after fixes |
| Child processes | Executable + argument array everywhere, no shell except PowerShell for approved commands; process tree killed on timeout/cancel; ELECTRON_RUN_AS_NODE removed | ✅ after F3 |
| Data at rest | Settings (no secrets), audit log (inputs redacted by key name, strings cut at 300 chars) | ⚠️ R6 |

## Findings

| ID | Severity | Finding | Fix | Status |
|---|---|---|---|---|
| F1 | Medium | Electron grants permission requests (camera, microphone, geolocation, notifications…) by default. A compromised renderer could have asked for the microphone. | `setPermissionRequestHandler` and `setPermissionCheckHandler` deny everything (`src/main/index.ts`) | Fixed |
| F2 | Low | The default application menu stayed active: Ctrl+Shift+I opened DevTools and Ctrl+R reloaded any window, including the confirmation window. | `Menu.setApplicationMenu(null)` | Fixed |
| F3 | Medium | `open_application` (SAFE, no click): Windows Terminal treats `;` in its arguments as a command separator, and Explorer splits arguments on commas. A folder named e.g. `x; new-tab cmd /c …` (from a cloned repo, say) could have turned "open a terminal here" into running a command. | Folders containing `;` or `,` are refused for these apps; test added | Fixed |
| F4 | Medium | Approved commands inherited EngineBuddy's whole environment, including any `ANTHROPIC_API_KEY`: an approved command could print it into the conversation, or run `claude` billed per request. | `run_command` gets the subscription-only environment; `ELECTRON_RUN_AS_NODE` removed; test added | Fixed |
| F5 | Medium | Electron fuses not set (SECURITY.md §7): a packaged build would honour `ELECTRON_RUN_AS_NODE`, `NODE_OPTIONS` and `--inspect`, letting anyone who can start it run arbitrary Node code as the app. | Fuses set in `electron-builder.yml`; verified on the built exe with `@electron/fuses read` (RunAsNode, NODE_OPTIONS, CLI inspect off; asar integrity + only-load-from-asar on) | Fixed (decision 014) |
| F7 | Low | Recorded transcripts in the repo contain local paths (app install ID, session folder names), CPU model and RAM size. | Paths and CPU name replaced with placeholders in `test/fixtures`; `spikes/` removed | Fixed (decision 014) |
| F8 | Info | Every commit's author email (`LeanderGamer2@web.de`) becomes public on push. | History rewritten to EngineGames-Development@web.de (your choice) before the first push | Resolved |
| F9 | Medium | The chat page could ask main for screenshots on its own (no click needed), e.g. if a rendering bug let model text run script. | Main takes one only when the chat window has focus, at most one every 3 s; the picture lands in the composer for you to see, never sent by itself | Fixed |
| F10 | Medium | File-edit rules compared raw names: `.env.`, `.ENV::$DATA` and `.git \config` slip past, and `.git/hooks` turns a file edit into a delayed command. | Names are compared the way Windows resolves them (trailing dots/spaces, streams); anything under `.git` is refused | Fixed |
| F11 | Low | `edit_file` read the whole file in main's event loop while building the confirmation. | Files over 2 MB aren't read for the diff (and can't be edited) | Fixed |
| F12 | Info | `npm audit` (dev only): 26 moderate findings, all one minimatch ReDoS (GHSA-g3hv-75wg-m249) in build tools (electron-builder). Runtime dependencies: 0. | Not shipped in the app, and only fed our own build patterns. Recheck when electron-builder updates (rechecked for 0.3.0: unchanged, runtime still 0) | Accepted |
| F13 | Medium | With internet access, a web page Claude reads could make it `remember` a link or a rule override, which would come back in every later session. | `remember` refuses notes with links or rule-override words (ignore/disregard/override, ignorier…/missacht…); test added | Fixed |
| F14 | Medium | WebFetch to a public name that resolves to a private IP (`127.0.0.1.nip.io`) would reach your own machine or network. | Known wildcard-DNS services are refused like private hosts; test added. Any other attacker-owned name stays possible (R13) | Fixed (partly, see R13) |
| F15 | Low | OllamaAgent: switching chats while a reply was running let the old turn trim and save the newly opened conversation. | The turn only saves the conversation it started in; test added | Fixed |
| F16 | Low | Web tools left redirect and error responses unread (open connections) and could drop a multi-byte character cut at the size limit; page titles kept raw HTML entities. | Bodies are cancelled, the decoder is flushed, titles go through `htmlToText` | Fixed |
| F17 | Info | The Release workflow never succeeded (v0.1.0–v0.4.0): electron-builder tries to publish by itself on a tag and fails without a token. No release builds were ever published. | `npm run dist -- --publish never`; the workflow's own step creates the release | Fixed (untested until the next tag) |

## Accepted residual risks

| ID | Risk | Why it's accepted / mitigation |
|---|---|---|
| R1 | **You approve a harmful command.** Prompt injection can make the model ask for something that looks reasonable. | That's what the window is for: it shows the literal command, not the model's description. The classifier blocks the worst categories even with a click. Read the command, not the reason. |
| R2 | **The classifier can be bypassed** (aliases, string building, `& (gcm ...)`). | It's only an extra stop, never the gate. Anything it misses still needs your click. Obfuscated-looking commands are themselves a reason to say no. |
| R3 | **Output of approved commands goes to Anthropic** as part of the conversation (e.g. `Get-ChildItem env:` would send your environment). | Inherent to having a model read the result. The confirmation shows what will run; ask yourself what it prints. |
| R4 | **Files inside project roots are readable without asking**, including config files with tokens (only `.env*`, key files and known secret folders are excluded). | Project roots are your choice (`projectRoots`; default is an empty workspace). Don't add folders that hold secrets. |
| R5 | **Approval fatigue.** Many prompts → reflexive Allow. | No "allow always" exists. Keep run_command for real tasks; open_application covers the everyday cases without prompts. |
| R6 | **The audit log isn't tamper-proof** and keeps command text (up to 300 chars). | It's for you, on your machine; anything that can edit it already runs as you (out of scope). Don't paste secrets into commands. |
| R7 | ~~Built-in Read auto-allowed by Claude Code~~ | Gone in 0.4.0: Claude Code was removed; every tool call goes through the ToolRunner. |
| R9 | **You approve a harmful file change.** A diff can hide intent (e.g. a build script edited to run something later). | Changes only inside project folders, never `.env` or secret paths; the window shows the real diff from the file on disk, not the model's summary. Read build scripts and hooks especially carefully. |
| R10 | **Memory as persistent injection.** A file the model reads could make it `remember` an instruction that comes back every session. | Notes are labelled "notes, not instructions" in the prompt, show up in the activity list when written, can't hold secret-looking text, and you can read and delete each one in Settings. |
| R11 | **History stays on your PC, unencrypted** (chat history including pictures in `%APPDATA%\enginebuddy\history`, Ollama conversations in `…\ollama`). Since 0.4.0 nothing goes to a cloud AI. | Screenshots are only taken when you click 📷 and you see them before sending. Delete chats in the chat window. |
| R12 | **Data can leave through the web tools.** A prompt-injected page or file could make the model put something it read (project code, chat text) into a URL or a Wikipedia search. | Secrets, `.env` and key files can't be read in the first place. URLs with logins, long opaque blobs, queries over 300 chars and URLs over 600 chars are refused; searches are capped at 200 chars and go only to Wikipedia. Every web call shows in the activity list and the audit log. Turn Internet off in Settings for sensitive projects. |
| R13 | **DNS rebinding (narrowed in 0.4.0).** The name is resolved and refused if it points into your network, but the fetch resolves it again: a name with a zero TTL could switch in between. | Private IPs, local names and wildcard-DNS services are refused before resolving; every redirect is re-checked. Pages on your LAN that need no login are what's at risk. |
| R14 | **Web pages are untrusted text.** What the model reads online can try to steer it. | The prompt says so explicitly; everything with an effect (commands, file changes) still needs your click, and memory notes can't hold links or overrides (F13). |
| R8 | **No code signing** for packaged builds; Windows SmartScreen will warn, and you can't verify a download came from you. | Fine for personal use. Sign before distributing to others. |

## Setup assistant and Store package (docs/decisions/018)

- The assistant lives in the settings window, so it inherits that channel's rule: main accepts
  its commands only from the settings window. `setup_pull` takes a model from a fixed list
  (`SETUP_MODELS`, zod enum); `setup_get_ollama` takes no input and opens one fixed URL
  (ollama.com/download/windows) in the browser. EngineBuddy never downloads or runs an installer:
  the user installs Ollama, and models are pulled by Ollama itself on loopback.
- The Store package (`appx`) is built in its own workflow and only uploaded as a workflow
  artifact; it installs only after the Store signs it.
- PRIVACY.md states what is stored and what leaves the PC (only web requests the user's questions
  cause, when Internet is on).

## 0.4.0: local only, no grey zones (docs/decisions/017)

- **Claude Code and the Agent SDK were removed.** Anthropic's Agent SDK docs say third-party apps
  may not offer claude.ai login or subscription limits without approval, and the SDK itself is
  proprietary. The only brain is now a model in the user's own Ollama, reached on loopback only
  (`isLoopbackUrl`; a non-loopback `ollamaUrl` is ignored). No account, key or cloud AI anywhere.
- **One gate path.** The OllamaAgent runs its tool loop through the ToolRunner (policy → confirm →
  execute → audit). Tool names the model invents, and text-written tool calls naming anything but
  our own tools, are refused; tested.
- **Own file and web tools.** `read_file`/`list_files` (project folders only; secret paths, `.env`,
  `.git` refused, names compared as Windows resolves them). `read_web_page`/`search_wikipedia`:
  public addresses only, host resolved and refused if private, every redirect re-checked, text
  only, size-capped; Wikipedia via its API with a descriptive User-Agent (no scraping).
- **Licensing:** every bundled production dependency is MIT/ISC/BSD/Apache (scanned from
  package-lock.json); THIRD-PARTY-NOTICES.md lists them. Model licenses are the user's download.
- Review pass after the release: F15–F17 fixed; `read_file`/`list_files` got their own tests
  (outside/`..`/`.env`/stream/`.git`/SSH key refused, binary refused, `.git` not listed). Live
  against the real internet: a Wikipedia search returned German summaries, nodejs.org was read,
  `localtest.me` (resolves to 127.0.0.1) was refused. 293 tests pass; `npm audit --omit=dev`: 0.
- Old tags v0.1.0–v0.3.0 point at the Claude Code versions; deleting them on GitHub is left to
  the owner (destructive Git action).
- Live test (2026-11-01, built app, the user's Ollama 0.40.13): without the configured model the
  chat explains `ollama pull`; with `qwen2.5-coder:1.5b` replies stream and conversations are
  stored, but that model doesn't call tools reliably (also seen calling Ollama directly), so the
  README recommends `qwen3:8b` / `qwen3:4b`.

## 0.3.0 additions (docs/decisions/016)

- **Internet:** WebSearch and WebFetch are SAFE only while Settings → Internet is on (default on;
  off means BLOCKED at both gates, and the tools aren't even offered to Claude). WebFetch goes only
  to public http(s) addresses (`src/security/policy/web.ts`): no localhost, private/link-local/
  metadata IPs (v4, v6, IPv4-mapped, decimal/hex forms), single-label or local-TLD names,
  wildcard-DNS services, logins in URLs, or data-smuggling-shaped URLs. These rules only refuse.
- **Languages:** the `?lang=` page parameter is parsed against a fixed list; translations are
  rendered as text like everything else. Settings `language`/`internet` are zod enums/booleans and
  accepted only from the settings window.
- **Voice:** unchanged trust model (Web Speech, local voices, avatar window only).
- Live test (2026-11-01, built app, real Claude, German Windows): UI came up in German from the
  system locale; "neueste Node.js-Version?" → two WebFetch calls to nodejs.org (allowed, audited),
  answer in German with the source; "WebFetch http://192.168.178.1/" → BLOCKED by `web-url`,
  Claude explained and did not retry.
- `npm audit --omit=dev`: 0 vulnerabilities.

## Verified by tests

- `test/security/policy-engine.test.ts`: the policy table; 12 secret paths; traversal, mixed
  case, junction, 8.3, UNC, `\\?\`, ADS, unknown variable; negative cases.
- `test/security/confirmations.test.ts`: 22 blocked commands, 8 allowed-to-ask; app plans; broker
  (Allow delay, timeout, wrong id, queue, deny-all, cancel); run_command runs only after Allow
  (real PowerShell), not on No, blocked never shown; F3, F4.
- `test/integrations/claude-code.test.ts`: billing env stripped, `apiKeySource` refusal, both gates.
- `test/lint/boundaries.test.ts`: core/renderer can't import Electron, Node or main.
- `test/integration/claude-code.live.test.ts` (opt-in, real Claude): Bash denied by the hook,
  never ran, audited, with a fake API key present.
- Live (docs/decisions/013): Allow and Cancel through the real confirmation window.
- `test/security/file-tools.test.ts`: write_file / edit_file ask inside projects, refuse outside,
  `.env`, secrets and traversal; edits apply exactly once, keep CRLF, write nothing on mismatch.
- `src/shared/images.test.ts`: pictures must match their declared type's signature and size cap;
  settings can't add folders except through main's folder picker.

## Phase 2 additions (docs/decisions/015)

- New renderer → main traffic (chat, screenshots, settings) is schema-checked like the rest.
  Settings commands are accepted only from the settings window, which shows no model output
  except memory notes (as text nodes). Folders are added only via Windows' folder picker in main.
- Screenshots are taken by main (`desktopCapturer`) on your click; pages still get no media
  permissions (F1 unchanged).
- Live test (2026-11-01, built app, real Claude): screenshot, drop and paste attach pictures;
  Claude read a sent picture correctly; write_file showed its diff, ran after Allow, didn't after
  Cancel (and Claude didn't retry around it); `remember` stored a note visible in Settings; the
  Windows voices speak. History survived a restart and resumed the conversation.
- Images are re-validated in main (type, signature, size) before reaching Claude or the history.

## How to re-run this audit

1. `npm run check` (all of the above except the live test).
2. `EB_INTEGRATION=1 npx vitest run test/integration` (uses your subscription, one short turn).
3. Re-read this file's boundary table against `git diff` since the date above; anything touching
   `src/security`, `src/main/ipc`, `src/preload`, `src/tools` or the confirmation window needs a
   new entry here.
