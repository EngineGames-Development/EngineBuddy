import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { AgentEvent } from '../../src/core/agent/agent-provider';
import { ToolRegistry } from '../../src/core/tools/tool-def';
import { OllamaAgent, isLoopbackUrl, textToolCalls } from '../../src/integrations/ollama/ollama-agent';
import type { AuditEntry } from '../../src/security/audit/audit-log';
import { SecretPaths, canonical, type PathEnv } from '../../src/security/policy/paths';
import { PolicyEngine } from '../../src/security/policy/policy-engine';
import { ToolRunner } from '../../src/security/tool-runner';
import { getSystemInfo } from '../../src/tools/system/get-system-info';

const tmp = mkdtempSync(join(tmpdir(), 'eb-ollama-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const env: PathEnv = {
  home: 'C:\\Users\\me',
  appData: 'C:\\a',
  localAppData: 'C:\\l',
  systemRoot: 'C:\\Windows',
  vars: {},
};

/** A fake Ollama: each request gets the next scripted list of NDJSON chunks. */
function fakeOllama(script: object[][]) {
  const requests: {
    url: string;
    body: { messages: { role: string; images?: string[] }[]; tools: unknown[] };
  }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    requests.push({ url, body: JSON.parse(String(init.body)) });
    const chunks = script.shift();
    if (!chunks) return new Response('model "x" not found, try pulling it first', { status: 404 });
    const text = chunks.map((c) => JSON.stringify(c) + '\n').join('');
    // Split mid-line, like a real stream can.
    const mid = Math.floor(text.length / 2);
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text.slice(0, mid)));
        controller.enqueue(new TextEncoder().encode(text.slice(mid)));
        controller.close();
      },
    });
    return new Response(body, { status: 200 });
  }) as unknown as typeof fetch;
  return { fetchFn, requests };
}

function setup(script: object[][]) {
  const registry = new ToolRegistry([getSystemInfo]);
  const policy = new PolicyEngine({
    registry,
    secrets: new SecretPaths(env),
    env,
    projectRoots: [canonical(tmp)],
    cwd: tmp,
  });
  const audit: AuditEntry[] = [];
  const runner = new ToolRunner(registry, policy, { record: (e) => void audit.push(e) });
  const { fetchFn, requests } = fakeOllama(script);
  const agent = new OllamaAgent({
    baseUrl: 'http://127.0.0.1:11434',
    model: 'qwen3:8b',
    registry,
    runner,
    systemPrompt: () => 'SYSTEM',
    storeDir: join(tmp, 'store'),
    fetch: fetchFn,
  });
  return { agent, requests, audit };
}

async function run(agent: OllamaAgent, text: string, turnId = 't1') {
  const events: AgentEvent[] = [];
  for await (const e of agent.startTurn({ text, source: 'chat' }, { turnId, mode: 'companion' }))
    events.push(e);
  return events;
}

const say = (content: string, done = false) => ({ message: { role: 'assistant', content }, done });

describe('OllamaAgent', () => {
  it('streams a plain reply', async () => {
    const { agent, requests } = setup([[say('Hey, '), say('all good.'), say('', true)]]);
    const events = await run(agent, 'hi');
    const text = events.flatMap((e) => (e.type === 'message_delta' ? [e.text] : [])).join('');
    expect(text).toBe('Hey, all good.');
    expect(requests[0]!.url).toBe('http://127.0.0.1:11434/api/chat');
    expect(requests[0]!.body.messages.map((m) => m.role)).toEqual(['system', 'user']);
    expect(requests[0]!.body.tools).toHaveLength(1);
  });

  it('runs a tool call through the ToolRunner and sends the result back', async () => {
    const { agent, requests, audit } = setup([
      [
        {
          message: {
            role: 'assistant',
            content: '',
            tool_calls: [{ function: { name: 'get_system_info', arguments: {} } }],
          },
          done: true,
        },
      ],
      [say('CPU is fine.', true)],
    ]);
    const events = await run(agent, 'how is my pc?');
    expect(events.map((e) => e.type)).toContain('tool_start');
    const result = events.find((e) => e.type === 'tool_result');
    expect(result).toMatchObject({ success: true });
    expect(audit.some((a) => a.tool === 'get_system_info' && a.event === 'result')).toBe(true);
    expect(requests[1]!.body.messages.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'tool']);
  });

  it('refuses tools that are not ours (default deny), and tells the model', async () => {
    const { agent, requests, audit } = setup([
      [
        {
          message: {
            content: '',
            tool_calls: [{ function: { name: 'Bash', arguments: '{"command":"del /s C:\\\\"}' } }],
          },
        },
      ],
      [say('Okay, I can not.', true)],
    ]);
    const events = await run(agent, 'wipe it');
    expect(events.find((e) => e.type === 'tool_result')).toMatchObject({ success: false });
    expect(audit.find((a) => a.tool === 'Bash')?.event).toBe('deny');
    const toolMsg = requests[1]!.body.messages.at(-1) as { role: string; content: string };
    expect(toolMsg.role).toBe('tool');
    expect(toolMsg.content).toMatch(/^Refused/);
  });

  it('explains a missing model and an unreachable Ollama', async () => {
    const { agent } = setup([]);
    expect((await run(agent, 'hi')).at(-1)).toMatchObject({
      type: 'agent_error',
      message: expect.stringMatching(/ollama pull qwen3:8b/),
    });

    const offline = new OllamaAgent({
      baseUrl: 'http://127.0.0.1:1',
      model: 'm',
      registry: new ToolRegistry([]),
      runner: setup([]).agent['opts'].runner,
      systemPrompt: () => '',
      fetch: (async () => {
        throw new TypeError('fetch failed');
      }) as unknown as typeof fetch,
    });
    expect((await run(offline, 'hi')).at(-1)).toMatchObject({
      type: 'agent_error',
      message: expect.stringMatching(/reach Ollama/),
    });
  });

  it('keeps a conversation across a restart, without pictures', async () => {
    const first = setup([[say('Noted.', true)], [say('Ok.', true)]]);
    const pic = { mediaType: 'image/png' as const, data: 'AAAA' };
    for await (const _ of first.agent.startTurn(
      { text: 'my name is Leo', source: 'chat', images: [pic] },
      { turnId: 'a', mode: 'companion' },
    ))
      void _;
    await run(first.agent, 'ok', 'b');
    // Only the newest message still carries its picture.
    expect(first.requests[1]!.body.messages.some((m) => m.images)).toBe(false);
    const id = first.agent.conversationId()!;
    expect(readdirSync(join(tmp, 'store'))).toContain(`${id}.json`);

    const second = setup([[say('Hi Leo.', true)]]);
    await second.agent.switchConversation(id);
    await run(second.agent, 'who am I?');
    const sent = second.requests[0]!.body.messages;
    expect(sent[0]!.role).toBe('system');
    expect(sent.some((m) => m.images)).toBe(false);
    expect(JSON.stringify(sent)).toContain('my name is Leo');
  });

  it('understands tool calls a small model writes as text, and hides the JSON', async () => {
    const { agent, audit } = setup([
      [say('{"name": "get_system_info", '), say('"arguments": {}}', true)],
      [say('Alles gut.', true)],
    ]);
    const events = await run(agent, 'wie gehts meinem pc?');
    const text = events.flatMap((e) => (e.type === 'message_delta' ? [e.text] : [])).join('');
    expect(text).toBe('Alles gut.');
    expect(audit.some((a) => a.tool === 'get_system_info' && a.event === 'result')).toBe(true);
  });

  it('only treats JSON naming one of our tools as a call', () => {
    const ours = (n: string) => n === 'get_system_info';
    expect(
      textToolCalls('{"name":"get_system_info","arguments":{}}\n{"name":"get_system_info"}', ours),
    ).toHaveLength(2);
    expect(textToolCalls('```json\n{"name":"get_system_info","parameters":{"x":1}}\n```', ours)).toEqual([
      { function: { name: 'get_system_info', arguments: { x: 1 } } },
    ]);
    expect(textToolCalls('{"name":"Bash","arguments":{}}', ours)).toEqual([]);
    expect(textToolCalls('{"name":"get_system_info"} and some words', ours)).toEqual([]);
    expect(textToolCalls('{"a": "}"}', ours)).toEqual([]);
    expect(textToolCalls('Hello', ours)).toEqual([]);
  });

  it('a chat switch mid-turn leaves the new chat alone', async () => {
    const { agent } = setup([[say('first', true)], [say('slow ', false), say('reply', true)]]);
    await run(agent, 'one');
    const first = agent.conversationId()!;
    const turn = agent.startTurn({ text: 'two', source: 'chat' }, { turnId: 't2', mode: 'companion' });
    const it = turn[Symbol.asyncIterator]();
    await it.next(); // thinking
    await agent.switchConversation(undefined);
    while (!(await it.next()).done);
    expect(agent.conversationId()).toBeUndefined();
    await agent.switchConversation(first);
    expect(agent.conversationId()).toBe(first);
  });

  it('starts Ollama when it is installed but not running, then answers', async () => {
    let started = false;
    const fetchFn = (async () => {
      if (!started) throw new TypeError('fetch failed');
      return new Response(JSON.stringify(say('Da bin ich.', true)) + '\n');
    }) as unknown as typeof fetch;
    const agent = new OllamaAgent({
      baseUrl: 'http://127.0.0.1:11434',
      model: 'qwen3:8b',
      registry: new ToolRegistry([]),
      runner: {} as ToolRunner,
      systemPrompt: () => '',
      fetch: fetchFn,
      ensureRunning: async () => (started = true),
    });
    const events = await run(agent, 'hallo');
    expect(started).toBe(true);
    expect(events.filter((e) => e.type === 'message_delta').map((e) => e.text)).toEqual(['Da bin ich.']);
  });

  it('only talks to Ollama on this PC', () => {
    expect(isLoopbackUrl('http://127.0.0.1:11434')).toBe(true);
    expect(isLoopbackUrl('http://localhost:11434')).toBe(true);
    expect(isLoopbackUrl('http://192.168.1.5:11434')).toBe(false);
    expect(isLoopbackUrl('https://ollama.example.com')).toBe(false);
    expect(isLoopbackUrl('http://user:pw@127.0.0.1')).toBe(false);
    expect(() => setupWithUrl('http://evil.example')).toThrow();
  });
});

function setupWithUrl(baseUrl: string) {
  return new OllamaAgent({
    baseUrl,
    model: 'm',
    registry: new ToolRegistry([]),
    runner: {} as ToolRunner,
    systemPrompt: () => '',
  });
}
