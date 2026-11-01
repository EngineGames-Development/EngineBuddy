# 007 — EventBus, AgentController, MockAgent (Phase 1, step 5)

Date: 2026-11-01

## What exists now

| File | Role |
|---|---|
| `src/core/events/event-bus.ts` | Typed emit/on, ring buffer of the last 500 events; a throwing listener can't block others |
| `src/core/agent/agent-provider.ts` | `AgentProvider`, `TurnInput` (with menu `intent`), `AgentEvent` |
| `src/core/agent/agent-controller.ts` | Turn IDs, one turn at a time, queue (max 3), cancel, pause |
| `src/integrations/mock/mock-agent.ts` | Scripted turns with realistic timing: question, system check, refused command |

Main wires bus → `broadcastEvent`, and `user_input` / `cancel_turn` commands → the controller.

## Decisions

1. **Providers yield events without `turnId` and without turn boundaries.** The controller stamps
   IDs and emits `turn_start` / `turn_end` itself, so no provider can forget or fake them.
2. **Cancel is immediate for the UI.** `turn_end: cancelled` goes out at once; the provider is
   told to stop, and anything it still yields is dropped. The next turn starts only after the
   provider's iterator has really ended, so two turns never overlap inside one provider (this
   matters for the single warm Claude session in step 8). Cancel also clears the queue.
3. **New input while busy is queued** (max 3, then a friendly refusal), not cancel-and-replace.
4. **Pause cancels the running turn** and makes the controller refuse new ones with an
   `agent_error` ("I'm paused. Resume me from the tray first.").
5. **A provider crash becomes `agent_error` + `turn_end: error`**, with a generic friendly line.
   Providers are expected to map their own known errors to better messages (step 8).

## Verified

- 9 tests: event order for a mock question and a system check, queueing, cancel (immediate
  `turn_end`, provider told, late events and queue dropped), cancel mid-stream on a real mock
  turn, crash → error, pause refusal, ring buffer, listener isolation.
- In the built app, a mock turn sent over IPC animates the avatar
  (state, ms since send):
  - "how is my pc doing?": `THINKING@22 → WORKING@1401 → HAPPY@2344 → IDLE@3863`
  - "run dir C:\ in a terminal": `THINKING@21 → WORKING@1240 → CONFUSED@1361 → IDLE@3380`

## Noticed

With short replies, the whole reply streams inside HAPPY's 1.5 s hold, so the avatar goes
HAPPY → IDLE without a visible TALKING phase. That matches the demo script ("→ HAPPY"); revisit
the hold if it feels off once the bubble shows the text.
