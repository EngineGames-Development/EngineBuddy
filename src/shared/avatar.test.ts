import { describe, expect, it } from 'vitest';
import { AVATAR_STATES } from './avatar';

describe('AVATAR_STATES', () => {
  it('has the 14 states from the spec, each once', () => {
    expect(AVATAR_STATES).toHaveLength(14);
    expect(new Set(AVATAR_STATES).size).toBe(14);
  });
});
