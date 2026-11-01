// What the speech bubble shows, as a pure reducer over BuddyEvents (plus open/close from the UI).
// The bubble shows one turn at a time: what you asked, the narration, the activity list and the
// reply as it streams in.
import type { BuddyEvent } from '../../shared/events';

export interface Activity {
  callId: string;
  label: string;
  status: 'running' | 'done' | 'failed';
  summary?: string;
}

export interface BubbleState {
  open: boolean;
  turnId: string | undefined;
  busy: boolean;
  /** What the user asked, shown above the reply. */
  prompt: string | undefined;
  narration: string | undefined;
  text: string;
  activities: Activity[];
  error: string | undefined;
  /** Typed messages waiting for their turn to start (the controller queues them). */
  pendingPrompts: string[];
}

export type BubbleAction = { type: 'event'; event: BuddyEvent } | { type: 'open' } | { type: 'close' };

export const initialBubble: BubbleState = {
  open: false,
  turnId: undefined,
  busy: false,
  prompt: undefined,
  narration: undefined,
  text: '',
  activities: [],
  error: undefined,
  pendingPrompts: [],
};

/** Separate a new text block from the previous one (e.g. after a tool ran in between). */
function newBlock(text: string): string {
  return text && !text.endsWith('\n\n') ? `${text.trimEnd()}\n\n` : text;
}

export function bubbleReducer(state: BubbleState, action: BubbleAction): BubbleState {
  if (action.type === 'open') return { ...state, open: true };
  if (action.type === 'close') return { ...state, open: false };

  const e = action.event;
  switch (e.type) {
    case 'user_input':
      return e.source === 'bubble' ? { ...state, pendingPrompts: [...state.pendingPrompts, e.text] } : state;

    case 'turn_start': {
      const fromBubble = e.source === 'bubble';
      return {
        ...initialBubble,
        open: true,
        turnId: e.turnId,
        busy: true,
        prompt: fromBubble ? state.pendingPrompts[0] : undefined,
        pendingPrompts: fromBubble ? state.pendingPrompts.slice(1) : state.pendingPrompts,
      };
    }

    case 'agent_error':
      if (e.turnId && e.turnId !== state.turnId) return state;
      return { ...state, open: true, error: e.message };

    case 'mode_changed':
      return e.mode === 'sleep' ? { ...state, open: false } : state;

    case 'user_idle':
    case 'observation':
    case 'confirm_resolved':
      return state;
  }

  // Everything else belongs to a turn; ignore stragglers from an older one.
  if (e.turnId !== state.turnId) return state;

  switch (e.type) {
    case 'thinking':
      return state;
    case 'narration':
      return { ...state, narration: e.text };
    case 'message_delta':
      return { ...state, text: state.text + e.text };
    case 'message':
      // Deltas normally carry the whole text already; add the final text only if they didn't.
      return state.text.trimEnd().endsWith(e.text.trim())
        ? state
        : { ...state, text: newBlock(state.text) + e.text };
    case 'tool_start':
      return {
        ...state,
        text: newBlock(state.text),
        activities: [...state.activities, { callId: e.callId, label: e.description, status: 'running' }],
      };
    case 'tool_result':
      return {
        ...state,
        activities: state.activities.map((a) =>
          a.callId === e.callId
            ? { ...a, status: e.success ? 'done' : 'failed', ...(e.summary ? { summary: e.summary } : {}) }
            : a,
        ),
      };
    case 'confirm_request':
      return state;
    case 'turn_end':
      return {
        ...state,
        busy: false,
        // A tool that never reported back didn't finish.
        activities: state.activities.map((a) => (a.status === 'running' ? { ...a, status: 'failed' } : a)),
        narration: e.outcome === 'cancelled' && !state.text ? 'Stopped.' : state.narration,
      };
  }
}
