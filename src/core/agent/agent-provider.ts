// The interface every brain implements (ARCHITECTURE.md §6.1). The UI never sees a provider: the
// AgentController runs it and turns what it yields into BuddyEvents on the bus.
import type { DesktopMode, EventOf, TurnSource } from '../../shared/events';

/** Structured requests from menus, so they take the same path as typed text. */
export type TurnIntent = 'system_check' | 'open_in_vscode';

export interface TurnInput {
  text: string;
  source: TurnSource;
  intent?: TurnIntent;
}

export interface TurnContext {
  turnId: string;
  mode: DesktopMode;
}

type Omit_<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/**
 * What a provider yields during a turn: the agent-lifecycle events, minus `turnId` (the
 * controller stamps it) and minus turn_start/turn_end (the controller owns turn boundaries).
 */
export type AgentEvent = Omit_<
  EventOf<
    'thinking' | 'message_delta' | 'message' | 'narration' | 'tool_start' | 'tool_result' | 'agent_error'
  >,
  'turnId'
>;

export interface AgentProvider {
  readonly id: 'claude-code' | 'local' | 'mock';
  /** Run one turn. The iterable ends when the turn is over. Throwing = the turn failed. */
  startTurn(input: TurnInput, ctx: TurnContext): AsyncIterable<AgentEvent>;
  /** Stop the running turn as soon as possible. The iterable should end soon after. */
  cancel(turnId: string): Promise<void>;
  /** Optional: get ready in the background (e.g. start a warm session) before the first turn. */
  prewarm?(): Promise<void>;
  dispose(): Promise<void>;
}
