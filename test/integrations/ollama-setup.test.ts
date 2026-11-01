import { describe, expect, it } from 'vitest';
import {
  hasModel,
  ollamaStatus,
  pullModel,
  recommendedModel,
  type PullProgress,
} from '../../src/integrations/ollama/ollama-setup';
import { settingsCommandSchema } from '../../src/shared/commands';

const ndjson = (lines: object[]) =>
  new Response(lines.map((l) => JSON.stringify(l)).join('\n') + '\n', { status: 200 });

describe('setup assistant: Ollama', () => {
  it('reports Ollama and its models, or that it is missing', async () => {
    const up = (async (url: string) =>
      url.endsWith('/api/version')
        ? Response.json({ version: '0.40.13' })
        : Response.json({ models: [{ name: 'qwen3:8b' }] })) as unknown as typeof fetch;
    expect(await ollamaStatus('http://127.0.0.1:11434', up)).toEqual({
      running: true,
      version: '0.40.13',
      models: ['qwen3:8b'],
    });
    const down = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    expect(await ollamaStatus('http://127.0.0.1:11434', down)).toEqual({ running: false, models: [] });
  });

  it('recommends a model the PC can run', () => {
    expect(recommendedModel(32 * 1024 ** 3)).toBe('qwen3:8b');
    expect(recommendedModel(16 * 1024 ** 3)).toBe('qwen3:8b');
    expect(recommendedModel(8 * 1024 ** 3)).toBe('qwen3:4b');
    expect(hasModel(['qwen3:8b'], 'qwen3:8b')).toBe(true);
    expect(hasModel(['qwen3:latest'], 'qwen3')).toBe(true);
    expect(hasModel(['qwen3:4b'], 'qwen3:8b')).toBe(false);
  });

  it('downloads with progress, through Ollama', async () => {
    const seen: PullProgress[] = [];
    let body = '';
    const fetchFn = (async (_url: string, init: RequestInit) => {
      body = String(init.body);
      return ndjson([
        { status: 'pulling manifest' },
        { status: 'pulling abc', total: 200, completed: 50 },
        { status: 'pulling abc', total: 200, completed: 200 },
        { status: 'success' },
      ]);
    }) as unknown as typeof fetch;
    await pullModel(
      'http://127.0.0.1:11434',
      'qwen3:4b',
      (p) => seen.push(p),
      new AbortController().signal,
      fetchFn,
    );
    expect(JSON.parse(body)).toEqual({ model: 'qwen3:4b', stream: true });
    expect(seen.map((p) => p.percent)).toEqual([undefined, 25, 100, undefined]);
  });

  it('fails clearly when Ollama reports an error or stops early', async () => {
    const err = (async () => ndjson([{ error: 'disk full' }])) as unknown as typeof fetch;
    await expect(
      pullModel('http://127.0.0.1:11434', 'qwen3:4b', () => {}, new AbortController().signal, err),
    ).rejects.toThrow('disk full');
    const cut = (async () =>
      ndjson([{ status: 'pulling abc', total: 2, completed: 1 }])) as unknown as typeof fetch;
    await expect(
      pullModel('http://127.0.0.1:11434', 'qwen3:4b', () => {}, new AbortController().signal, cut),
    ).rejects.toThrow(/stopped/);
  });

  it('only accepts the offered models from the settings window', () => {
    expect(settingsCommandSchema.safeParse({ type: 'setup_pull', model: 'qwen3:8b' }).success).toBe(true);
    expect(settingsCommandSchema.safeParse({ type: 'setup_pull', model: 'evil/model:latest' }).success).toBe(
      false,
    );
    expect(settingsCommandSchema.safeParse({ type: 'setup_get_ollama', url: 'https://x' }).success).toBe(
      false,
    );
  });
});
