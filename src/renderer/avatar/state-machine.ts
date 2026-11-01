// AvatarStateMachine (ARCHITECTURE.md §4.3): decides which state the avatar shows when several
// reactions compete. Pure TS, no DOM, so it's unit-tested with fake timers.
//
// It keeps two layers:
//   base  the turn's ongoing state (THINKING, TALKING, WORKING, IDLE, ...): the latest one wins
//   held  a short reaction with a minimum hold time (HAPPY, CONFUSED, ERROR, ...)
// The held state shows until its hold expires, then the avatar returns to whatever the base state
// is by then. A higher-priority request interrupts a lower-priority held state; a lower one waits.
// Sleep mode overrides both.
import type { AvatarState } from '../../shared/avatar';
import type { DesktopMode } from '../../shared/events';

export interface StateRequest {
  state: AvatarState;
  priority: number;
  /** Minimum time on screen, in ms. Requests with a hold are reactions; without, ongoing states. */
  hold?: number;
  /**
   * For a reaction: what the ongoing state is from now on. A finished tool means the model is
   * thinking again, so after HAPPY the avatar shouldn't fall back to WORKING.
   */
  then?: AvatarState;
}

export class AvatarStateMachine {
  private base: AvatarState = 'IDLE';
  private held: { state: AvatarState; priority: number; timer: ReturnType<typeof setTimeout> } | undefined;
  private mode: DesktopMode = 'companion';
  private override: AvatarState | undefined;
  private shown: AvatarState = 'IDLE';

  constructor(private readonly onChange: (state: AvatarState) => void) {}

  get state(): AvatarState {
    return this.shown;
  }

  apply(request: StateRequest): void {
    if (request.hold === undefined) {
      this.base = request.state;
      if (this.held && request.priority > this.held.priority) this.clearHeld();
    } else if (!this.held || request.priority >= this.held.priority) {
      if (request.then) this.base = request.then;
      this.clearHeld();
      const timer = setTimeout(() => {
        this.held = undefined;
        this.refresh();
      }, request.hold);
      this.held = { state: request.state, priority: request.priority, timer };
    }
    this.refresh();
  }

  setMode(mode: DesktopMode): void {
    this.mode = mode;
    this.refresh();
  }

  /** Debug only (Ctrl+Alt+D): show this state regardless of everything else, until cleared. */
  setOverride(state: AvatarState | undefined): void {
    this.override = state;
    this.refresh();
  }

  dispose(): void {
    this.clearHeld();
  }

  private clearHeld(): void {
    if (this.held) clearTimeout(this.held.timer);
    this.held = undefined;
  }

  private refresh(): void {
    const next = this.override ?? (this.mode === 'sleep' ? 'SLEEPING' : (this.held?.state ?? this.base));
    if (next === this.shown) return;
    this.shown = next;
    this.onChange(next);
  }
}
