// First-run setup: is Ollama there, which models does it have, and downloading the recommended one
// through Ollama's own /api/pull. EngineBuddy never downloads or runs installers itself: Ollama is
// installed by the user from ollama.com, and models come from Ollama's library through Ollama.
import { z } from 'zod';
import { SETUP_MODELS, type SetupModel } from '../../shared/settings-view';

export interface OllamaStatus {
  running: boolean;
  version?: string;
  models: string[];
}

const tagsSchema = z.object({ models: z.array(z.object({ name: z.string() })) });
const versionSchema = z.object({ version: z.string() });
const pullChunk = z.object({
  status: z.string().optional(),
  total: z.number().optional(),
  completed: z.number().optional(),
  error: z.string().optional(),
});

export async function ollamaStatus(baseUrl: string, fetchFn: typeof fetch = fetch): Promise<OllamaStatus> {
  try {
    const signal = AbortSignal.timeout(3000);
    const [version, tags] = await Promise.all([
      fetchFn(`${baseUrl}/api/version`, { signal }).then((r) => r.json()),
      fetchFn(`${baseUrl}/api/tags`, { signal }).then((r) => r.json()),
    ]);
    const v = versionSchema.safeParse(version).data?.version;
    return {
      running: true,
      ...(v ? { version: v } : {}),
      models: tagsSchema.safeParse(tags).data?.models.map((m) => m.name) ?? [],
    };
  } catch {
    return { running: false, models: [] };
  }
}

/** The best model this PC can run comfortably: 8 B from 16 GB RAM, else 4 B. */
export function recommendedModel(totalMemBytes: number): SetupModel {
  return totalMemBytes >= 15 * 1024 ** 3 ? 'qwen3:8b' : 'qwen3:4b';
}

/** `qwen3:8b` is installed as `qwen3:8b`; `qwen3` alone would be `qwen3:latest`. */
export function hasModel(models: readonly string[], model: string): boolean {
  return models.includes(model) || models.includes(`${model}:latest`);
}

export interface PullProgress {
  status: string;
  /** 0–100 while downloading, undefined in other phases. */
  percent?: number;
}

/** Download a model through Ollama, reporting progress. Resolves when done; throws on failure. */
export async function pullModel(
  baseUrl: string,
  model: SetupModel,
  onProgress: (p: PullProgress) => void,
  signal: AbortSignal,
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  if (!SETUP_MODELS.includes(model)) throw new Error('not a setup model');
  const res = await fetchFn(`${baseUrl}/api/pull`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, stream: true }),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`Ollama answered ${res.status}`);
  const decoder = new TextDecoder();
  let buffer = '';
  let success = false;
  const handle = (line: string) => {
    const chunk = pullChunk.safeParse(safeJson(line));
    if (!chunk.success) return;
    if (chunk.data.error) throw new Error(chunk.data.error);
    const { status = '', total, completed } = chunk.data;
    if (status === 'success') success = true;
    onProgress({
      status,
      ...(total && completed !== undefined
        ? { percent: Math.min(100, Math.round((completed / total) * 100)) }
        : {}),
    });
  };
  for await (const bytes of res.body as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(bytes, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) handle(line);
    }
  }
  if (buffer.trim()) handle(buffer.trim());
  if (!success) throw new Error('The download stopped before it finished.');
}

function safeJson(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}
