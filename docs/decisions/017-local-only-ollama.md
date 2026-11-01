# 017: Local only: Ollama instead of Claude Code (0.4.0)

## What changed

- **Removed:** the Claude Code brain (`src/integrations/claude-code`), the Claude Agent SDK
  dependency, its tests and fixtures, the claude settings (`claudeModel`, `claudeExecutable`).
  Old settings files with `"agent": "claude-code"` now start the Ollama brain.
- **Added:** `OllamaAgent` (`src/integrations/ollama`): streams `/api/chat` on loopback only, runs
  the tool loop through the ToolRunner, keeps each chat's conversation in `userData/ollama`, sends
  pictures only in their own turn, understands tool calls that small models write as text (only
  for our own tool names), and explains a missing Ollama or model in the UI language.
- **Added tools:** `read_file`, `list_files` (replacing Claude Code's Read/Glob) and
  `read_web_page`, `search_wikipedia` (replacing WebFetch/WebSearch). See SECURITY.md §10–11.
- **Prompt:** lists the new tools; tells the model it has no general web search and must not guess
  addresses.
- **Docs:** CLAUDE.md hard rule is now "free, local, fully licensed: no grey zones";
  THIRD-PARTY-NOTICES.md; README requirements, privacy and license sections; ROADMAP status.

## Why

The user asked for no legal grey zones. Anthropic's Agent SDK documentation says third-party
developers may not offer claude.ai login or rate limits in their products without prior approval
and should use API keys instead; the project rules forbid API keys and per-request billing. The SDK
is also proprietary ("All rights reserved"), unlike the rest of the app. Removing it was the only
option that is clean for everyone who downloads EngineBuddy. Ollama is MIT, runs locally, needs no
account; models are downloaded by the user under their own (mostly Apache 2.0) licenses.

Web search without a search engine: scraping search engines breaks their terms, and search APIs
need keys or accounts. Wikipedia's API is free, documented for this use, and its content is
CC BY-SA (we name the source). Other pages are read only when the model knows or is given the
address, like a browser.

## Verified

- `npm run check`: 280 tests pass (new: OllamaAgent with a fake server incl. tool loop, default
  deny, text tool calls, restart/resume, loopback-only; web tools incl. DNS rebinding and redirect
  re-checks; read tools; command env; settings upgrade from 0.3).
- License scan of package-lock.json: no production dependency outside MIT/ISC/BSD/Apache.
- Live, built app, the user's Ollama 0.40.13: UI in German; missing model explained; with
  `qwen2.5-coder:1.5b` replies stream and are stored. That 1.5 B model doesn't call tools reliably
  (it also invents tool names when asked directly through Ollama), so the recommended model is
  `qwen3:8b`. A live tool-calling test with `qwen3:8b` is still open (needs a ~5 GB download).
