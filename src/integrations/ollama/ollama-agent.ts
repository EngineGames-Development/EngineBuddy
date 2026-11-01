// OllamaAgent: the free brain. A model running locally in Ollama (https://ollama.com), on your own
// PC: no account, no subscription, nothing leaves the machine.
//
// We talk to Ollama's /api/chat on loopback only, and run the tool loop ourselves: every tool call
// the model asks for goes through the ToolRunner (PolicyEngine, confirmation
// window, audit log). It only gets our own tools, no built-ins: no file reading beyond them and no
// internet.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { AgentEvent, AgentProvider, TurnContext, TurnInput } from '../../core/agent/agent-provider';
import { LinePicker } from '../../core/personality/personality';
import type { ToolRegistry } from '../../core/tools/tool-def';
import type { ToolRunner } from '../../security/tool-runner';

export const OLLAMA_DEFAULT_URL = 'http://127.0.0.1:11434';
export const OLLAMA_DEFAULT_MODEL = 'qwen3:8b';
/** Tool rounds per turn: enough for "check, then fix", short enough that a confused model stops. */
const MAX_ROUNDS = 8;
/** Messages kept per conversation (small models have small context windows). */
const MAX_HISTORY = 40;

export interface OllamaOptions {
  /** Must be a loopback address (checked in `isLoopbackUrl`): your conversation stays on this PC. */
  baseUrl: string;
  model: string;
  registry: ToolRegistry;
  runner: ToolRunner;
  /** The system prompt, read at the start of each conversation. */
  systemPrompt: () => string;
  /** Where conversations are kept, so reopening a chat continues it. */
  storeDir?: string;
  texts?: OllamaTexts;
  fetch?: typeof fetch;
}

interface ToolCall {
  function: { name: string; arguments: unknown };
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  images?: string[];
  tool_calls?: ToolCall[];
  tool_name?: string;
}

const chunkSchema = z.object({
  message: z
    .object({
      content: z.string().optional(),
      tool_calls: z
        .array(z.object({ function: z.object({ name: z.string(), arguments: z.unknown() }) }))
        .optional(),
    })
    .optional(),
  done: z.boolean().optional(),
  error: z.string().optional(),
});

/** Only http on this machine: nothing configurable can send the conversation elsewhere. */
export function isLoopbackUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return (
      url.protocol === 'http:' &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}

/** The agent's own messages; main passes them in the UI language (shared/i18n.ts). */
export interface OllamaTexts {
  notRunning: (model: string) => string;
  notPulled: (model: string) => string;
  noTools: (model: string) => string;
  said: (text: string) => string;
  stopHere: string;
}

const ENGLISH: OllamaTexts = {
  notRunning: (m) =>
    `I can't reach Ollama. Is it installed and running? (ollama.com, then \`ollama pull ${m}\`.)`,
  notPulled: (m) => `The model ${m} isn't downloaded yet. Run \`ollama pull ${m}\` in a terminal.`,
  noTools: (m) => `${m} can't use tools. Pick one that can in Settings, e.g. qwen3:8b or llama3.1:8b.`,
  said: (text) => `Ollama said: ${text}`,
  stopHere: "I'll stop here; that was a lot of steps. Want me to keep going?",
};

export class OllamaAgent implements AgentProvider {
  readonly id = 'local' as const;
  private messages: ChatMessage[] = [];
  private conversation: string | undefined;
  private abort: AbortController | undefined;
  private turnId: string | undefined;
  private readonly lines = new LinePicker();
  private readonly fetch: typeof fetch;
  private readonly texts: OllamaTexts;

  constructor(private readonly opts: OllamaOptions) {
    if (!isLoopbackUrl(opts.baseUrl)) throw new Error('Ollama must run on this PC (127.0.0.1).');
    this.fetch = opts.fetch ?? fetch;
    this.texts = opts.texts ?? ENGLISH;
  }

  async *startTurn(input: TurnInput, ctx: TurnContext): AsyncIterable<AgentEvent> {
    this.turnId = ctx.turnId;
    const abort = new AbortController();
    this.abort = abort;
    this.conversation ??= `ollama-${Date.now().toString(36)}`;
    if (this.messages.length === 0) this.messages.push({ role: 'system', content: this.opts.systemPrompt() });
    this.messages.push({
      role: 'user',
      content: promptFor(input),
      ...(input.images?.length ? { images: input.images.map((i) => i.data) } : {}),
    });
    yield { type: 'thinking' };

    try {
      for (let round = 0; round < MAX_ROUNDS; round++) {
        let text = '';
        let shown = 0;
        const calls: ToolCall[] = [];
        for await (const chunk of this.chat(abort.signal)) {
          if (chunk.error) throw new OllamaError(chunk.error);
          text += chunk.message?.content ?? '';
          calls.push(...(chunk.message?.tool_calls ?? []));
          // Hold back text that starts like JSON: small models often write their tool calls as
          // text instead of sending them properly (textToolCalls below).
          if (text.trimStart().startsWith('{') && !calls.length) continue;
          if (text.length > shown) {
            yield { type: 'message_delta', text: text.slice(shown) };
            shown = text.length;
          }
        }
        if (!calls.length) {
          const fromText = textToolCalls(text, (name) => this.opts.registry.get(name) !== undefined);
          if (fromText.length) {
            calls.push(...fromText);
            text = '';
          }
        }
        if (text.length > shown) yield { type: 'message_delta', text: text.slice(shown) };
        this.messages.push({
          role: 'assistant',
          content: text,
          ...(calls.length ? { tool_calls: calls } : {}),
        });
        if (!calls.length) return;

        for (const [i, call] of calls.entries()) {
          if (abort.signal.aborted) return;
          yield* this.runTool(call, `${ctx.turnId}-${round}-${i}`, abort.signal);
        }
      }
      yield { type: 'message', text: `\n\n${this.texts.stopHere}` };
    } catch (error) {
      if (abort.signal.aborted) return;
      yield { type: 'agent_error', message: this.explain(error), recoverable: true };
    } finally {
      this.trim();
      this.save();
      if (this.abort === abort) this.abort = undefined;
    }
  }

  private async *runTool(call: ToolCall, callId: string, signal: AbortSignal): AsyncIterable<AgentEvent> {
    const name = call.function.name;
    const args = parseArgs(call.function.arguments);
    const tool = this.opts.registry.get(name);
    const parsed = tool?.input.safeParse(args);
    yield { type: 'narration', text: this.lines.pick(tool?.category ?? 'default') };
    yield {
      type: 'tool_start',
      callId,
      tool: name,
      category: tool?.category ?? 'system',
      description: tool && parsed?.success ? tool.activity(parsed.data) : `Using ${name}`,
    };
    // The one gate: unknown tools and bad input are refused by the PolicyEngine.
    const out = await this.opts.runner.run(name, args, {
      ...(this.turnId ? { turnId: this.turnId } : {}),
      signal,
    });
    const ok = out.result?.ok === true;
    const summary = out.result?.summary ?? out.decision.reason;
    yield { type: 'tool_result', callId, success: ok, summary };
    this.messages.push({
      role: 'tool',
      tool_name: name,
      content: out.result ? JSON.stringify(out.result.data ?? out.result.summary) : `Refused: ${summary}`,
    });
  }

  private async *chat(signal: AbortSignal): AsyncIterable<z.infer<typeof chunkSchema>> {
    const res = await this.fetch(`${this.opts.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: this.opts.model,
        messages: this.messages,
        tools: this.toolSchemas(),
        stream: true,
        think: false,
      }),
      signal,
    });
    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => '');
      throw new OllamaError(body || `HTTP ${res.status}`, res.status);
    }
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const bytes of res.body as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(bytes, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) yield parseChunk(line);
      }
    }
    if (buffer.trim()) yield parseChunk(buffer.trim());
  }

  private toolSchemas() {
    return this.opts.registry.list().map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: z.toJSONSchema(t.input) },
    }));
  }

  private explain(error: unknown): string {
    if (error instanceof OllamaError) {
      if (error.status === 404 || /not found|pull/i.test(error.message))
        return this.texts.notPulled(this.opts.model);
      if (/does not support tools/i.test(error.message)) return this.texts.noTools(this.opts.model);
      return this.texts.said(error.message.slice(0, 200));
    }
    return this.texts.notRunning(this.opts.model);
  }

  async cancel(turnId: string): Promise<void> {
    if (turnId === this.turnId) this.abort?.abort();
  }

  conversationId(): string | undefined {
    return this.conversation;
  }

  async switchConversation(resumeId: string | undefined): Promise<void> {
    this.abort?.abort();
    this.conversation = resumeId?.startsWith('ollama-') ? resumeId : undefined;
    this.messages = this.conversation ? this.load(this.conversation) : [];
  }

  async dispose(): Promise<void> {
    this.abort?.abort();
  }

  /** Keep the system prompt and the most recent messages. Pictures are sent only in their own
   * turn: they're big, and small models' context windows aren't. */
  private trim(): void {
    const [system, ...rest] = this.messages;
    const recent = rest.slice(-MAX_HISTORY);
    // Don't start with a tool result whose call was cut off.
    while (recent[0] && recent[0].role !== 'user') recent.shift();
    this.messages = [...(system ? [system] : []), ...recent.map(withoutImages)];
  }

  private file(id: string): string | undefined {
    return this.opts.storeDir && /^ollama-[a-z0-9]+$/.test(id)
      ? join(this.opts.storeDir, `${id}.json`)
      : undefined;
  }

  private save(): void {
    const file = this.conversation && this.file(this.conversation);
    if (!file || !this.opts.storeDir) return;
    try {
      mkdirSync(this.opts.storeDir, { recursive: true });
      // Without pictures (big) and without the system prompt (rebuilt fresh, with today's date).
      const keep = this.messages.filter((m) => m.role !== 'system').map(withoutImages);
      writeFileSync(file, JSON.stringify(keep));
    } catch (error) {
      console.warn('[ollama] could not save the conversation:', error);
    }
  }

  private load(id: string): ChatMessage[] {
    const file = this.file(id);
    try {
      const stored = z
        .array(
          z.object({
            role: z.enum(['user', 'assistant', 'tool']),
            content: z.string(),
            tool_calls: z
              .array(z.object({ function: z.object({ name: z.string(), arguments: z.unknown() }) }))
              .optional(),
            tool_name: z.string().optional(),
          }),
        )
        .parse(JSON.parse(readFileSync(file ?? '', 'utf8')));
      return [{ role: 'system', content: this.opts.systemPrompt() }, ...(stored as ChatMessage[])];
    } catch {
      return [];
    }
  }
}

class OllamaError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

function parseChunk(line: string): z.infer<typeof chunkSchema> {
  try {
    return chunkSchema.parse(JSON.parse(line));
  } catch {
    return {};
  }
}

/**
 * Tool calls written as text, e.g. `{"name": "get_system_info", "arguments": {}}`, one or more,
 * and nothing else. Only names of our own tools count; they still go through the ToolRunner.
 */
export function textToolCalls(text: string, isTool: (name: string) => boolean): ToolCall[] {
  const calls: ToolCall[] = [];
  let rest = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  while (rest) {
    const end = jsonObjectEnd(rest);
    if (end < 0) return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(rest.slice(0, end + 1));
    } catch {
      return [];
    }
    const call = z
      .object({ name: z.string(), arguments: z.unknown().optional(), parameters: z.unknown().optional() })
      .safeParse(parsed);
    if (!call.success || !isTool(call.data.name)) return [];
    calls.push({
      function: { name: call.data.name, arguments: call.data.arguments ?? call.data.parameters ?? {} },
    });
    rest = rest.slice(end + 1).trim();
  }
  return calls;
}

/** Index of the brace that closes the JSON object starting at 0, or -1. */
function jsonObjectEnd(s: string): number {
  if (!s.startsWith('{')) return -1;
  let depth = 0;
  let inString = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  return -1;
}

/** Models send arguments as an object, some as a JSON string. */
function parseArgs(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw ?? {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function withoutImages(m: ChatMessage): ChatMessage {
  const rest = { ...m };
  delete rest.images;
  return rest;
}

function promptFor(input: TurnInput): string {
  if (input.intent === 'system_check')
    return 'Quick system check, please: use get_system_info, then tell me in one or two short sentences how my PC is doing, with the key numbers.';
  return input.text;
}
