import { describe, expect, it } from 'vitest';
import type { BuddyEvent } from '../shared/events';
import { IPC_CHANNELS } from '../shared/ipc';
import { createBuddyApi, type RendererIpc } from './api';

type Listener = (event: unknown, payload: unknown) => void;

function fakeIpc() {
  const sent: Array<[string, unknown]> = [];
  const listeners = new Map<string, Set<Listener>>();
  const ipc: RendererIpc = {
    send: (channel, payload) => void sent.push([channel, payload]),
    on: (channel, l) =>
      void (listeners.get(channel) ?? listeners.set(channel, new Set()).get(channel)!).add(l),
    removeListener: (channel, l) => void listeners.get(channel)?.delete(l),
  };
  const emit = (channel: string, payload: unknown) => listeners.get(channel)?.forEach((l) => l({}, payload));
  return { ipc, sent, emit, listenerCount: (c: string) => listeners.get(c)?.size ?? 0 };
}

describe('window.buddy', () => {
  it('exposes exactly onEvent, send and the window methods', () => {
    const api = createBuddyApi(fakeIpc().ipc);
    expect(Object.keys(api).sort()).toEqual(['onEvent', 'send', 'window']);
    expect(Object.keys(api.window).sort()).toEqual(['dragEnd', 'moveBy', 'scaleBy', 'setClickThrough']);
  });

  it('is frozen, so a renderer script cannot swap methods', () => {
    const api = createBuddyApi(fakeIpc().ipc);
    expect(Object.isFrozen(api)).toBe(true);
    expect(Object.isFrozen(api.window)).toBe(true);
  });

  it('sends commands and window commands on their own channels', () => {
    const { ipc, sent } = fakeIpc();
    const api = createBuddyApi(ipc);
    api.send({ type: 'user_input', text: 'hey', source: 'bubble' });
    api.window.setClickThrough(true);
    api.window.moveBy(5, -3);
    api.window.dragEnd();
    api.window.scaleBy(1);
    expect(sent).toEqual([
      [IPC_CHANNELS.command, { type: 'user_input', text: 'hey', source: 'bubble' }],
      [IPC_CHANNELS.window, { type: 'set_click_through', enabled: true }],
      [IPC_CHANNELS.window, { type: 'move_by', dx: 5, dy: -3 }],
      [IPC_CHANNELS.window, { type: 'drag_end' }],
      [IPC_CHANNELS.window, { type: 'scale_by', steps: 1 }],
    ]);
  });

  it('delivers events until unsubscribed', () => {
    const { ipc, emit, listenerCount } = fakeIpc();
    const api = createBuddyApi(ipc);
    const received: BuddyEvent[] = [];
    const unsubscribe = api.onEvent((e) => received.push(e));

    emit(IPC_CHANNELS.event, { type: 'thinking', turnId: 't1' });
    unsubscribe();
    emit(IPC_CHANNELS.event, { type: 'turn_end', turnId: 't1', outcome: 'ok' });

    expect(received).toEqual([{ type: 'thinking', turnId: 't1' }]);
    expect(listenerCount(IPC_CHANNELS.event)).toBe(0);
  });
});
