// Which avatar state each BuddyEvent asks for (ARCHITECTURE.md §4.3). This is a table on purpose:
// the agent layer only emits facts, and how the avatar reacts to them is data here, not code
// spread across the agent. The first matching row wins.
import type { BuddyEvent, BuddyEventType, EventOf } from '../../shared/events';
import type { StateRequest } from './state-machine';

interface Reaction<T extends BuddyEventType> extends StateRequest {
  on: T;
  /** Fields the event must have, compared with ===. */
  where?: Partial<EventOf<T>>;
}

type AnyReaction = { [T in BuddyEventType]: Reaction<T> }[BuddyEventType];

export const REACTIONS: readonly AnyReaction[] = [
  { on: 'user_input', state: 'LISTENING', priority: 1 },
  { on: 'turn_start', state: 'THINKING', priority: 2 },
  { on: 'thinking', state: 'THINKING', priority: 2 },
  { on: 'message_delta', state: 'TALKING', priority: 3 },
  { on: 'tool_start', where: { category: 'filesystem' }, state: 'CODING', priority: 3 },
  { on: 'tool_start', state: 'WORKING', priority: 3 },
  // After a tool, the model reads the result: back to THINKING once the reaction has shown.
  { on: 'tool_result', where: { success: true }, state: 'HAPPY', priority: 4, hold: 1500, then: 'THINKING' },
  {
    on: 'tool_result',
    where: { success: false },
    state: 'CONFUSED',
    priority: 4,
    hold: 2000,
    then: 'THINKING',
  },
  { on: 'confirm_request', state: 'WORRIED', priority: 5 },
  { on: 'agent_error', state: 'ERROR', priority: 6, hold: 2500 },
  { on: 'turn_end', where: { outcome: 'ok' }, state: 'IDLE', priority: 1 },
  { on: 'turn_end', where: { outcome: 'cancelled' }, state: 'IDLE', priority: 1 },
  { on: 'turn_end', where: { outcome: 'error' }, state: 'IDLE', priority: 1 },
];

export function reactionFor(event: BuddyEvent): StateRequest | undefined {
  const row = REACTIONS.find(
    (r) =>
      r.on === event.type &&
      Object.entries(r.where ?? {}).every(
        ([key, value]) => (event as Record<string, unknown>)[key] === value,
      ),
  );
  if (!row) return undefined;
  const { state, priority, hold, then } = row;
  return { state, priority, ...(hold === undefined ? {} : { hold }), ...(then ? { then } : {}) };
}
