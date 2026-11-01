// ConfirmationBroker (SECURITY.md §5): asks you about CONFIRM requests, one at a time, through a
// presenter that main owns (a separate window; the avatar renderer can never see or answer it).
// Unanswered requests time out to "no". A cancelled turn withdraws its request.
import type { ConfirmationRequest } from '../../shared/events';

export const CONFIRM_TIMEOUT_MS = 120_000;
/** Allow is disabled this long after a request appears, so a stray click or keypress can't approve it. */
export const ALLOW_DELAY_MS = 500;

export interface PendingConfirmation {
  id: string;
  request: ConfirmationRequest;
  turnId?: string;
  /** Epoch ms when it was shown, for the Allow delay. */
  shownAt: number;
  timeoutMs: number;
}

export interface ConfirmationPresenter {
  show(pending: PendingConfirmation): void;
  hide(): void;
}

export type ConfirmOutcome = 'allowed' | 'denied' | 'timeout' | 'cancelled';

export interface BrokerOptions {
  presenter: ConfirmationPresenter;
  timeoutMs?: number;
  now?: () => number;
  /** Fired when a request is shown and when it's resolved, for the event bus. */
  onShow?: (pending: PendingConfirmation) => void;
  onResolve?: (pending: PendingConfirmation, outcome: ConfirmOutcome) => void;
}

interface Entry {
  pending: PendingConfirmation;
  resolve: (outcome: ConfirmOutcome) => void;
  timer?: ReturnType<typeof setTimeout>;
  cleanup: () => void;
}

let counter = 0;

export class ConfirmationBroker {
  private readonly queue: Entry[] = [];
  private current: Entry | undefined;
  private readonly now: () => number;

  constructor(private readonly opts: BrokerOptions) {
    this.now = opts.now ?? Date.now;
  }

  ask(
    request: ConfirmationRequest,
    ctx: { turnId?: string; signal?: AbortSignal } = {},
  ): Promise<ConfirmOutcome> {
    if (ctx.signal?.aborted) return Promise.resolve('cancelled');
    return new Promise((resolve) => {
      const entry: Entry = {
        pending: {
          id: `c${(++counter).toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          request,
          ...(ctx.turnId ? { turnId: ctx.turnId } : {}),
          shownAt: 0,
          timeoutMs: this.opts.timeoutMs ?? CONFIRM_TIMEOUT_MS,
        },
        resolve,
        cleanup: () => {},
      };
      const onAbort = () => this.finish(entry, 'cancelled');
      ctx.signal?.addEventListener('abort', onAbort, { once: true });
      entry.cleanup = () => ctx.signal?.removeEventListener('abort', onAbort);
      this.queue.push(entry);
      this.next();
    });
  }

  /**
   * Your answer from the confirmation window. Ignored unless it's for the request on screen, and
   * an Allow that arrives before the Allow delay is over counts as nothing.
   */
  answer(id: string, allowed: boolean): boolean {
    const entry = this.current;
    if (!entry || entry.pending.id !== id) return false;
    if (allowed && this.now() - entry.pending.shownAt < ALLOW_DELAY_MS) return false;
    this.finish(entry, allowed ? 'allowed' : 'denied');
    return true;
  }

  /** Deny the request on screen and everything waiting behind it. */
  denyAll(): void {
    for (const entry of [...this.queue]) this.finish(entry, 'denied');
    if (this.current) this.finish(this.current, 'denied');
  }

  get pending(): PendingConfirmation | undefined {
    return this.current?.pending;
  }

  private next(): void {
    if (this.current) return;
    const entry = this.queue.shift();
    if (!entry) {
      this.opts.presenter.hide();
      return;
    }
    this.current = entry;
    entry.pending.shownAt = this.now();
    entry.timer = setTimeout(() => this.finish(entry, 'timeout'), entry.pending.timeoutMs);
    this.opts.presenter.show(entry.pending);
    this.opts.onShow?.(entry.pending);
  }

  private finish(entry: Entry, outcome: ConfirmOutcome): void {
    clearTimeout(entry.timer);
    entry.cleanup();
    const queued = this.queue.indexOf(entry);
    if (queued >= 0) this.queue.splice(queued, 1);
    const wasCurrent = this.current === entry;
    if (wasCurrent) this.current = undefined;
    if (wasCurrent) this.opts.onResolve?.(entry.pending, outcome);
    entry.resolve(outcome);
    if (wasCurrent) this.next();
  }
}
