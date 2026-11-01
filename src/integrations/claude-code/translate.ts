// SDK message → AgentEvent (ARCHITECTURE.md §6.2). The only file that knows the shape of Claude
// Code's messages; it's tested by replaying transcripts recorded in spike 0b, so a SDK upgrade
// that changes them shows up as a failing test, not a confused avatar.
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentEvent } from '../../core/agent/agent-provider';
import type { LinePicker } from '../../core/personality/personality';
import type { ToolCategory, TurnOutcome } from '../../shared/events';

export interface ToolInfo {
  /** Name without the `mcp__enginebuddy__` prefix. */
  tool: string;
  category: ToolCategory;
  /** Activity-list line, e.g. "Reading system info". */
  activity: string;
}

export type DescribeTool = (name: string, input: unknown) => ToolInfo;

export interface TranslatorStep {
  events: AgentEvent[];
  /** Set when this message ended the turn. */
  end?: TurnOutcome;
}

type Block = {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  is_error?: boolean;
  content?: unknown;
};

const ERROR_LINES: Record<string, string> = {
  authentication_failed:
    "I'm not logged in to Claude. Run `claude` once in a terminal, log in, then try again.",
  oauth_org_not_allowed: "Claude says this account can't be used here. Check your login with `claude`.",
  account_on_hold: 'Claude says the account is on hold.',
  verification_required: 'Claude wants you to verify your account first. Run `claude` once in a terminal.',
  billing_error: "Claude reports a billing problem with the account, so I'm stopping here.",
  rate_limit: "I've hit the usage limit for now. Try again a bit later.",
  overloaded: "Claude's servers are busy. Try again in a minute.",
  server_error: "Claude's servers had a problem. Try again in a minute.",
  model_not_found: "The configured model doesn't exist. Check `claudeModel` in settings.json.",
};

export function friendlyErrorFor(code: string | undefined): string {
  return (code && ERROR_LINES[code]) || 'Something went wrong talking to Claude. Try that again?';
}

/** "PreToolUse:Bash hook error: <our reason>" → "<our reason>". */
function toolErrorText(content: unknown): string | undefined {
  const text =
    typeof content === 'string'
      ? content
      : Array.isArray(content)
        ? content.map((c: { text?: string }) => c.text ?? '').join(' ')
        : '';
  const cleaned = text.replace(/^PreToolUse:\S+ hook error:\s*/i, '').trim();
  return cleaned ? cleaned.slice(0, 200) : undefined;
}

/** One per turn: it remembers whether the model has narrated since the last tool call. */
export class Translator {
  private thinkingSent = false;
  private narrated = false;
  private interrupted = false;

  constructor(
    private readonly describe: DescribeTool,
    private readonly lines: LinePicker,
  ) {}

  /** After `interrupt()`, the SDK ends the turn with an error result; that means "cancelled". */
  markInterrupted(): void {
    this.interrupted = true;
  }

  push(m: SDKMessage): TranslatorStep {
    // Messages from inside a subagent (parent_tool_use_id set) aren't the reply.
    if ('parent_tool_use_id' in m && m.parent_tool_use_id) return { events: [] };

    switch (m.type) {
      case 'stream_event': {
        const e = m.event;
        if (e.type === 'message_start' && !this.thinkingSent) {
          this.thinkingSent = true;
          return { events: [{ type: 'thinking' }] };
        }
        if (e.type === 'content_block_delta' && e.delta.type === 'text_delta' && e.delta.text) {
          this.narrated = true;
          return { events: [{ type: 'message_delta', text: e.delta.text }] };
        }
        return { events: [] };
      }

      case 'assistant': {
        if (m.error)
          return { events: [{ type: 'agent_error', message: friendlyErrorFor(m.error), recoverable: true }] };
        const events: AgentEvent[] = [];
        for (const block of m.message.content as Block[]) {
          if (block.type === 'text' && block.text?.trim()) {
            this.narrated = true;
            events.push({ type: 'message', text: block.text });
          } else if (block.type === 'tool_use' && block.id && block.name) {
            const info = this.describe(block.name, block.input);
            // Local narration fallback: only if the model said nothing before reaching for a tool.
            if (!this.narrated) events.push({ type: 'narration', text: this.lines.pick(info.category) });
            this.narrated = false;
            events.push({
              type: 'tool_start',
              callId: block.id,
              tool: info.tool,
              category: info.category,
              description: info.activity,
            });
          }
        }
        return { events };
      }

      case 'user': {
        const content = m.message.content;
        if (!Array.isArray(content)) return { events: [] };
        const events: AgentEvent[] = [];
        for (const block of content as Block[]) {
          if (block.type !== 'tool_result' || !block.tool_use_id) continue;
          const failed = block.is_error === true;
          const summary = failed ? toolErrorText(block.content) : undefined;
          events.push({
            type: 'tool_result',
            callId: block.tool_use_id,
            success: !failed,
            ...(summary ? { summary } : {}),
          });
        }
        return { events };
      }

      case 'result': {
        if (m.subtype === 'success' && !m.is_error) return { events: [], end: 'ok' };
        if (this.interrupted) return { events: [], end: 'cancelled' };
        return {
          events: [{ type: 'agent_error', message: friendlyErrorFor(undefined), recoverable: true }],
          end: 'error',
        };
      }

      default:
        return { events: [] };
    }
  }
}
