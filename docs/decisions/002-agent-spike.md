# 002 — Agent spike results (Phase 1, step 0b)

Date: 2026-10-31 · Code: `spikes/agent/spike.mjs` · Raw SDK transcripts: `spikes/agent/fixtures/*.json`
Setup: Agent SDK 0.3.316, Claude Code 2.1.316 (`~/.local/bin/claude.exe`), model `claude-opus-5-5`,
`apiKeySource: none` on every run (subscription only).

## Results

| Check | Result | Notes |
|---|---|---|
| Streaming deltas (`includePartialMessages`) | ✅ | `stream_event` → `content_block_delta` / `text_delta` |
| In-process MCP tool is called | ✅ *after a fix* | See finding 1 |
| `canUseTool` fires for every tool | ❌ **No** | Not called for Read in `cwd`. See finding 2 |
| `PreToolUse` hook fires for every tool | ✅ | Saw Read, Bash, ToolSearch, MCP tools |
| Bash denied by both gates | ✅ | Marker file was never created |
| Bash denied by `canUseTool` alone | ✅ | |
| Bash denied by hook alone | ✅ | |
| `resume` keeps context | ✅ | Codeword recalled across processes |
| `abortController.abort()` stops quickly | ❌ | Kept streaming for 7.4 s (147 more deltas) |
| `query.interrupt()` stops quickly | ✅ | Acknowledged in 15 ms; 0 further deltas; the turn ends ~2 s later with `result: error_during_execution` |

## Findings that change the design

1. **MCP tools are deferred behind ToolSearch by default.** On the first run the model had to
   call `ToolSearch` before it could see `get_system_info`. Our default-deny policy blocked
   ToolSearch, so the tool was unreachable.
   → Use `createSdkMcpServer({ …, alwaysLoad: true })` so our tools are always in the prompt.

2. **`canUseTool` is not a universal gate.** Claude Code auto-allows read-only tools inside `cwd`
   without asking the callback. The `PreToolUse` hook fired for every tool.
   → The **`PreToolUse` hook is the primary gate**. `canUseTool` stays as the second gate, and later
   as the hook point for CONFIRM prompts. SECURITY.md §3 is updated.

3. **Your claude.ai connectors leak in.** Even with `settingSources: []`, account-level MCP connectors
   (Claude Docs) were loaded, adding tools and startup time.
   → Always pass `strictMcpConfig: true`.

4. **Restrict built-ins explicitly.** `tools: ['Read', 'Glob', 'Grep']` (Phase 1). This keeps the
   tool list, and the prompt, small. Bash is only listed in the spike, to test denial.

5. **Cancel = `interrupt()`, not abort.** Abort is only for teardown. The UI should also stop
   rendering immediately on cancel, without waiting for the SDK. Map `error_during_execution` after an
   interrupt to `turn_end { outcome: 'cancelled' }`.

## Latency & usage

| Run | Process start → `init` | → first text | Total |
|---|---|---|---|
| First ever (connectors loaded, ToolSearch round trip) | — | 51.3 s | 54.7 s |
| After fixes 1+3, cold process | 13.9 s | 18.7 s | 21.6 s |

- The cold start (~14 s to `init`) is too slow for a desktop buddy. → Phase 1 step 8 keeps **one
  warm session** (SDK streaming-input mode, a long-lived `query` fed by an async iterable of user
  messages) instead of a new `query()` per turn. It's started during the greeting. This still
  needs measuring in step 8; if warm turns aren't fast, we revisit.
- `total_cost_usd` reported ~$0.05 per small turn after the fixes. On a subscription, that's an
  API-price *estimate* of usage, not a charge. Context is ~33k tokens per turn, mostly Claude Code's
  own system prompt. A smaller model for chit-chat (`model: 'sonnet'` / `'haiku'`) is a later knob.

## Not yet verified

- Warm-session turn latency (step 8).
- Behaviour when the subscription is logged out or rate-limited (needs an `agent_error` mapping).
