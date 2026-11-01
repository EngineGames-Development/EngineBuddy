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
      ollamaModel: '',
      ollamaUrl: '',
      projectRoots: [],
      internet: true,
      language: 'system',
      voice: { enabled: false, voice: '', rate: 1, pitch: 1 },
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
      ollamaModel: 'qwen3:8b',
      ollamaUrl: 'http://127.0.0.1:11434',
      projectRoots: ['D:\\code'],
      internet: false,
      language: 'de',
      voice: { enabled: true, voice: 'Microsoft Katja', rate: 1.2, pitch: 0.9 },
    };
    expect(parseSettings(good)).toEqual(good);
  });

  it('resets only the bad field', () => {
    const s = parseSettings({ scale: 99, positions: { '7': { x: 10, y: 20 } } });
    expect(s.scale).toBe(1);
    expect(s.positions).toEqual({ '7': { x: 10, y: 20 } });
  });

  it('upgrades a 0.2 voice setting (no pitch yet)', () => {
    expect(parseSettings({ voice: { enabled: true, voice: 'x', rate: 1.5 } }).voice).toEqual({
      enabled: true,
      voice: 'x',
      rate: 1.5,
      pitch: 1,
    });
  });
});
