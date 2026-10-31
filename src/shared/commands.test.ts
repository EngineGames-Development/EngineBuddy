import { describe, expect, it } from 'vitest';
import { MAX_INPUT_LENGTH, buddyCommandSchema, windowCommandSchema } from './commands';

const accepts = (schema: typeof buddyCommandSchema | typeof windowCommandSchema, v: unknown) =>
  schema.safeParse(v).success;

describe('buddyCommandSchema', () => {
  it('accepts a normal message', () => {
    expect(
      accepts(buddyCommandSchema, { type: 'user_input', text: 'why is my build failing?', source: 'bubble' }),
    ).toBe(true);
  });

  it('accepts cancel_turn', () => {
    expect(accepts(buddyCommandSchema, { type: 'cancel_turn' })).toBe(true);
  });

  it.each([
    ['blank text', { type: 'user_input', text: '   \n ', source: 'bubble' }],
    ['text over the limit', { type: 'user_input', text: 'x'.repeat(MAX_INPUT_LENGTH + 1), source: 'chat' }],
    ['non-string text', { type: 'user_input', text: 42, source: 'chat' }],
    ['a source renderers may not claim', { type: 'user_input', text: 'hi', source: 'proactive' }],
    ['an unknown command', { type: 'run_command', cmd: 'format C:' }],
    ['an extra key', { type: 'cancel_turn', force: true }],
    ['not an object', 'user_input'],
    ['null', null],
  ])('rejects %s', (_label, payload) => {
    expect(accepts(buddyCommandSchema, payload)).toBe(false);
  });
});

describe('windowCommandSchema', () => {
  it('accepts click-through and a drag step', () => {
    expect(accepts(windowCommandSchema, { type: 'set_click_through', enabled: true })).toBe(true);
    expect(accepts(windowCommandSchema, { type: 'move_by', dx: -12, dy: 7 })).toBe(true);
  });

  it.each([
    ['fractional pixels', { type: 'move_by', dx: 1.5, dy: 0 }],
    ['a huge jump', { type: 'move_by', dx: 1e9, dy: 0 }],
    ['NaN', { type: 'move_by', dx: Number.NaN, dy: 0 }],
    ['a missing field', { type: 'move_by', dx: 3 }],
    ['a non-boolean flag', { type: 'set_click_through', enabled: 'yes' }],
    ['an unknown window command', { type: 'set_bounds', x: 0, y: 0 }],
  ])('rejects %s', (_label, payload) => {
    expect(accepts(windowCommandSchema, payload)).toBe(false);
  });
});
