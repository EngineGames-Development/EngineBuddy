import { describe, expect, it } from 'vitest';
import { parseSettings } from './schema';

describe('parseSettings', () => {
  it('gives defaults for a missing or garbage file', () => {
    expect(parseSettings(undefined)).toEqual({
      scale: 1,
      positions: {},
      lastDisplayId: undefined,
      bubbleDismissSeconds: 12,
      agent: 'claude-code',
      claudeExecutable: undefined,
      claudeModel: undefined,
      projectRoots: [],
    });
    expect(parseSettings('nope')).toEqual(parseSettings({}));
  });

  it('keeps good values', () => {
    const good = {
      scale: 1.25,
      positions: { '7': { x: 10, y: 20 } },
      lastDisplayId: '7',
      bubbleDismissSeconds: 30,
      agent: 'mock',
      claudeExecutable: 'D:\\claude.exe',
      claudeModel: 'sonnet',
      projectRoots: ['D:\\code'],
    };
    expect(parseSettings(good)).toEqual(good);
  });

  it('resets only the bad field', () => {
    const s = parseSettings({ scale: 99, positions: { '7': { x: 10, y: 20 } } });
    expect(s.scale).toBe(1);
    expect(s.positions).toEqual({ '7': { x: 10, y: 20 } });
  });
});
