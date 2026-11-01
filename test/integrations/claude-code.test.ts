// ClaudeCodeAgent without Claude: the translator replays transcripts recorded in spike 0b, and the
// agent runs against a fake SDK that plays those transcripts back. No tokens are spent.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Options, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';
import type { AgentEvent } from '../../src/core/agent/agent-provider';
import { LinePicker } from '../../src/core/personality/personality';
import { ToolRegistry } from '../../src/core/tools/tool-def';
import { ClaudeCodeAgent } from '../../src/integrations/claude-code/claude-code-agent';
import {
  describeTool,
  locateClaude,
  subscriptionOnlyEnv,
} from '../../src/integrations/claude-code/environment';
import { Translator } from '../../src/integrations/claude-code/translate';
import type { AuditEntry } from '../../src/security/audit/audit-log';
import { SecretPaths, canonical, type PathEnv } from '../../src/security/policy/paths';
import { PolicyEngine } from '../../src/security/policy/policy-engine';
import { ToolRunner } from '../../src/security/tool-runner';
import { createOpenInVsCode } from '../../src/tools/applications/open-in-vscode';
import { getSystemInfo } from '../../src/tools/system/get-system-info';

const fixture = (name: string): SDKMessage[] =>
  JSON.parse(readFileSync(join(__dirname, '../fixtures/claude-code', `${name}.json`), 'utf8'));

const registry = new ToolRegistry([
  getSystemInfo,
  createOpenInVsCode(
    async () => {},
    () => 'Code.exe',
  ),
]);
const lines = new LinePicker(() => 0);

function replay(name: string, opts: { interrupted?: boolean } = {}) {
  const t = new Translator(describeTool(registry), lines);
  if (opts.interrupted) t.markInterrupted();
  const events: AgentEvent[] = [];
  let end: string | undefined;
  for (const m of fixture(name)) {
    const step = t.push(m);
    events.push(...step.events);
    end ??= step.end;
  }
  const kinds = events
    .map((e) => e.type)
    .filter((k, i, all) => k !== 'message_delta' || all[i - 1] !== 'message_delta');
  return { events, kinds, end };
}

describe('translator (recorded transcripts)', () => {
  it('our MCP tool: thinking → local narration → tool → reply', () => {
    const { events, kinds, end } = replay('mcp_tool');
    expect(kinds).toEqual(['thinking', 'narration', 'tool_start', 'tool_result', 'message_delta', 'message']);
    expect(events.find((e) => e.type === 'tool_start')).toMatchObject({
      tool: 'get_system_info',
      category: 'system',
      description: 'Reading system info',
    });
    expect(events.find((e) => e.type === 'tool_result')).toMatchObject({ success: true });
    expect(end).toBe('ok');
  });

  it('a built-in Read gets an activity line from its input', () => {
    const { events, end } = replay('builtin_read');
    expect(events.find((e) => e.type === 'tool_start')).toMatchObject({
      tool: 'Read',
      category: 'filesystem',
      description: 'Reading package.json',
    });
    expect(end).toBe('ok');
  });

  it('a denied Bash becomes a failed tool_result carrying our reason', () => {
    const { events, end } = replay('bash_deny_both');
    expect(events.find((e) => e.type === 'tool_start')).toMatchObject({ tool: 'Bash', category: 'terminal' });
    expect(events.find((e) => e.type === 'tool_result')).toEqual({
      type: 'tool_result',
      callId: expect.any(String),
      success: false,
      summary: 'EngineBuddy policy (hook).',
    });
    expect(end).toBe('ok');
  });

  it('an interrupted turn ends as cancelled, not as an error', () => {
    expect(replay('interrupt', { interrupted: true })).toMatchObject({ end: 'cancelled' });
    const unexpected = replay('interrupt');
    expect(unexpected.end).toBe('error');
    expect(unexpected.kinds.at(-1)).toBe('agent_error');
  });

  it('streams text as deltas and still reports the final text', () => {
    const { events } = replay('mcp_tool');
    const streamed = events
      .filter((e) => e.type === 'message_delta')
      .map((e) => e.text)
      .join('');
    const final = events.find((e) => e.type === 'message');
    expect(final && 'text' in final && final.text).toBe(streamed);
  });
});

// --- the agent, against a fake SDK -----------------------------------------------------------------

const env: PathEnv = {
  home: 'C:\\Users\\me',
  appData: 'C:\\a',
  localAppData: 'C:\\l',
  systemRoot: 'C:\\Windows',
  vars: {},
};

function fakeSdk(opts: { apiKeySource?: string; turns: SDKMessage[][] }) {
  const calls = { options: [] as Options[], prompts: [] as string[], interrupts: 0, queries: 0 };
  const sdk = {
    tool: (
      name: string,
      description: string,
      shape: unknown,
      handler: (args: unknown) => Promise<unknown>,
    ) => ({ name, description, shape, handler }),
    createSdkMcpServer: (o: unknown) => ({ type: 'sdk', instance: o }),
    query: ({ prompt, options }: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => {
      calls.queries++;
      calls.options.push(options);
      async function* run() {
        yield {
          type: 'system',
          subtype: 'init',
          apiKeySource: opts.apiKeySource ?? 'none',
          session_id: 's1',
          model: 'fake',
          claude_code_version: '0',
        };
        let n = 0;
        for await (const u of prompt) {
          calls.prompts.push(String(u.message.content));
          for (const m of opts.turns[n++] ?? []) yield m;
        }
      }
      return Object.assign(run(), { interrupt: async () => void calls.interrupts++ });
    },
  };
  return { sdk, calls };
}

function agentWith(sdk: ReturnType<typeof fakeSdk>['sdk']) {
  const audit: AuditEntry[] = [];
  const sink = { record: (e: AuditEntry) => void audit.push(e) };
  const policy = new PolicyEngine({
    registry,
    secrets: new SecretPaths(env),
    env,
    projectRoots: [canonical('C:\\proj')],
    cwd: 'C:\\proj',
  });
  const agent = new ClaudeCodeAgent({
    executable: 'C:\\claude.exe',
    cwd: 'C:\\proj',
    registry,
    policy,
    runner: new ToolRunner(registry, policy, sink),
    audit: sink,
    env: {
      PATH: 'C:\\Windows',
      ANTHROPIC_API_KEY: 'sk-ant-should-never-be-passed',
      ANTHROPIC_BASE_URL: 'https://example.invalid',
    },
    loadSdk: async () => sdk as never,
  });
  return { agent, audit };
}

async function collect(it: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of it) out.push(e);
  return out;
}

describe('ClaudeCodeAgent (fake SDK)', () => {
  it('runs turns on one warm session, and never passes billing variables to Claude Code', async () => {
    const { sdk, calls } = fakeSdk({ turns: [fixture('mcp_tool'), fixture('builtin_read')] });
    const { agent } = agentWith(sdk);
    await agent.prewarm();

    const first = await collect(
      agent.startTurn({ text: 'how is my pc?', source: 'bubble' }, { turnId: 't1', mode: 'companion' }),
    );
    const second = await collect(
      agent.startTurn({ text: 'read package.json', source: 'bubble' }, { turnId: 't2', mode: 'companion' }),
    );

    expect(first.some((e) => e.type === 'tool_start')).toBe(true);
    expect(second.some((e) => e.type === 'tool_start' && e.tool === 'Read')).toBe(true);
    expect(calls.queries).toBe(1);
    expect(calls.prompts).toEqual(['how is my pc?', 'read package.json']);

    const options = calls.options[0]!;
    expect(options.env).toEqual({ PATH: 'C:\\Windows' });
    expect(options).toMatchObject({
      settingSources: [],
      strictMcpConfig: true,
      includePartialMessages: true,
      cwd: 'C:\\proj',
    });
    expect(options.tools).not.toContain('Grep');
    await agent.dispose();
  });

  it('refuses to run when Claude Code is not on the subscription login', async () => {
    const { sdk } = fakeSdk({ apiKeySource: 'ANTHROPIC_API_KEY', turns: [fixture('mcp_tool')] });
    const { agent } = agentWith(sdk);
    const events = await collect(
      agent.startTurn({ text: 'hi', source: 'bubble' }, { turnId: 't1', mode: 'companion' }),
    );
    expect(events).toEqual([expect.objectContaining({ type: 'agent_error', recoverable: false })]);
    // ...and keeps refusing.
    const again = await collect(
      agent.startTurn({ text: 'hi', source: 'bubble' }, { turnId: 't2', mode: 'companion' }),
    );
    expect(again).toEqual([
      expect.objectContaining({ type: 'agent_error', message: expect.stringMatching(/free way/) }),
    ]);
  });

  it('turns a menu intent into a request for the tool', async () => {
    const { sdk, calls } = fakeSdk({ turns: [fixture('mcp_tool')] });
    const { agent } = agentWith(sdk);
    await collect(
      agent.startTurn(
        { text: 'System check', source: 'menu', intent: 'system_check' },
        { turnId: 't1', mode: 'companion' },
      ),
    );
    expect(calls.prompts[0]).toMatch(/get_system_info/);
    await agent.dispose();
  });

  it('both gates deny Bash through the PolicyEngine and audit it', async () => {
    const { sdk, calls } = fakeSdk({ turns: [] });
    const { agent, audit } = agentWith(sdk);
    await agent.prewarm();
    const { hooks, canUseTool } = calls.options[0]!;
    const hook = hooks!.PreToolUse![0]!.hooks[0]!;

    const hookOut = await hook(
      {
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        tool_input: { command: 'dir C:\\' },
        tool_use_id: 'x',
        session_id: 's1',
        transcript_path: '',
        cwd: 'C:\\proj',
      } as never,
      'x',
      { signal: new AbortController().signal },
    );
    expect(hookOut).toMatchObject({
      hookSpecificOutput: {
        permissionDecision: 'deny',
        permissionDecisionReason: expect.stringMatching(/run_command/),
      },
    });

    const gate = await canUseTool!('Bash', { command: 'dir C:\\' }, {
      signal: new AbortController().signal,
    } as never);
    expect(gate).toMatchObject({ behavior: 'deny' });
    const read = await canUseTool!('Read', { file_path: 'C:\\proj\\README.md' }, {
      signal: new AbortController().signal,
    } as never);
    expect(read).toMatchObject({ behavior: 'allow' });

    expect(audit.map((a) => `${a.by}:${a.tool}:${a.event}`)).toEqual([
      'hook:Bash:deny',
      'canUseTool:Bash:deny',
      'canUseTool:Read:allow',
    ]);
    await agent.dispose();
  });

  it('cancel interrupts the session', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { sdk, calls } = fakeSdk({ turns: [] });
    const original = sdk.query;
    sdk.query = (args) => {
      const q = original(args);
      return Object.assign(q, { interrupt: async () => (calls.interrupts++, release()) });
    };
    const { agent } = agentWith(sdk);
    const events = collect(
      agent.startTurn({ text: 'long essay', source: 'bubble' }, { turnId: 't1', mode: 'companion' }),
    );
    while (calls.prompts.length === 0) await new Promise((r) => setTimeout(r, 1));
    await agent.cancel('t1');
    await gate;
    expect(calls.interrupts).toBe(1);
    await agent.dispose();
    await events;
  });
});

describe('environment', () => {
  it('strips every billing variable, case-insensitively', () => {
    expect(
      subscriptionOnlyEnv({
        PATH: 'x',
        ANTHROPIC_API_KEY: 'a',
        anthropic_auth_token: 'b',
        CLAUDE_CODE_USE_BEDROCK: '1',
        CLAUDE_CODE_USE_VERTEX: '1',
        CLAUDE_CODE_USE_FOUNDRY: '1',
        ANTHROPIC_BASE_URL: 'u',
      }),
    ).toEqual({ PATH: 'x' });
  });

  it('finds Claude Code where configured, else where the installer puts it', () => {
    expect(locateClaude('D:\\tools\\claude.exe', {}, () => true)).toBe('D:\\tools\\claude.exe');
    expect(locateClaude('D:\\missing.exe', {}, () => false)).toBeUndefined();
    expect(locateClaude(undefined, { PATH: 'C:\\bin' }, (p) => String(p) === 'C:\\bin\\claude.exe')).toBe(
      'C:\\bin\\claude.exe',
    );
  });
});
