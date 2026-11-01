import { describe, expect, it } from 'vitest';
import { AgentController } from '../../core/agent/agent-controller';
import type { AgentEvent, AgentProvider, TurnInput } from '../../core/agent/agent-provider';
import { EventBus } from '../../core/events/event-bus';
import type { BuddyEvent } from '../../shared/events';
import { MockAgent } from './mock-agent';

function setup(provider: AgentProvider = new MockAgent({ speed: 0 })) {
  const bus = new EventBus();
  const events: BuddyEvent[] = [];
  bus.on((e) => events.push(e));
  let n = 0;
  const controller = new AgentController({ bus, provider, newTurnId: () => `t${++n}` });
  const types = () => events.map((e) => ('turnId' in e && e.turnId ? `${e.type}:${e.turnId}` : e.type));
  return { bus, events, controller, types };
}

const ask = (text: string, extra: Partial<TurnInput> = {}): TurnInput => ({
  text,
  source: 'bubble',
  ...extra,
});

/** A provider whose turns wait until released, to test ordering and cancellation precisely. */
function gatedProvider() {
  const gates = new Map<string, () => void>();
  const cancelled: string[] = [];
  const provider: AgentProvider = {
    id: 'mock',
    async *startTurn(_input, { turnId }): AsyncIterable<AgentEvent> {
      yield { type: 'thinking' };
      await new Promise<void>((resolve) => gates.set(turnId, resolve));
      yield { type: 'message_delta', text: `late reply for ${turnId}` };
    },
    async cancel(turnId) {
      cancelled.push(turnId);
      gates.get(turnId)?.();
    },
    async dispose() {},
  };
  const release = (turnId: string) => gates.get(turnId)?.();
  const waitForGate = async (turnId: string) => {
    while (!gates.has(turnId)) await new Promise((r) => setTimeout(r, 1));
  };
  return { provider, release, waitForGate, cancelled };
}

describe('AgentController + MockAgent', () => {
  it('wraps a mock question in turn_start … turn_end, with every event stamped', async () => {
    const { controller, events, types } = setup();
    controller.submit(ask("what's a linker script, short version?"));
    await controller.whenIdle();

    const t = types();
    expect(t[0]).toBe('turn_start:t1');
    expect(t[1]).toBe('thinking:t1');
    expect(t.filter((x) => x === 'message_delta:t1').length).toBeGreaterThan(5);
    expect(t.at(-2)).toBe('message:t1');
    expect(t.at(-1)).toBe('turn_end:t1');
    expect(events.at(-1)).toMatchObject({ outcome: 'ok' });
  });

  it('plays the system check: tool_start → tool_result → reply', async () => {
    const { controller, types } = setup();
    controller.submit(ask('System check', { source: 'menu', intent: 'system_check' }));
    await controller.whenIdle();
    const t = types().filter((x) => !x.startsWith('message_delta'));
    expect(t).toEqual([
      'turn_start:t1',
      'thinking:t1',
      'narration:t1',
      'tool_start:t1',
      'tool_result:t1',
      'message:t1',
      'turn_end:t1',
    ]);
  });

  it('runs one turn at a time and queues the next', async () => {
    const { provider, release, waitForGate } = gatedProvider();
    const { controller, types } = setup(provider);
    controller.submit(ask('first'));
    controller.submit(ask('second'));
    await waitForGate('t1');
    expect(types()).toEqual(['turn_start:t1', 'thinking:t1']);

    release('t1');
    await waitForGate('t2');
    release('t2');
    await controller.whenIdle();
    expect(types()).toEqual([
      'turn_start:t1',
      'thinking:t1',
      'message_delta:t1',
      'turn_end:t1',
      'turn_start:t2',
      'thinking:t2',
      'message_delta:t2',
      'turn_end:t2',
    ]);
  });

  it('cancel ends the turn at once, tells the provider, drops late events and the queue', async () => {
    const { provider, waitForGate, cancelled } = gatedProvider();
    const { controller, types, events } = setup(provider);
    controller.submit(ask('first'));
    controller.submit(ask('queued, should be dropped'));
    await waitForGate('t1');

    controller.cancel();
    expect(types().at(-1)).toBe('turn_end:t1');
    expect(events.at(-1)).toMatchObject({ outcome: 'cancelled' });

    await controller.whenIdle();
    expect(cancelled).toEqual(['t1']);
    // The provider's late delta was swallowed, and the queued turn never started.
    expect(types()).toEqual(['turn_start:t1', 'thinking:t1', 'turn_end:t1']);
  });

  it('cancels a real mock turn mid-stream', async () => {
    const { controller, types } = setup(new MockAgent({ speed: 1 }));
    controller.submit(ask('tell me about linker scripts'));
    while (!types().includes('message_delta:t1')) await new Promise((r) => setTimeout(r, 10));
    controller.cancel();
    await controller.whenIdle();
    const after = types().slice(types().indexOf('turn_end:t1') + 1);
    expect(after).toEqual([]);
  }, 10_000);

  it('turns a provider crash into agent_error + turn_end: error', async () => {
    const provider: AgentProvider = {
      id: 'mock',
      // eslint-disable-next-line require-yield
      async *startTurn() {
        throw new Error('boom');
      },
      async cancel() {},
      async dispose() {},
    };
    const { controller, types, events } = setup(provider);
    controller.submit(ask('hi'));
    await controller.whenIdle();
    expect(types()).toEqual(['turn_start:t1', 'agent_error:t1', 'turn_end:t1']);
    expect(events.at(-1)).toMatchObject({ outcome: 'error' });
  });

  it('refuses turns while paused', async () => {
    const { controller, types } = setup();
    controller.setMode('sleep');
    controller.submit(ask('hi'));
    await controller.whenIdle();
    expect(types()).toEqual(['agent_error']);
  });
});

describe('EventBus', () => {
  it('keeps the last N events in order', () => {
    const bus = new EventBus(3);
    for (let i = 1; i <= 5; i++) bus.emit({ type: 'user_idle', seconds: i });
    expect(bus.recent().map((r) => (r.event as { seconds: number }).seconds)).toEqual([3, 4, 5]);
  });

  it('keeps delivering when one listener throws', () => {
    const bus = new EventBus();
    const got: string[] = [];
    bus.on(() => {
      throw new Error('bad listener');
    });
    bus.on((e) => got.push(e.type));
    const warn = console.error;
    console.error = () => {};
    bus.emit({ type: 'user_idle', seconds: 1 });
    console.error = warn;
    expect(got).toEqual(['user_idle']);
  });
});
