// The EventBus (ARCHITECTURE.md §4.2): the one place BuddyEvents flow through in main. Producers
// (AgentController, tray, startup) emit; consumers (the IPC fan-out to renderers, logs) listen.
// The last events are kept in a ring buffer, so "why did the avatar look confused?" can be
// answered by replaying them.
import type { BuddyEvent } from '../../shared/events';

export type EventListener = (event: BuddyEvent) => void;

export interface RecordedEvent {
  at: number;
  event: BuddyEvent;
}

export class EventBus {
  private readonly listeners = new Set<EventListener>();
  private readonly ring: RecordedEvent[] = [];
  private next = 0;

  constructor(
    private readonly capacity = 500,
    private readonly now: () => number = Date.now,
  ) {}

  on(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: BuddyEvent): void {
    const record = { at: this.now(), event };
    if (this.ring.length < this.capacity) this.ring.push(record);
    else this.ring[this.next] = record;
    this.next = (this.next + 1) % this.capacity;

    for (const listener of this.listeners) {
      // One broken consumer must not stop the others (or the agent) from getting the event.
      try {
        listener(event);
      } catch (error) {
        console.error('[event-bus] listener failed:', error);
      }
    }
  }

  /** The buffered events, oldest first. */
  recent(): RecordedEvent[] {
    return this.ring.length < this.capacity
      ? [...this.ring]
      : [...this.ring.slice(this.next), ...this.ring.slice(0, this.next)];
  }
}
