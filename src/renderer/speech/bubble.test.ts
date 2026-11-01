import { describe, expect, it } from 'vitest';
import type { BuddyEvent } from '../../shared/events';
import { AVATAR_OFFSET, WINDOW_BASE } from '../../shared/layout';
import { bubbleReducer, initialBubble, type BubbleState } from './bubble-model';
import { AVATAR_IN_WINDOW, chooseSide, placeBubble, workAreaInWindow } from './placement';

const run = (events: BuddyEvent[], from: BubbleState = initialBubble) =>
  events.reduce((s, event) => bubbleReducer(s, { type: 'event', event }), from);

describe('bubbleReducer', () => {
  it('shows the question, streams the reply and ends idle', () => {
    const s = run([
      { type: 'user_input', text: "what's a linker script?", source: 'bubble' },
      { type: 'turn_start', turnId: 't1', source: 'bubble' },
      { type: 'thinking', turnId: 't1' },
      { type: 'message_delta', turnId: 't1', text: 'A linker ' },
      { type: 'message_delta', turnId: 't1', text: 'script…' },
      { type: 'message', turnId: 't1', text: 'A linker script…' },
      { type: 'turn_end', turnId: 't1', outcome: 'ok' },
    ]);
    expect(s).toMatchObject({
      open: true,
      busy: false,
      prompt: "what's a linker script?",
      text: 'A linker script…',
    });
  });

  it('tracks tools in the activity list and separates text blocks around them', () => {
    const s = run([
      { type: 'turn_start', turnId: 't1', source: 'menu' },
      { type: 'message_delta', turnId: 't1', text: 'Checking.' },
      {
        type: 'tool_start',
        turnId: 't1',
        callId: 'a',
        tool: 'get_system_info',
        category: 'system',
        description: 'Reading system info',
      },
      {
        type: 'tool_start',
        turnId: 't1',
        callId: 'b',
        tool: 'Bash',
        category: 'terminal',
        description: 'Run a command',
      },
      { type: 'tool_result', turnId: 't1', callId: 'a', success: true, summary: 'ok' },
      { type: 'tool_result', turnId: 't1', callId: 'b', success: false },
      { type: 'message_delta', turnId: 't1', text: "You're fine." },
    ]);
    expect(s.activities.map((a) => a.status)).toEqual(['done', 'failed']);
    expect(s.text).toBe("Checking.\n\nYou're fine.");
    expect(s.prompt).toBeUndefined();
  });

  it('adds a final message the deltas missed', () => {
    const s = run([
      { type: 'turn_start', turnId: 't1', source: 'bubble' },
      { type: 'message', turnId: 't1', text: 'Done.' },
    ]);
    expect(s.text).toBe('Done.');
  });

  it('starts fresh on a new turn and pairs queued prompts with their turns', () => {
    const s = run([
      { type: 'user_input', text: 'first', source: 'bubble' },
      { type: 'user_input', text: 'second', source: 'bubble' },
      { type: 'turn_start', turnId: 't1', source: 'bubble' },
      { type: 'message_delta', turnId: 't1', text: 'one' },
      { type: 'turn_end', turnId: 't1', outcome: 'ok' },
      { type: 'turn_start', turnId: 't2', source: 'bubble' },
    ]);
    expect(s).toMatchObject({ turnId: 't2', prompt: 'second', text: '', pendingPrompts: [] });
  });

  it('ignores events from an older turn', () => {
    const s = run([
      { type: 'turn_start', turnId: 't2', source: 'bubble' },
      { type: 'message_delta', turnId: 't1', text: 'stale' },
    ]);
    expect(s.text).toBe('');
  });

  it('marks unfinished tools as failed and says "Stopped." when cancelled before any text', () => {
    const s = run([
      { type: 'turn_start', turnId: 't1', source: 'bubble' },
      { type: 'tool_start', turnId: 't1', callId: 'a', tool: 'x', category: 'system', description: 'x' },
      { type: 'turn_end', turnId: 't1', outcome: 'cancelled' },
    ]);
    expect(s.activities[0]?.status).toBe('failed');
    expect(s.narration).toBe('Stopped.');
  });

  it('opens for an error, even outside a turn', () => {
    const s = run([{ type: 'agent_error', message: "I'm paused.", recoverable: true }]);
    expect(s).toMatchObject({ open: true, error: "I'm paused." });
  });
});

describe('bubble placement', () => {
  const screen1080 = { x: 0, y: 0, width: 1920, height: 1040 };
  /** Work area as seen from a window whose avatar sits at (ax, ay) on screen, at `scale`. */
  const work = (ax: number, ay: number, scale = 1) =>
    workAreaInWindow(screen1080, { x: ax - AVATAR_OFFSET.x * scale, y: ay - AVATAR_OFFSET.y * scale }, scale);

  it('goes above when there is room, below near the top of the screen', () => {
    expect(chooseSide(work(900, 600))).toBe('above');
    expect(chooseSide(work(900, 20))).toBe('below');
  });

  it('centres on the avatar in open space', () => {
    const p = placeBubble('above', 260, work(900, 600));
    expect(p.left + 260 / 2).toBe(AVATAR_IN_WINDOW.x + AVATAR_IN_WINDOW.width / 2);
    expect(p.tailX).toBe(130);
  });

  it('shifts left at the right screen edge and keeps the tail on the avatar', () => {
    const avatarX = 1920 - 140 - 16;
    const w = work(avatarX, 600);
    const p = placeBubble('above', 300, w);
    expect(p.left + 300).toBeLessThanOrEqual(w.x + w.width);
    expect(p.left).toBeGreaterThanOrEqual(0);
    expect(p.tailX).toBeGreaterThan(150);
  });

  it('shifts right at the left screen edge', () => {
    const w = work(16, 600);
    const p = placeBubble('below', 300, w);
    expect(p.left).toBeGreaterThanOrEqual(w.x);
    expect(p.left + 300).toBeLessThanOrEqual(WINDOW_BASE.width);
    expect(p.top).toBeDefined();
  });

  it('works at scale 1.5', () => {
    const w = work(1920 - 210 - 16, 20, 1.5);
    expect(chooseSide(w)).toBe('below');
    const p = placeBubble('below', 300, w);
    expect(p.left + 300).toBeLessThanOrEqual(w.x + w.width);
  });
});
