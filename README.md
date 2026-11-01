# EngineBuddy

A small animated character that lives on your Windows desktop, talks like a friend, and uses
**Claude Code on your own claude.ai subscription** to actually help: answer questions, check how
your PC is doing, open programs and folders, and run commands, but only after you click **Allow**.

![EngineBuddy doing a system check](docs/images/bubble/live-system-check.png)

- Click it to ask something. Right-click for the menu (System check, Open in VS Code…, Pause).
- It reacts to what it's doing: thinking, talking, working, happy, confused.
- It never runs anything risky without you: every command is shown to you word for word in a
  separate confirmation window first. Some things (formatting disks, switching off Defender,
  reading your passwords) are refused even if you click Allow.
- It never bills per request: it only runs on your claude.ai login, never on an API key.

**Status:** 0.4.0. Windows only for now. See [ROADMAP.md](ROADMAP.md).

## Requirements

- **Windows 10 or 11** (64-bit).
- **A brain**, one of these (Settings → Brain):
  - **Ollama, free and offline:** install [Ollama](https://ollama.com), then run
    `ollama pull qwen3:8b` once in a terminal (about 5 GB). Runs on your PC, no account, nothing
    leaves the machine. Simpler answers than Claude, no web search; needs a reasonably recent PC
    (16 GB RAM, ideally a graphics card).
  - **Claude, with your claude.ai subscription (Pro or Max):** install
    [Claude Code](https://docs.claude.com/en/docs/claude-code/setup), run `claude` once and log in.
    Best answers, web search.

  With neither, EngineBuddy still starts and runs on a practice script.

## Install

Download from the [Releases](../../releases) page:

| File | What |
|---|---|
| `EngineBuddy-Setup-<version>.exe` | Installer (Start menu + desktop shortcut, uninstall from Windows settings) |
| `EngineBuddy-<version>-portable.exe` | No install: just run it |

The builds aren't code-signed, so Windows SmartScreen will say "Windows protected your PC". Click
**More info → Run anyway**, or build it yourself (below) if you'd rather not trust a download.

## Run from source

Needs [Node.js](https://nodejs.org) 22.18 or newer.

```bash
git clone <this repository>
cd EngineBuddy
npm install
npm run dev
```

If it complains that Electron failed to install, fetch its binary once:

```bash
node node_modules/electron/install.js
```

Build your own installer and portable exe (written to `release/`):

```bash
npm run dist
```

## Using it

| Do | How |
|---|---|
| Ask something | Click the avatar, type, Enter. Esc closes the bubble |
| Stop an answer | The ■ button in the bubble |
| Move it | Drag it. Drop it near a corner and it snaps there |
| Resize it | Ctrl + mouse wheel over it |
| Chat window | Right-click → Open chat, the ⤢ in the bubble, or the tray. Keeps your conversations |
| Send a picture | In the chat: Ctrl+V, drag it in, or 📷 for a screenshot (the window hides for a moment) |
| Settings | Right-click → Settings…: project folders, voice, model, memory |
| Menu | Right-click: Ask, Open chat, System check, Open in VS Code…, Settings…, Pause/Resume, Exit |
| Hide / pause / quit | The tray icon (left-click shows/hides it) |

Things to try: "how's my PC doing?", "open a terminal in D:\code\myproject", "what's taking up space
in my Downloads folder?" (asks before running anything).

## What it can do

- **Chat with history:** every conversation is saved; reopen an old one and Claude continues it.
- **Pictures:** paste, drop or screenshot; Claude looks at them.
- **Change files:** in your project folders, after you saw the diff and clicked Allow.
- **Memory:** ask it to remember something; it keeps short notes across restarts (see and delete
  them in Settings).
- **Internet:** searches the web and reads public pages for current answers, and says where the
  answer came from (Settings → Internet; never your own network).
- **Your language:** menus and windows in English, Deutsch, Français or Español, following Windows
  by default; Claude answers in the language you write in.
- **Voice:** reads replies aloud, picking the best installed voice for the reply's language
  (natural voices first); speed and pitch in Settings → Voice.
- Plus system checks, opening programs, and commands (with your OK).

## Settings

Most settings are in the Settings window. They live in `%APPDATA%\enginebuddy\settings.json`. Created on first run; edit it while EngineBuddy is closed.

| Setting | Default | What |
|---|---|---|
| `projectRoots` | `[]` | Folders it may read without asking, e.g. `["D:\\code\\myproject"]`. The first is where it works and runs commands. With none, it uses an empty folder of its own |
| `agent` | `"claude-code"` | `"ollama"` = free local model, `"mock"` = practice script |
| `ollamaModel` | `qwen3:8b` | Any Ollama model that supports tools, e.g. `llama3.1:8b` |
| `claudeExecutable` | auto | Path to `claude.exe` if it isn't found automatically |
| `claudeModel` | Claude Code's default | e.g. `"sonnet"` |
| `bubbleDismissSeconds` | `12` | How long a reply stays up |
| `voice` | off | `{ "enabled": true, "voice": "", "rate": 1, "pitch": 1 }` (`""` = automatic) |
| `internet` | `true` | Web search and reading public pages |
| `language` | `"system"` | `"system"`, `"en"`, `"de"`, `"fr"` or `"es"` |
| `scale`, `positions` | | Remembered size and position |

Every tool request, allowed or refused, is logged in `%APPDATA%\enginebuddy\logs\` (kept 30 days).

## Safety

EngineBuddy is a language model with hands on your PC, so it's built on the assumption that the
model can be wrong or tricked (by a file it reads, say). In short:

- **Safe things run directly:** system info, opening a fixed list of programs (Explorer, Terminal,
  VS Code, Notepad, Task Manager, Calculator), reading files in your project folders, searching the
  web and reading public pages (never addresses in your own network).
- **File changes need your click** in the same window, which shows the exact diff.
- **Commands need your click** in a separate window that shows the exact command, the folder, and
  EngineBuddy's reason (labelled as such). Cancel is the default; Enter never means yes; no answer
  in 2 minutes means no.
- **Some things are always refused:** passwords, browser data, SSH keys, `.env` files, wiping
  disks, switching off security, hidden or self-starting commands.

See also the [roadmap](ROADMAP.md).

Details: [SECURITY.md](SECURITY.md) (the permission model) and
[docs/security-audit.md](docs/security-audit.md) (what was checked, what was fixed, what risks remain).

## For developers

| Command | What |
|---|---|
| `npm run dev` | Run with hot reload |
| `npm run check` | Typecheck + lint + format check + tests (run before every commit) |
| `npm test` | Unit tests only, no Claude usage |
| `EB_INTEGRATION=1 npx vitest run test/integration` | Live test against real Claude (uses your subscription) |
| `npm run dist` | Windows installer + portable exe in `release/` |

- [ARCHITECTURE.md](ARCHITECTURE.md): how it's built and why
- [docs/decisions/](docs/decisions/): one record per step (what was built, why, how it was verified)
- [CLAUDE.md](CLAUDE.md): the rules for working on this code with Claude Code

## Privacy

- **Stays on your PC:** settings, memory notes, chat history (including pictures), the audit log,
  all in `%APPDATA%\enginebuddy`. Nothing is sent to the EngineBuddy developers; there's no
  telemetry. Delete chats in the chat window, notes in Settings, or the whole folder.
- **Ollama mode:** nothing leaves your PC (Ollama runs locally; EngineBuddy only talks to it on
  127.0.0.1).
- **Claude mode:** your messages, the pictures you send, file contents Claude reads and tool
  results go to Anthropic under your claude.ai account and Anthropic's
  [privacy policy](https://www.anthropic.com/legal/privacy). With Internet on, web searches and
  fetched pages go through Anthropic and the sites visited.
- Screenshots are only taken when you click 📷, and you see them before sending. Only send
  pictures of other people or of others' content if you're allowed to.

## License

EngineBuddy's own code: [MIT](LICENSE) © 2026 EngineGames-Development.

Third-party parts keep their own licenses, see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
In particular the Claude Agent SDK is not MIT: it's © Anthropic PBC and its use is governed by
Anthropic's terms. EngineBuddy is an independent project, not made or endorsed by Anthropic;
"Claude" is a trademark of Anthropic and is used here only to say which service the app talks to.
