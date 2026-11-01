// The reply that is still streaming in, as a pure reducer over BuddyEvents. Finished replies come
// from main's history (ChatState); this only covers the turn in progress.
import type { BuddyEvent } from '../../shared/events';

export interface LiveTool {
  callId: string;
  label: string;
  status: 'running' | 'done' | 'failed';
}

export interface LiveTurn {
  turnId: string | undefined;
  busy: boolean;
  text: string;
  narration: string | undefined;
  tools: LiveTool[];
}

export const idle: LiveTurn = { turnId: undefined, busy: false, text: '', narration: undefined, tools: [] };

export function liveReducer(state: LiveTurn, e: BuddyEvent): LiveTurn {
  if (e.type === 'turn_start') return { ...idle, turnId: e.turnId, busy: true };
  if (e.type === 'confirm_request')
    return { ...state, narration: 'Waiting for your OK in the confirmation window…' };
  if (e.type === 'confirm_resolved')
    return { ...state, narration: e.allowed ? 'You said yes. Running it…' : 'You said no.' };
  if (!('turnId' in e) || e.turnId !== state.turnId) return state;
  switch (e.type) {
    case 'narration':
      return { ...state, narration: e.text };
    case 'message_delta':
      return { ...state, text: state.text + e.text };
    case 'message':
      return state.text.trimEnd().endsWith(e.text.trim())
        ? state
        : { ...state, text: state.text ? `${state.text.trimEnd()}\n\n${e.text}` : e.text };
    case 'tool_start':
      return {
        ...state,
        text: state.text && !state.text.endsWith('\n\n') ? `${state.text.trimEnd()}\n\n` : state.text,
        tools: [...state.tools, { callId: e.callId, label: e.description, status: 'running' }],
      };
    case 'tool_result':
      return {
        ...state,
        tools: state.tools.map((t) =>
          t.callId === e.callId ? { ...t, status: e.success ? 'done' : 'failed' } : t,
        ),
      };
    case 'turn_end':
      return idle;
    default:
      return state;
  }
}
