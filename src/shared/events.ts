// BuddyEvents: facts the main process broadcasts to every window (ARCHITECTURE.md §4.1).
// The agent layer only ever emits these; the avatar, bubble, chat and logs each decide on
// their own how to react. Nothing here says how anything should look.
//
// These are plain types, not zod schemas: events flow main → renderer, and main is the trusted
// side. Untrusted input (renderer → main) is validated in ./commands.ts.

export type TurnSource = 'bubble' | 'chat' | 'menu' | 'proactive';
export type InputSource = 'bubble' | 'chat' | 'voice';
export type TurnOutcome = 'ok' | 'error' | 'cancelled';

export type ToolCategory = 'system' | 'filesystem' | 'terminal' | 'git' | 'apps' | 'projects' | 'memory';

export type DesktopMode = 'companion' | 'focus' | 'developer' | 'silent' | 'sleep';

export type Priority = 'critical' | 'high' | 'normal' | 'low';

/**
 * What the confirmation window shows (SECURITY.md §5). `target` and `details` are built from the
 * tool's validated input (the literal command, the exact paths); `modelExplanation` is the
 * model's own words, always shown separately and labelled as such. Used from Phase 2.
 */
export interface ConfirmationRequest {
  title: string;
  target: string;
  details: string[];
  modelExplanation?: string;
  /** For file changes: the change itself, line by line. */
  diff?: DiffLine[];
}

/** One line of a diff. `gap` stands for unchanged lines left out; its text says how many. */
export interface DiffLine {
  kind: 'same' | 'add' | 'del' | 'gap';
  text: string;
}

export type BuddyEvent =
  // agent lifecycle
  | { type: 'turn_start'; turnId: string; source: TurnSource }
  | { type: 'thinking'; turnId: string }
  | { type: 'message_delta'; turnId: string; text: string }
  | { type: 'message'; turnId: string; text: string }
  | { type: 'narration'; turnId: string; text: string }
  | {
      type: 'tool_start';
      turnId: string;
      callId: string;
      tool: string;
      category: ToolCategory;
      description: string;
    }
  | { type: 'tool_result'; turnId: string; callId: string; success: boolean; summary?: string }
  | { type: 'confirm_request'; turnId: string; callId: string; request: ConfirmationRequest }
  | { type: 'confirm_resolved'; callId: string; allowed: boolean }
  | { type: 'turn_end'; turnId: string; outcome: TurnOutcome }
  | { type: 'agent_error'; turnId?: string; message: string; recoverable: boolean }
  // user / app
  | { type: 'user_input'; text: string; source: InputSource }
  | { type: 'mode_changed'; mode: DesktopMode }
  | { type: 'user_idle'; seconds: number }
  // later: observations from watchers (Phase 5)
  | { type: 'observation'; kind: string; priority: Priority; data: unknown };

export type BuddyEventType = BuddyEvent['type'];

/** Narrow a BuddyEvent by its type: `EventOf<'tool_start'>`. */
export type EventOf<T extends BuddyEventType> = Extract<BuddyEvent, { type: T }>;
