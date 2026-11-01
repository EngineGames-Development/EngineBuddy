import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AVATAR_STATES, type AvatarState } from '../../shared/avatar';
import type { BuddyEvent } from '../../shared/events';
import { FALLBACK, POSES, artFor, poseFor } from './poses';
import { reactionFor } from './reactions';
import { AvatarStateMachine } from './state-machine';

function machine() {
  const changes: AvatarState[] = [];
  const m = new AvatarStateMachine((s) => changes.push(s));
  return { m, changes };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('AvatarStateMachine', () => {
  it('starts IDLE and follows ongoing states', () => {
    const { m, changes } = machine();
    expect(m.state).toBe('IDLE');
    m.apply({ state: 'THINKING', priority: 2 });
    m.apply({ state: 'TALKING', priority: 3 });
    expect(changes).toEqual(['THINKING', 'TALKING']);
  });

  it('keeps a held reaction on screen for its hold time, even if the turn ends right away', () => {
    const { m } = machine();
    m.apply({ state: 'HAPPY', priority: 4, hold: 1500 });
    m.apply({ state: 'IDLE', priority: 1 });
    expect(m.state).toBe('HAPPY');
    vi.advanceTimersByTime(1499);
    expect(m.state).toBe('HAPPY');
    vi.advanceTimersByTime(1);
    expect(m.state).toBe('IDLE');
  });

  it('returns to the ongoing state as it is when the hold ends', () => {
    const { m } = machine();
    m.apply({ state: 'WORKING', priority: 3 });
    m.apply({ state: 'HAPPY', priority: 4, hold: 1500 });
    m.apply({ state: 'TALKING', priority: 3 });
    vi.advanceTimersByTime(1500);
    expect(m.state).toBe('TALKING');
  });

  it('lets a higher priority interrupt a held state, but not a lower one', () => {
    const { m } = machine();
    m.apply({ state: 'HAPPY', priority: 4, hold: 1500 });
    m.apply({ state: 'CONFUSED', priority: 3, hold: 2000 });
    expect(m.state).toBe('HAPPY');
    m.apply({ state: 'ERROR', priority: 6, hold: 2500 });
    expect(m.state).toBe('ERROR');
    // The interrupted hold's timer must not end the new one early.
    vi.advanceTimersByTime(1500);
    expect(m.state).toBe('ERROR');
    vi.advanceTimersByTime(1000);
    expect(m.state).toBe('IDLE');
  });

  it('lets a higher-priority ongoing state cut a hold short', () => {
    const { m } = machine();
    m.apply({ state: 'HAPPY', priority: 4, hold: 1500 });
    m.apply({ state: 'WORRIED', priority: 5 });
    expect(m.state).toBe('WORRIED');
  });

  it('sleeps in sleep mode whatever happens, and wakes into the current state', () => {
    const { m } = machine();
    m.setMode('sleep');
    expect(m.state).toBe('SLEEPING');
    m.apply({ state: 'TALKING', priority: 3 });
    m.apply({ state: 'ERROR', priority: 6, hold: 2500 });
    expect(m.state).toBe('SLEEPING');
    m.setMode('companion');
    expect(m.state).toBe('ERROR');
  });

  it('a debug override wins until cleared', () => {
    const { m } = machine();
    m.apply({ state: 'TALKING', priority: 3 });
    m.setOverride('SURPRISED');
    expect(m.state).toBe('SURPRISED');
    m.setOverride(undefined);
    expect(m.state).toBe('TALKING');
  });

  it('only reports actual changes', () => {
    const { m, changes } = machine();
    m.apply({ state: 'TALKING', priority: 3 });
    m.apply({ state: 'TALKING', priority: 3 });
    expect(changes).toEqual(['TALKING']);
  });
});

describe('poses', () => {
  it('every state has art or falls back to a state that does', () => {
    for (const state of AVATAR_STATES) {
      expect(POSES[artFor(state)], state).toBeDefined();
      expect(poseFor(state)).toBe(POSES[artFor(state)]);
    }
  });

  it('fallbacks point at states with real art, never at another fallback', () => {
    for (const target of Object.values(FALLBACK)) expect(POSES[target]).toBeDefined();
  });

  it('has the 7 states the slice needs', () => {
    for (const s of ['IDLE', 'THINKING', 'TALKING', 'WORKING', 'HAPPY', 'CONFUSED', 'ERROR'] as const) {
      expect(POSES[s], s).toBeDefined();
    }
  });
});

describe('reactions table → state sequence', () => {
  /** Feed events with gaps (ms) and record what the avatar shows after each one. */
  function play(script: Array<[number, BuddyEvent]>): AvatarState[] {
    const { m } = machine();
    const seen: AvatarState[] = [];
    for (const [delay, event] of script) {
      vi.advanceTimersByTime(delay);
      const r = reactionFor(event);
      if (r) m.apply(r);
      seen.push(m.state);
    }
    vi.advanceTimersByTime(5000);
    seen.push(m.state);
    return seen;
  }

  it('a plain question: THINKING → TALKING → IDLE', () => {
    expect(
      play([
        [0, { type: 'turn_start', turnId: 't', source: 'bubble' }],
        [10, { type: 'thinking', turnId: 't' }],
        [900, { type: 'message_delta', turnId: 't', text: 'A linker' }],
        [50, { type: 'message_delta', turnId: 't', text: ' script…' }],
        [50, { type: 'turn_end', turnId: 't', outcome: 'ok' }],
      ]),
    ).toEqual(['THINKING', 'THINKING', 'TALKING', 'TALKING', 'IDLE', 'IDLE']);
  });

  it('a system check: WORKING → HAPPY (held through the reply) → TALKING → IDLE', () => {
    const seen = play([
      [0, { type: 'turn_start', turnId: 't', source: 'menu' }],
      [
        100,
        {
          type: 'tool_start',
          turnId: 't',
          callId: 'c',
          tool: 'get_system_info',
          category: 'system',
          description: 'Reading system info',
        },
      ],
      [300, { type: 'tool_result', turnId: 't', callId: 'c', success: true }],
      [200, { type: 'message_delta', turnId: 't', text: "You're fine." }],
      [1400, { type: 'message_delta', turnId: 't', text: ' 23% CPU.' }],
    ]);
    expect(seen).toEqual(['THINKING', 'WORKING', 'HAPPY', 'HAPPY', 'TALKING', 'TALKING']);
  });

  it('a denied tool: CONFUSED, then back', () => {
    const seen = play([
      [0, { type: 'turn_start', turnId: 't', source: 'bubble' }],
      [
        100,
        {
          type: 'tool_start',
          turnId: 't',
          callId: 'c',
          tool: 'Bash',
          category: 'terminal',
          description: 'Run a command',
        },
      ],
      [50, { type: 'tool_result', turnId: 't', callId: 'c', success: false, summary: 'Blocked' }],
      [100, { type: 'turn_end', turnId: 't', outcome: 'ok' }],
    ]);
    expect(seen).toEqual(['THINKING', 'WORKING', 'CONFUSED', 'CONFUSED', 'IDLE']);
  });

  it('an agent error shows ERROR even over a happy reaction', () => {
    const seen = play([
      [0, { type: 'tool_result', turnId: 't', callId: 'c', success: true }],
      [100, { type: 'agent_error', turnId: 't', message: 'offline', recoverable: true }],
      [100, { type: 'turn_end', turnId: 't', outcome: 'error' }],
    ]);
    expect(seen).toEqual(['HAPPY', 'ERROR', 'ERROR', 'IDLE']);
  });

  it('events with no reaction leave the state alone', () => {
    expect(reactionFor({ type: 'user_idle', seconds: 60 })).toBeUndefined();
    expect(reactionFor({ type: 'narration', turnId: 't', text: 'Checking…' })).toBeUndefined();
  });
});
