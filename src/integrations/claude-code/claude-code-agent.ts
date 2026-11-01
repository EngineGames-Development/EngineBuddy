// ClaudeCodeAgent (ARCHITECTURE.md §6.2): the user's installed Claude Code, on their claude.ai
// subscription, behind the AgentProvider interface.
//
// One warm session: a long-lived `query()` in streaming-input mode, fed user messages through a
// queue. A cold start takes ~14 s to `init` (spike 0b), so the session starts in the background
// (`prewarm`) and stays up between turns. If it dies, the next turn starts a new one that resumes
// the same conversation.
//
// Both permission gates call the PolicyEngine: the PreToolUse hook (fires for every tool) and
// canUseTool (skipped for tools Claude Code auto-allows, spike 0b finding 2).
import type {
  CanUseTool,
  HookCallback,
  Options,
  Query,
  SDKMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type * as SdkModule from '@anthropic-ai/claude-agent-sdk';
import type { AgentEvent, AgentProvider, TurnContext, TurnInput } from '../../core/agent/agent-provider';
import { AsyncQueue } from '../../core/agent/async-queue';
import { LinePicker, PERSONALITY_PROMPT } from '../../core/personality/personality';
import type { ToolRegistry } from '../../core/tools/tool-def';
import type { AuditSink } from '../../security/audit/audit-log';
import { MCP_SERVER, type PolicyEngine } from '../../security/policy/policy-engine';
import type { ToolRunner } from '../../security/tool-runner';
import { describeTool, subscriptionOnlyEnv } from './environment';
import { Translator, type DescribeTool } from './translate';

type Sdk = typeof SdkModule;

export interface ClaudeCodeOptions {
  executable: string;
  /** The agent's working directory (a project root). */
  cwd: string;
  model?: string;
  registry: ToolRegistry;
  policy: PolicyEngine;
  runner: ToolRunner;
  audit: AuditSink;
  env?: NodeJS.ProcessEnv;
  /** Injected in tests. The SDK is ESM-only, so it's loaded with a dynamic import. */
  loadSdk?: () => Promise<Sdk>;
}

/** Built-ins the model can see. Bash is listed only so a request for it reaches our gates and is
 * refused visibly (and audited) instead of the model guessing it doesn't exist. */
const BUILTIN_TOOLS = ['Read', 'Glob', 'Bash'];

const NOT_SUBSCRIPTION =
  "I'm not logged in the free way, so I'm not going to run. (Claude Code isn't using your claude.ai subscription login.)";

interface Session {
  query: Query;
  input: AsyncQueue<SDKUserMessage>;
  abort: AbortController;
  /** Set once the session is over, so a turn that starts just after still finds out. */
  ended?: { error?: string };
}

type TurnMessage = SDKMessage | { type: 'session_ended'; error?: string };

interface Turn {
  turnId: string;
  messages: AsyncQueue<TurnMessage>;
  translator: Translator;
}

export class ClaudeCodeAgent implements AgentProvider {
  readonly id = 'claude-code' as const;
  private session: Session | undefined;
  private starting: Promise<Session> | undefined;
  private turn: Turn | undefined;
  private sessionId: string | undefined;
  private refusal: string | undefined;
  private readonly lines = new LinePicker();
  private readonly describe: DescribeTool;

  constructor(private readonly opts: ClaudeCodeOptions) {
    this.describe = describeTool(opts.registry);
  }

  async prewarm(): Promise<void> {
    await this.ensureSession();
  }

  async *startTurn(input: TurnInput, ctx: TurnContext): AsyncIterable<AgentEvent> {
    if (this.refusal) {
      yield { type: 'agent_error', message: this.refusal, recoverable: false };
      return;
    }
    let session: Session;
    try {
      session = await this.ensureSession();
    } catch (error) {
      yield { type: 'agent_error', message: startupError(error, this.opts.executable), recoverable: true };
      return;
    }

    const turn: Turn = {
      turnId: ctx.turnId,
      messages: new AsyncQueue(),
      translator: new Translator(this.describe, this.lines),
    };
    this.turn = turn;
    try {
      if (session.ended) {
        yield {
          type: 'agent_error',
          message: session.ended.error ?? 'Claude Code stopped. Try again?',
          recoverable: !this.refusal,
        };
        return;
      }
      session.input.push(userMessage(promptFor(input)));
      for await (const m of turn.messages) {
        if (m.type === 'session_ended') {
          if (m.error) yield { type: 'agent_error', message: m.error, recoverable: !this.refusal };
          return;
        }
        const step = turn.translator.push(m);
        yield* step.events;
        if (step.end) return;
      }
    } finally {
      if (this.turn === turn) this.turn = undefined;
    }
  }

  async cancel(turnId: string): Promise<void> {
    if (this.turn?.turnId !== turnId || !this.session) return;
    this.turn.translator.markInterrupted();
    // interrupt(), not abort: acknowledged in ~15 ms and keeps the session alive (spike 0b).
    await this.session.query.interrupt();
  }

  async dispose(): Promise<void> {
    const s = this.session;
    this.session = undefined;
    s?.input.close();
    s?.abort.abort();
  }

  // --- session ---------------------------------------------------------------------------------

  private ensureSession(): Promise<Session> {
    if (this.session) return Promise.resolve(this.session);
    this.starting ??= this.startSession().finally(() => (this.starting = undefined));
    return this.starting;
  }

  private async startSession(): Promise<Session> {
    const sdk = await (this.opts.loadSdk ?? (() => import('@anthropic-ai/claude-agent-sdk')))();
    const input = new AsyncQueue<SDKUserMessage>();
    const abort = new AbortController();
    const options: Options = {
      pathToClaudeCodeExecutable: this.opts.executable,
      cwd: this.opts.cwd,
      env: subscriptionOnlyEnv(this.opts.env ?? process.env),
      // Don't load the user's own Claude settings or claude.ai connectors (spike 0b, finding 3).
      settingSources: [],
      strictMcpConfig: true,
      tools: BUILTIN_TOOLS,
      includePartialMessages: true,
      systemPrompt: { type: 'preset', preset: 'claude_code', append: PERSONALITY_PROMPT },
      mcpServers: { [MCP_SERVER]: this.createMcpServer(sdk) },
      hooks: { PreToolUse: [{ hooks: [this.preToolUseHook] }] },
      canUseTool: this.canUseTool,
      abortController: abort,
      ...(this.opts.model ? { model: this.opts.model } : {}),
      ...(this.sessionId ? { resume: this.sessionId } : {}),
    };
    const session: Session = { query: sdk.query({ prompt: input, options }), input, abort };
    this.session = session;
    void this.pump(session);
    return session;
  }

  /** The one reader of the session's messages: route them to the running turn. */
  private async pump(session: Session): Promise<void> {
    let error: string | undefined;
    try {
      for await (const m of session.query) {
        if (m.type === 'system' && m.subtype === 'init') {
          this.sessionId = m.session_id;
          // The no-billing guarantee (SECURITY.md §10): anything but the subscription login stops here.
          if (m.apiKeySource !== 'none') {
            console.error(`[claude-code] refusing: apiKeySource is ${m.apiKeySource}`);
            this.refusal = NOT_SUBSCRIPTION;
            error = NOT_SUBSCRIPTION;
            session.abort.abort();
            break;
          }
          console.log(`[claude-code] session ready (${m.model}, Claude Code ${m.claude_code_version})`);
          continue;
        }
        if ('session_id' in m && m.session_id) this.sessionId = m.session_id;
        this.turn?.messages.push(m);
      }
    } catch (e) {
      error ??=
        session.abort.signal.aborted && !this.refusal ? undefined : startupError(e, this.opts.executable);
      if (error) console.error('[claude-code] session failed:', e);
    }
    session.ended = error ? { error } : {};
    if (this.session === session) this.session = undefined;
    this.turn?.messages.push({ type: 'session_ended', ...(error ? { error } : {}) });
  }

  // --- gates and tools -------------------------------------------------------------------------

  private readonly preToolUseHook: HookCallback = async (hookInput) => {
    if (hookInput.hook_event_name !== 'PreToolUse') return {};
    const decision = this.opts.policy.evaluate(hookInput.tool_name, hookInput.tool_input);
    this.audit('hook', hookInput.tool_name, hookInput.tool_input, decision);
    if (decision.allowed) return {};
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: decision.reason,
      },
    };
  };

  private readonly canUseTool: CanUseTool = async (toolName, toolInput) => {
    const decision = this.opts.policy.evaluate(toolName, toolInput);
    this.audit('canUseTool', toolName, toolInput, decision);
    return decision.allowed
      ? { behavior: 'allow', updatedInput: toolInput }
      : { behavior: 'deny', message: decision.reason };
  };

  private audit(by: string, tool: string, input: unknown, d: ReturnType<PolicyEngine['evaluate']>): void {
    this.opts.audit.record({
      ...(this.turn ? { turnId: this.turn.turnId } : {}),
      tool,
      input,
      event: d.allowed ? 'allow' : 'deny',
      permission: d.permission,
      by,
      rule: d.rule,
      ...(d.allowed ? {} : { reason: d.reason }),
    });
  }

  /** Our tools as an in-process MCP server. Each call goes through the ToolRunner again. */
  private createMcpServer(sdk: Sdk) {
    const tools = this.opts.registry.list().map((def) =>
      sdk.tool(def.name, def.description, def.input.shape, async (args) => {
        const turnId = this.turn?.turnId;
        const out = await this.opts.runner.run(def.name, args, {
          ...(turnId ? { turnId } : {}),
          signal: new AbortController().signal,
        });
        if (!out.result) return { content: [{ type: 'text', text: out.decision.reason }], isError: true };
        return {
          content: [{ type: 'text', text: JSON.stringify(out.result.data ?? out.result.summary) }],
          isError: !out.result.ok,
        };
      }),
    );
    // alwaysLoad: otherwise the tools hide behind ToolSearch, which policy blocks (spike 0b, finding 1).
    return sdk.createSdkMcpServer({ name: MCP_SERVER, version: '0.1.0', tools, alwaysLoad: true });
  }
}

function userMessage(text: string): SDKUserMessage {
  return { type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null };
}

/** Menu intents become a plain request, so they take the same path as typed text. */
function promptFor(input: TurnInput): string {
  if (input.intent === 'system_check') {
    return 'Quick system check, please: use get_system_info, then tell me in one or two short sentences how my PC is doing, with the key numbers (CPU %, RAM used of total, free space on C:).';
  }
  return input.text;
}

function startupError(error: unknown, executable: string): string {
  const text =
    error instanceof Error
      ? `${error.message} ${(error as NodeJS.ErrnoException).code ?? ''}`
      : String(error);
  if (/ENOENT|not found|no such file|spawn/i.test(text))
    return `I can't start Claude Code. Is it installed at ${executable}?`;
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|network/i.test(text))
    return "I can't reach Claude. Are you online?";
  if (/auth|login|401|403/i.test(text))
    return "I'm not logged in to Claude. Run `claude` once in a terminal, log in, then try again.";
  return 'Claude Code stopped unexpectedly. Try that again?';
}
