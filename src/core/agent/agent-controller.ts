// AgentController (ARCHITECTURE.md §6.1): owns turns. It gives each turn an ID, runs exactly one
// at a time (later input waits in a short queue), stamps the provider's events with the turn ID
// and puts them on the bus, and draws the turn boundaries (turn_start / turn_end) itself, so a
// provider can't forget them.
import type { DesktopMode, TurnOutcome } from '../../shared/events';
import type { EventBus } from '../events/event-bus';
import type { AgentProvider, TurnInput } from './agent-provider';

const MAX_QUEUE = 3;

export interface ControllerOptions {
  bus: EventBus;
  provider: AgentProvider;
  newTurnId?: () => string;
}

interface ActiveTurn {
  turnId: string;
  cancelled: boolean;
}

let counter = 0;
const defaultTurnId = () => `t${Date.now().toString(36)}-${(++counter).toString(36)}`;

export class AgentController {
  private readonly bus: EventBus;
  private readonly provider: AgentProvider;
  private readonly newTurnId: () => string;
  private active: ActiveTurn | undefined;
  private readonly queue: TurnInput[] = [];
  private mode: DesktopMode = 'companion';
  private idleWaiters: Array<() => void> = [];

  constructor(opts: ControllerOptions) {
    this.bus = opts.bus;
    this.provider = opts.provider;
    this.newTurnId = opts.newTurnId ?? defaultTurnId;
  }

  get busy(): boolean {
    return this.active !== undefined;
  }

  setMode(mode: DesktopMode): void {
    this.mode = mode;
  }

  submit(input: TurnInput): void {
    if (this.mode === 'sleep') {
      this.bus.emit({
        type: 'agent_error',
        message: "I'm paused. Resume me from the tray first.",
        recoverable: true,
      });
      return;
    }
    if (!this.active) {
      void this.run(input);
    } else if (this.queue.length < MAX_QUEUE) {
      this.queue.push(input);
    } else {
      this.bus.emit({
        type: 'agent_error',
        message: "Hang on, I'm still on the last few.",
        recoverable: true,
      });
    }
  }

  /**
   * Stop the current turn and drop anything queued. The UI hears `turn_end: cancelled` right away;
   * the provider is told to stop, and whatever it still yields is discarded.
   */
  cancel(): void {
    this.queue.length = 0;
    const turn = this.active;
    if (!turn || turn.cancelled) return;
    turn.cancelled = true;
    this.bus.emit({ type: 'turn_end', turnId: turn.turnId, outcome: 'cancelled' });
    this.provider
      .cancel(turn.turnId)
      .catch((error: unknown) => console.warn('[agent] cancel failed:', error));
  }

  /** Resolves once no turn is running and nothing is queued. For tests and shutdown. */
  whenIdle(): Promise<void> {
    if (!this.active && this.queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  private async run(input: TurnInput): Promise<void> {
    const turn: ActiveTurn = { turnId: this.newTurnId(), cancelled: false };
    const { turnId } = turn;
    this.active = turn;
    this.bus.emit({ type: 'turn_start', turnId, source: input.source });

    let outcome: TurnOutcome = 'ok';
    try {
      for await (const event of this.provider.startTurn(input, { turnId, mode: this.mode })) {
        if (turn.cancelled) continue; // drain quietly until the provider stops
        if (event.type === 'agent_error') outcome = 'error';
        this.bus.emit({ ...event, turnId });
      }
    } catch (error) {
      console.error('[agent] turn failed:', error);
      if (!turn.cancelled) {
        outcome = 'error';
        this.bus.emit({
          type: 'agent_error',
          turnId,
          message: 'Something broke on my end. Try that again?',
          recoverable: true,
        });
      }
    }

    if (!turn.cancelled) this.bus.emit({ type: 'turn_end', turnId, outcome });
    this.active = undefined;

    const next = this.queue.shift();
    if (next) {
      void this.run(next);
    } else {
      for (const resolve of this.idleWaiters.splice(0)) resolve();
    }
  }
}
