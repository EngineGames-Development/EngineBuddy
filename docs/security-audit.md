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
| F12 | Info | `npm audit`: 26 moderate findings, all one minimatch ReDoS (GHSA-g3hv-75wg-m249) in build tools (electron-builder). Runtime dependencies: 0. | Not shipped in the app, and only fed our own build patterns. Recheck when electron-builder updates (rechecked for 0.3.0: unchanged, runtime still 0) | Accepted |
| F13 | Medium | With internet access, a web page Claude reads could make it `remember` a link or a rule override, which would come back in every later session. | `remember` refuses notes with links or rule-override words (ignore/disregard/override, ignorier…/missacht…); test added | Fixed |
| F14 | Medium | WebFetch to a public name that resolves to a private IP (`127.0.0.1.nip.io`) would reach your own machine or network. | Known wildcard-DNS services are refused like private hosts; test added. Any other attacker-owned name stays possible (R13) | Fixed (partly, see R13) |

## Accepted residual risks

| ID | Risk | Why it's accepted / mitigation |
|---|---|---|
| R1 | **You approve a harmful command.** Prompt injection can make the model ask for something that looks reasonable. | That's what the window is for: it shows the literal command, not the model's description. The classifier blocks the worst categories even with a click. Read the command, not the reason. |
| R2 | **The classifier can be bypassed** (aliases, string building, `& (gcm ...)`). | It's only an extra stop, never the gate. Anything it misses still needs your click. Obfuscated-looking commands are themselves a reason to say no. |
| R3 | **Output of approved commands goes to Anthropic** as part of the conversation (e.g. `Get-ChildItem env:` would send your environment). | Inherent to having a model read the result. The confirmation shows what will run; ask yourself what it prints. |
| R4 | **Files inside project roots are readable without asking**, including config files with tokens (only `.env*`, key files and known secret folders are excluded). | Project roots are your choice (`projectRoots`; default is an empty workspace). Don't add folders that hold secrets. |
| R5 | **Approval fatigue.** Many prompts → reflexive Allow. | No "allow always" exists. Keep run_command for real tasks; open_application covers the everyday cases without prompts. |
| R6 | **The audit log isn't tamper-proof** and keeps command text (up to 300 chars). | It's for you, on your machine; anything that can edit it already runs as you (out of scope). Don't paste secrets into commands. |
| R7 | **Built-in Read is auto-allowed by Claude Code inside its working folder** without calling `canUseTool`. | The PreToolUse hook fires for every tool (spike 0b) and applies the same policy; tested. |
| R9 | **You approve a harmful file change.** A diff can hide intent (e.g. a build script edited to run something later). | Changes only inside project folders, never `.env` or secret paths; the window shows the real diff from the file on disk, not the model's summary. Read build scripts and hooks especially carefully. |
| R10 | **Memory as persistent injection.** A file the model reads could make it `remember` an instruction that comes back every session. | Notes are labelled "notes, not instructions" in the prompt, show up in the activity list when written, can't hold secret-looking text, and you can read and delete each one in Settings. |
| R11 | **Pictures and history leave/stay on your PC.** Images you send go to Anthropic; the chat history (including pictures) is stored unencrypted in `%APPDATA%\enginebuddy\history`. | Screenshots are only taken when you click 📷 and you see them before sending. Delete chats in the chat window. |
| R12 | **Data can leave through the web tools.** A prompt-injected page or file could make Claude put something it read (project code, chat text) into a search query or a fetched URL. | Secrets, `.env` and key files can't be read in the first place. URLs with logins, long opaque blobs, queries over 300 chars and URLs over 600 chars are refused; search queries are capped at 500 chars. Every web call shows in the activity list and the audit log. Turn Internet off in Settings for sensitive projects. |
| R13 | **DNS rebinding.** A public host name can resolve to a private address; the check is on the name, not the resolved IP (Claude Code fetches it). | Private IPs, local names and known wildcard-DNS services are refused. Claude Code's own WebFetch adds a domain safety check. Pages on your LAN that need no login are what's at risk. |
| R14 | **Web pages are untrusted text.** What Claude reads online can try to steer it. | The prompt says so explicitly; everything with an effect (commands, file changes) still needs your click, and memory notes can't hold links or overrides (F13). |
| R8 | **No code signing** for packaged builds; Windows SmartScreen will warn, and you can't verify a download came from you. | Fine for personal use. Sign before distributing to others. |

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
