# EngineBuddy — Architecture

Status: **proposal, pre-implementation** (2026-10-31). Nothing here is built yet.
Decisions marked **[verify in spike]** are assumptions that Phase 1 step 0 must confirm
before code depends on them.

---

## 1. Starting point

What I inspected before designing:

| Item | Finding | Consequence |
|---|---|---|
| Repository | Empty (new project, no existing code) | Free choice of stack and layout |
| OS | Windows 11 Home (build 26300) | Primary target; Win32 behaviour drives window design |
| Node | v22.23 / npm 10.9 (no pnpm) | npm as package manager |
| Rust | 1.96 (cargo available) | Tauri is a real option, not hypothetical |
| Python | 3.15 | Qt option is real too |
| .NET | 10.0 | Native WinUI/WPF is real too |
| Claude Code | 2.1.316, installed at `~/.local/bin/claude.exe` (**not on PATH** — the PATH entry is malformed) | Integration must accept an explicit executable path |
| Claude Agent SDK | `@anthropic-ai/claude-agent-sdk` 0.3.316 (TypeScript). Exposes `query()`, `canUseTool`, `createSdkMcpServer`, `PreToolUse` hooks, `settingSources`, `includePartialMessages`, `resume`, `pathToClaudeCodeExecutable` | This is the integration point (§6) |
| VS Code | 1.144, `code` on PATH | "Open in VS Code" is a trivial safe tool |
| Ollama | installed | Candidate backend for `LocalAgent` later |

---

## 2. Framework evaluation

The hard requirements, in the priority order you gave:

1. Transparent, frameless, always-on-top window **where the empty pixels pass clicks through to the desktop** and the character itself stays clickable.
2. Performance (it runs all day).
3. Smooth animation.
4. System integration (tray, autostart, processes, shell, filesystem).
5. Maintainability.
6. Cross-platform potential.

Requirement 1 is the one that eliminates options, so it's the main axis.

### Per-pixel click-through is the deciding feature

A character "sitting on the desktop" means the window is a rectangle, but only the
character's pixels should be interactive. On Windows, the usual way is: make the whole
window ignore the mouse (`WS_EX_TRANSPARENT`), keep receiving mouse-*move* events, and turn
interaction back on when the cursor is over an opaque pixel.

| Framework | Transparent + frameless | Click-through with hover forwarding | Agent SDK access | Memory (idle, rough) | Verdict |
|---|---|---|---|---|---|
| **Electron** | Yes | **Yes**: `setIgnoreMouseEvents(true, { forward: true })` is documented and works on Windows | **Native**: the SDK is TypeScript and runs in the main process | ~120–200 MB | **Chosen** |
| Tauri 2 | Yes (WebView2) | Partial: `setIgnoreCursorEvents(bool)` has no *forward* mode, so you'd need your own Win32 cursor-polling loop in Rust to toggle it | Needs a Node sidecar process for the SDK (or reimplement against the raw CLI stream) | ~40–80 MB + sidecar | Strong runner-up |
| Python + Qt (PySide6) | Yes (`WA_TranslucentBackground`) | Yes (`WindowTransparentForInput` + masks), but fiddly | Python Agent SDK exists | ~80–150 MB | Viable, weaker UI/animation story for chat + Markdown |
| Native (WinUI 3 / WPF) | WPF yes; WinUI 3 transparency is awkward | Yes (full Win32 control) | No SDK; you'd drive the CLI's JSON stream yourself | Lowest | Best feel, but no cross-platform and most custom work |

### Why Electron, despite its memory cost

- **The brain is TypeScript.** The Claude Agent SDK, the MCP tool server helpers and the
  permission callback are all TS. In Electron they run in the same process as the window
  manager, with no sidecar and no IPC bridge between languages. With Tauri, every agent
  event would cross Rust↔Node↔WebView, which adds a failure mode we'd have to debug for good.
- **Click-through forwarding is built in**, not something we write in Rust.
- **One language** across UI, agent and tools is the main maintainability win for a one-person project.
- **Cross-platform**: macOS/Linux builds later, with the same transparency API (behaviour differs; see §11).

Costs we accept, and how we limit them:

| Cost | Mitigation |
|---|---|
| ~150 MB RAM baseline | One always-on renderer (avatar). The chat and settings windows are created when first opened and destroyed when closed. The avatar window has no framework-heavy code: just SVG and a small animation loop. |
| GPU/CPU from a 60 fps loop | The animation loop drops to ~10 fps (or stops) when idle and the bubble is closed; sleep mode stops it entirely. |
| Electron's security footguns | Strict config (§9): `contextIsolation`, `sandbox`, no `nodeIntegration`, a typed preload API, CSP. |

**Fallback plan:** if the Phase 1 spike shows that transparency, click-through or DPI handling
fails on your machine, the core (`src/core`, `src/tools`, `src/security`) is
framework-free TypeScript by design, so only `src/main` + `src/renderer` would need porting to Tauri + a Node sidecar.

---

## 3. System overview

```
┌──────────────────────────── Electron main process ─────────────────────────────┐
│                                                                                │
│  AppShell ── windows, tray, autostart, settings, single-instance lock          │
│     │                                                                          │
│     ▼                                                                          │
│  EventBus  ◄──────────────────────────────────────────────────────┐            │
│     ▲   │ (typed BuddyEvents, fan-out to renderers over IPC)       │            │
│     │   ▼                                                          │            │
│  AgentController ── conversation state, turn queue, cancellation   │            │
│     │                                                              │            │
│     ▼                                                              │            │
│  AgentProvider (interface)                                         │            │
│     ├── ClaudeCodeAgent  ──► Agent SDK ──► claude.exe (child proc) │            │
│     ├── ClaudeApiAgent   (later)                                   │            │
│     ├── LocalAgent       (later: Ollama)                           │            │
│     └── MockAgent        (dev/tests, no tokens)                    │            │
│              │ tool calls                                          │            │
│              ▼                                                     │            │
│  PolicyEngine ── SAFE / CONFIRM / BLOCKED ── ConfirmationBroker ───┤            │
│              │ allowed                                             │            │
│              ▼                                                     │            │
│  ToolRegistry ── filesystem, terminal, git, system, apps, projects ┘            │
│                                                                                │
│  MemoryStore · ProjectService · Watchers → NotificationGate  (later phases)    │
└────────────────────────────────────────────────────────────────────────────────┘
          │ IPC (typed, validated)                     ▲
          ▼                                            │
┌── Avatar window (always on) ──┐   ┌── Chat window (lazy) ──┐  ┌─ Confirm window ─┐
│ AvatarEngine (SVG + rAF)      │   │ React: history,        │  │ Shows exact tool │
│ ReactionMap: event → state    │   │ markdown, code, tools  │  │ input; Cancel is │
│ SpeechBubble, ActivityList    │   │                        │  │ default          │
└───────────────────────────────┘   └────────────────────────┘  └──────────────────┘
```

### Process boundaries (who is allowed to do what)

| Process | Can do | Cannot do |
|---|---|---|
| Main | Everything: spawn processes, filesystem, run tools, talk to Claude | — |
| Renderers | Draw, animate, collect user input, call the narrow preload API | Touch the filesystem, run tools, see API keys, approve their own confirmations |
| `claude.exe` (child of SDK) | Reason; **request** tools | Execute a tool that PolicyEngine didn't allow (§6.3) |

The renderer shows model-generated text, so we treat it as an untrusted surface. Anything privileged goes through main.

---

## 4. The event system (the backbone)

Requirement: *"Do not hardcode animations into the AI logic."* So the agent layer emits
**facts**, and every consumer (avatar, bubble, chat, voice, logging) decides on its own how to react.

### 4.1 Event types (`src/shared/events.ts`)

```ts
type BuddyEvent =
  // agent lifecycle
  | { type: 'turn_start';  turnId: string; source: 'bubble' | 'chat' | 'menu' | 'proactive' }
  | { type: 'thinking';    turnId: string }
  | { type: 'message_delta'; turnId: string; text: string }          // streaming tokens
  | { type: 'message';     turnId: string; text: string }            // final assistant text
  | { type: 'narration';   turnId: string; text: string }            // short "I'm checking..." line
  | { type: 'tool_start';  turnId: string; callId: string; tool: string; category: ToolCategory; description: string }
  | { type: 'tool_result'; turnId: string; callId: string; success: boolean; summary?: string }
  | { type: 'confirm_request'; turnId: string; callId: string; request: ConfirmationRequest }
  | { type: 'confirm_resolved'; callId: string; allowed: boolean }
  | { type: 'turn_end';    turnId: string; outcome: 'ok' | 'error' | 'cancelled' }
  | { type: 'agent_error'; turnId?: string; message: string; recoverable: boolean }
  // user / app
  | { type: 'user_input';  text: string; source: 'bubble' | 'chat' | 'voice' }
  | { type: 'mode_changed'; mode: DesktopMode }
  | { type: 'user_idle';   seconds: number }
  // later: observations from watchers
  | { type: 'observation'; kind: string; priority: Priority; data: unknown };
```

These match the JSON shapes in your spec (`thinking`, `tool_start`, `tool_result`, `message`), plus the extra events a real turn needs (turn boundaries, deltas, confirmations, cancellation).

### 4.2 EventBus

- Lives in main. Typed `emit`/`on` with no external dependency (about 40 lines).
- Every event is forwarded to the open renderers over one IPC channel (`buddy:event`).
- Every event is also appended to a ring buffer and, in Developer Mode, to a JSONL log file.
  This is how we debug "why did the avatar look confused?": you replay the events.

### 4.3 From events to avatar state (data, not code)

`src/renderer/avatar/reactions.ts` is a **table**, not logic spread across the agent:

```ts
const reactions: Reaction[] = [
  { on: 'thinking',                     state: 'THINKING', priority: 2 },
  { on: 'message_delta',                state: 'TALKING',  priority: 3 },
  { on: 'tool_start', where: { category: 'terminal' }, state: 'WORKING', priority: 3 },
  { on: 'tool_start', where: { category: 'filesystem' }, state: 'CODING', priority: 3 },
  { on: 'tool_result', where: { success: true },  state: 'HAPPY',    hold: 1500, priority: 4 },
  { on: 'tool_result', where: { success: false }, state: 'CONFUSED', hold: 2000, priority: 4 },
  { on: 'confirm_request',              state: 'WORRIED',  priority: 5 },
  { on: 'agent_error',                  state: 'ERROR',    hold: 2500, priority: 6 },
  { on: 'turn_end', where: { outcome: 'ok' }, state: 'IDLE', priority: 1 },
  // ...
];
```

The **AvatarStateMachine** (pure TS, unit-tested) resolves conflicts:

- **Priority**: a higher-priority state can interrupt a lower one.
- **Minimum hold time**: HAPPY stays on screen ≥1.5 s even if `turn_end` arrives 10 ms later,
  so reactions are actually visible instead of flickering.
- **Return state**: after a `hold` expires, fall back to whatever the turn's ongoing state is
  (TALKING if still streaming, otherwise IDLE).
- **Mode overrides**: Sleep Mode forces SLEEPING; Silent Mode keeps animations but suppresses
  bubbles that aren't direct replies.
- **Idle variety**: in IDLE, small random micro-animations (blink, look around, stretch)
  on a jittered timer, so it doesn't look frozen.

All 14 states from the spec exist in the enum from day 1. States without art yet fall back
to their nearest neighbour (e.g. EXCITED → HAPPY), so we never need a code change to add art.

---

## 5. Avatar rendering

### 5.1 Approach: procedural SVG rig, driven by poses

Options considered:

| Option | Pros | Cons |
|---|---|---|
| Sprite sheets (PNG frames) | Simple, pixel-art friendly | Every state × frame drawn by hand; scale changes blur it |
| Lottie / Rive | Designer tools, rich motion | Needs an animator; Rive's state machine would duplicate ours |
| **Procedural SVG rig** | Scales crisply; states are data (poses); blends between states for free; no art pipeline needed to start | Takes some tuning work to look "alive" |

**Chosen: procedural SVG rig**, with the renderer behind an `AvatarRenderer` interface so
a Rive or sprite renderer can replace it later without touching the state machine.

- The character is a set of named parts: `body`, `eyeL`, `eyeR`, `mouth`, `armL`, `armR`, `feet`, `glow`, plus effect layers (`sweat`, `sparkles`, `zzz`, `gear`).
- A **pose** is a set of target transforms and shape parameters per part (eye openness, mouth curve, body squash, tilt, glow intensity).
- A **state** is a base pose plus a **loop** (e.g. TALKING = mouth open/close at a speech rhythm; THINKING = eyes up-right, slow sway, "…" dots).
- Transitions tween between poses (~150–250 ms, eased) with a tiny squash-and-stretch on state change. That squash is most of what makes it feel alive.
- One `requestAnimationFrame` loop; no CSS animations fighting it.

### 5.2 Character concept (original)

An original design, inspired by the *feel* of the Claude Code mascot (small, blocky, friendly,
terminal-native) without copying its shape or artwork:

- A small rounded-square body with a slightly soft, chunky silhouette and a faint pixel-grid texture.
- Deep charcoal body with a purple inner glow (your accent colour) and a thin violet rim light.
- Two pill-shaped "screen" eyes (they can show `> _` in CODING, `x x` in ERROR, `^ ^` in HAPPY).
- Stubby arms that appear only when gesturing (typing in CODING, waving in the greeting).
- A soft shadow under it on the desktop so it reads as *sitting* rather than floating in a box.

Concept sketches come at the start of Phase 1 (rendered in the real SVG rig), and you pick
before we polish.

---

## 6. Agent layer and the Claude Code integration

### 6.1 The interface the rest of the app sees

```ts
interface AgentProvider {
  readonly id: 'claude-code' | 'claude-api' | 'local' | 'mock';
  startTurn(input: TurnInput, ctx: TurnContext): AsyncIterable<AgentEvent>;
  cancel(turnId: string): Promise<void>;
  dispose(): Promise<void>;
}
```

- `TurnInput`: user text, attachments, and a `source` (bubble, chat, menu intent).
- `TurnContext`: active project, mode (companion/developer/...), and relevant memory facts.
- Providers yield `AgentEvent`s (the agent subset of `BuddyEvent`). **AgentController** owns
  turn IDs, emits them on the bus, keeps history, and makes sure only one turn runs at a time
  (new input while busy is queued, or cancels the current turn, depending on the setting).

The UI never imports a provider. It only sees `BuddyEvent`s. That's the decoupling you asked for.

### 6.2 ClaudeCodeAgent

Built on `@anthropic-ai/claude-agent-sdk`'s `query()`:

| SDK feature | Use |
|---|---|
| `pathToClaudeCodeExecutable` | Point at `~/.local/bin/claude.exe` (configurable, auto-detected) |
| `includePartialMessages: true` | Token streaming → `message_delta` |
| `resume: sessionId` | Conversation continuity across turns |
| `systemPrompt: { type: 'preset', preset: 'claude_code', append: PERSONALITY }` | Keep Claude Code's tool competence, add EngineBuddy's voice |
| `createSdkMcpServer({ name: 'enginebuddy', tools, alwaysLoad: true })` | Our tools run **in-process** in main, as MCP tools. `alwaysLoad` is required: without it they're hidden behind ToolSearch (spike 0b, finding 1) |
| `hooks.PreToolUse` | **Primary gate**: every tool request passes through **our** PolicyEngine. It's the only callback that fires for *every* tool (spike 0b, finding 2) |
| `canUseTool` | Second gate; later also the CONFIRM prompt hook. **Not** called for read-only tools Claude Code auto-allows in `cwd` |
| `settingSources: []` + `strictMcpConfig: true` | Don't load your personal Claude settings or your claude.ai connectors (both leaked in otherwise; spike 0b, finding 3) |
| `tools: ['Read', 'Glob', 'Bash']` | Only the built-ins we gate; keeps the prompt small. Bash is listed so a request for it reaches our gates and is refused visibly and audited; Grep stays out until it can skip secret files (docs/decisions/009, 010) |
| `cwd` | The active project root |
| `query.interrupt()` | Cancel button / "stop": acknowledged in 15 ms. `abortController` only for teardown (it kept streaming for 7 s) |
| Streaming-input mode (one long-lived `query`) | One warm session, because a cold start takes ~14 s to `init` (spike 0b) |

SDK message → BuddyEvent translation lives in one file
(`src/integrations/claude-code/translate.ts`) with fixture-based unit tests. Recorded SDK
transcripts are replayed in tests, so no tokens are spent.

**Auth: subscription only, never pay-per-request (hard rule).** EngineBuddy runs your
installed Claude Code on your claude.ai subscription login. It must never use a billed path:

- The child process environment is stripped of `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`,
  `ANTHROPIC_BASE_URL` and the Bedrock/Vertex/Foundry switches, so a stray key on the machine is never picked up.
- On every session's `system:init` message, `apiKeySource` must be `'none'` (claude.ai login).
  Anything else aborts the turn before the first request and shows "I'm not logged in the free way, so I'm not going to run."
- There is no API-key field in Settings. `ClaudeApiAgent` is removed from the roadmap.
- The only other brain is `LocalAgent` (Ollama), which is free by construction.
- The SDK's `total_cost_usd` is an API-price *estimate*. It's shown only as "usage" in Developer Mode.

Verified in spike 0b: `apiKeySource: none`, and a fake `ANTHROPIC_API_KEY` in the environment was ignored.

### 6.3 Built-in Claude Code tools vs our tools

Claude Code ships its own tools (Bash, Read, Write, Edit, Glob, Grep, WebFetch, ...). Two options:

- (a) Disable them all and expose only our tools.
- (b) Keep some, but route them through our policy.

**Choice: (b), gated.** Claude Code's Read/Grep/Glob are excellent for "what's wrong with my
compiler?", so it would be wasteful to reimplement them. But they all pass through the `PreToolUse` hook → PolicyEngine:

| Tool | Policy (Phase 1) | Policy (later) |
|---|---|---|
| Read, Glob, Grep | SAFE inside registered project roots; BLOCKED for secret paths (SECURITY.md §4) | CONFIRM outside project roots |
| Bash, Write, Edit, NotebookEdit | **BLOCKED** (no confirmation UI yet) | CONFIRM, with the exact command or diff shown |
| WebFetch, WebSearch | BLOCKED | CONFIRM |
| `mcp__enginebuddy__*` | Per tool definition | Per tool definition |
| Anything unknown | **BLOCKED (default deny)** | BLOCKED |

### 6.4 Personality and narration

Two sources, so it feels alive even when the model is quiet:

1. **Model narration.** The appended system prompt asks for short friend-like lines before and
   after tool use ("Checking the compiler output…"), short replies in companion mode, and
   longer ones only in chat. The voice rules from your spec go in there ("Done." not
   "Command execution completed successfully.").
2. **Local narration fallback.** `src/core/personality/lines.ts` maps events to line pools
   (`tool_start:terminal` → "Running it…" / "Let's see…"). It's used only if the model didn't
   narrate within ~800 ms of a `tool_start`. Lines rotate without repeats.

The bubble shows narration plus the condensed reply. The full reply always lands in chat history.

---

## 7. Tool system

```ts
interface ToolDef<I, O> {
  name: string;                     // 'get_system_info'
  category: ToolCategory;           // 'system' | 'filesystem' | 'terminal' | 'git' | 'apps' | 'projects'
  description: string;              // for the model
  input: ZodSchema<I>;              // validated before policy and before execute
  permission: Permission | ((input: I, ctx: PolicyContext) => Permission);
  describe(input: I): ConfirmationRequest;   // human-readable, built from INPUT, not from model prose
  execute(input: I, signal: AbortSignal): Promise<ToolResult<O>>;
}
```

- `ToolRegistry` builds the in-process MCP server from these definitions.
- Tools **never** call `child_process` with a shell string built from model input. They use
  `execFile`/`spawn` with argument arrays. The only exception is the future `run_command`
  tool, which is CONFIRM and shows the exact command line.
- Every execution is logged (tool, input, decision, duration, outcome) to the audit log (SECURITY.md §6).

Phase 1 ships exactly one or two **SAFE** tools (see `docs/PHASE-1.md`).

---

## 8. Windows & UI shell

### 8.1 Avatar window

| Requirement | Implementation | Notes |
|---|---|---|
| Transparent, frameless | `transparent: true, frame: false, hasShadow: false, backgroundColor: '#00000000'` | |
| Above normal windows | `setAlwaysOnTop(true, 'floating')` | Not `'screen-saver'`: that covers fullscreen games and videos |
| Not in taskbar / Alt-Tab | `skipTaskbar: true`, tool-window style | |
| Click-through on empty pixels | `setIgnoreMouseEvents(true, { forward: true })`; the renderer hit-tests the SVG under the cursor and asks main to toggle | Verified at 100% DPI, one monitor (docs/decisions/001). 150% DPI and multi-monitor are still on the Step 3 checklist |
| Draggable | **Custom drag** (pointer delta → IPC → `setPosition`) | `-webkit-app-region: drag` would swallow click/right-click/double-click, which we need |
| Resizable | Transparent windows can't use native resize borders on Windows, so we use **scale** (settings slider + Ctrl+scroll on the avatar). The window resizes itself to fit avatar × scale plus bubble space | This is the honest version of "resizable" for a character |
| Snap to corners | On drag end, if within N px of a work-area corner, animate to it (`screen.getDisplayNearestPoint().workArea`) | Respects taskbar and multi-monitor |
| Remember position | Saved per display ID; clamped back on-screen if that monitor is gone | |
| Opacity | `win.setOpacity()` | |
| Bubble placement | The bubble lives in the same window, above the avatar; it flips below or sideways near screen edges. The window grows while the bubble is open | Avoids a second window chasing the first |

### 8.2 Other windows

- **Chat window**: normal frameless window with a custom dark title bar; React; created on first open.
- **Confirmation window**: small, modal-ish, always-on-top, owned by main. Separate from the
  avatar renderer, so content in the avatar window can never render or click its own "Allow" (SECURITY.md §5).
- **Context menu**: Phase 1 uses Electron's native `Menu.popup()` (reliable, works at screen
  edges, keyboard accessible). Phase 2 replaces it with a custom-styled popup window that
  matches the visual design. Native Windows menus will look out of place next to the avatar.
- **Tray**: `Tray` with a status dot, the menu from your spec, and a left-click toggle for show/hide.
- **Autostart**: `app.setLoginItemSettings({ openAtLogin })`, off by default and offered once.
- **Single instance**: `requestSingleInstanceLock`.

### 8.3 Renderer stack

- **electron-vite** (one build for main, preload and renderers; fast HMR).
- **React** for the chat, settings and confirm windows. The avatar window uses React only for
  the bubble shell; the AvatarEngine is framework-free TS on a single SVG.
- **Markdown**: `markdown-it` with HTML **disabled**, plus `shiki` for code highlighting
  (loaded lazily, chat only). The bubble supports a small subset (bold, inline code, lists).
- **State**: per-window stores (Zustand) fed only by `BuddyEvent`s, so a window can be
  rebuilt from the event ring buffer.

---

## 9. Electron security baseline

Summarised here, detailed in SECURITY.md:

- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webSecurity: true`.
- Preload exposes one typed object (`window.buddy`) with a handful of methods. No generic `invoke(channel)`.
- Main validates every IPC payload with zod and checks `event.senderFrame` against our windows.
- CSP: `default-src 'self'`; no remote content; `will-navigate` and `setWindowOpenHandler` deny everything (links open in the system browser after a URL check).
- Model output is rendered as text or sanitised Markdown. It's never inserted as raw HTML.

---

## 10. Source layout

Your proposed structure, adjusted to match Electron's process boundaries so the import rules can be enforced (by an ESLint boundaries rule):

```
enginebuddy/
├── ARCHITECTURE.md · ROADMAP.md · SECURITY.md
├── docs/
│   ├── PHASE-1.md
│   └── decisions/              ADR-style notes, one per non-obvious decision
├── src/
│   ├── shared/                 types crossing process lines: BuddyEvent, IPC contract, enums
│   ├── core/                   PURE TS. No electron, no node:child_process. Unit-tested.
│   │   ├── events/             EventBus, ring buffer
│   │   ├── agent/              AgentController, AgentProvider interface
│   │   ├── state/              AvatarStateMachine, mode state
│   │   ├── personality/        line pools, system-prompt fragments
│   │   ├── memory/             (Phase 3)
│   │   ├── projects/           (Phase 4) detection logic, pure
│   │   └── notifications/      (Phase 5) NotificationGate
│   ├── security/
│   │   ├── policy/             PolicyEngine, rules, path classifier
│   │   └── confirmations/      ConfirmationBroker (main side)
│   ├── tools/                  ToolDefs; may use node APIs, never electron
│   │   ├── system/  filesystem/  terminal/  git/  applications/  projects/
│   ├── integrations/
│   │   ├── claude-code/        ClaudeCodeAgent + SDK→event translator
│   │   ├── mock/               MockAgent (scripted turns for dev + tests)
│   │   ├── claude-api/         (later)
│   │   └── local/              (later)
│   ├── main/                   Electron main: windows, tray, ipc, settings, autostart
│   ├── preload/                window.buddy API
│   └── renderer/
│       ├── avatar/             AvatarEngine, rig, poses, reactions table
│       ├── speech/             SpeechBubble, ActivityList
│       ├── chat/               (Phase 2)
│       ├── confirm/            (Phase 2)
│       ├── settings/           (Phase 2)
│       └── shared/             theme tokens, markdown renderer
├── assets/avatar/
└── test/                       vitest unit tests + recorded SDK fixtures + Playwright smoke
```

**Import rules:** `renderer` → `shared` only. `core` → `shared` only. `tools`/`security` → `core`, `shared`. `main` → everything. `integrations` → `core`, `security`, `tools`, `shared`.

---

## 11. Known technical risks

| Risk | Impact | Mitigation |
|---|---|---|
| Transparent window + click-through forwarding behaves differently at mixed DPI / multi-monitor | Avatar unclickable or blocks clicks | Phase 1 spike tests 100%/150% and two monitors before anything else is built on it |
| `canUseTool` not called for auto-allowed tools (**confirmed**: Read in `cwd`) | Policy bypass | `PreToolUse` hook is the primary gate (fires for every tool, verified), `canUseTool` second; `settingSources: []`, `strictMcpConfig: true`, no `allowedTools`; an integration test asserts a Bash request is denied |
| SDK API churn (0.x version) | Breakage on upgrade | All SDK usage confined to `integrations/claude-code/`; pinned version; replayed-fixture tests |
| Claude Code turn latency (process spawn, ~1–3 s) | Feels sluggish | THINKING animation starts on `turn_start` immediately; keep one warm session with `resume` |
| Electron memory | 150 MB+ | Lazy windows, idle frame throttling; measured in Phase 1 and recorded |
| Fullscreen apps / games | Avatar over a game | Detect a fullscreen foreground window (later) → auto-hide; `'floating'` level already avoids most cases |
| macOS/Linux transparency differences | Cross-platform later | Not a Phase 1 goal; platform-specific bits isolated in `main/windows/` |

---

## 12. Open questions (need your input)

1. ~~Auth~~: decided. Subscription login only, never billed (§6.2, D8).
2. **Project roots:** which folders hold your projects (SecureOS, Engine's Compiler, EASM, ...)? Phase 1 only needs one for the "Read inside project roots" rule.
3. ~~Where this repo lives~~: decided. `Documents\EngineBuddy`, ready for GitHub (docs/decisions/014).

---

## 13. Decision log

| # | Decision | Why | Revisit if |
|---|---|---|---|
| D1 | Electron over Tauri | Native TS Agent SDK; built-in click-through forwarding | Memory becomes a real problem, or the spike fails |
| D2 | Claude Agent SDK, not raw CLI `--output-format stream-json` | Typed messages, in-process MCP tools, permission callback | SDK becomes unmaintained |
| D3 | Procedural SVG avatar | Crisp at any scale; states are data; no art pipeline yet | We hire/commission an animator → Rive renderer |
| D4 | Event table drives the avatar | Your "no hardcoded animations" requirement; testable | — |
| D5 | Default-deny tool policy, built-ins gated | User stays in control; prompt-injection backstop | — |
| D6 | Scale instead of free resize | Native resize doesn't work on transparent windows on Windows | — |
| D7 | Native context menu in Phase 1, custom in Phase 2 | De-risk the slice; polish later | — |
| D8 | Never pay per request: subscription login or local model only | Your requirement | Never |
