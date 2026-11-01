// MockAgent: plays scripted turns with realistic timing, so all UI work (avatar, bubble, menu)
// runs without Claude and without spending tokens (docs/PHASE-1.md step 5). The scripts mirror
// the Phase 1 demo: a plain question, a system check, and a refused command.
import type { AgentEvent, AgentProvider, TurnContext, TurnInput } from '../../core/agent/agent-provider';
import { sleep } from '../../core/agent/sleep';

type Step = { wait: number; event: AgentEvent } | { wait: number; stream: string };

export interface MockTiming {
  /** Multiplies every delay; tests use 0. */
  speed: number;
}

const SYSTEM_CHECK: Step[] = [
  { wait: 500, event: { type: 'thinking' } },
  { wait: 700, event: { type: 'narration', text: 'Checking your system…' } },
  {
    wait: 150,
    event: {
      type: 'tool_start',
      callId: 'mock-1',
      tool: 'get_system_info',
      category: 'system',
      description: 'Reading system info',
    },
  },
  {
    wait: 900,
    event: {
      type: 'tool_result',
      callId: 'mock-1',
      success: true,
      summary: 'CPU 23%, RAM 11/32 GB, C: 140 GB free',
    },
  },
  { wait: 300, stream: "You're fine. 23% CPU, 11 of 32 GB used, C: has 140 GB free." },
];

const REFUSED_COMMAND: Step[] = [
  { wait: 600, event: { type: 'thinking' } },
  {
    wait: 600,
    event: {
      type: 'tool_start',
      callId: 'mock-2',
      tool: 'Bash',
      category: 'terminal',
      description: 'Run a command',
    },
  },
  {
    wait: 120,
    event: {
      type: 'tool_result',
      callId: 'mock-2',
      success: false,
      summary: 'Blocked: running commands isn’t allowed yet',
    },
  },
  {
    wait: 400,
    stream: "I can't run commands yet. That needs the confirmation window, which comes in Phase 2.",
  },
];

const QUESTION: Step[] = [
  { wait: 600, event: { type: 'thinking' } },
  {
    wait: 900,
    stream:
      "A linker script tells the linker **where** each section goes in memory: `.text` here, `.data` there, the stack up top. You need one when the defaults don't match your hardware, like on a kernel or a microcontroller.",
  },
];

function scriptFor(input: TurnInput): Step[] {
  if (input.intent === 'system_check' || /\b(pc|system|computer|cpu|ram|memory)\b/i.test(input.text))
    return SYSTEM_CHECK;
  if (/\b(run|dir|terminal|command|shell)\b/i.test(input.text)) return REFUSED_COMMAND;
  return QUESTION;
}

/** Split text into small word chunks, the way a model streams. */
function chunks(text: string): string[] {
  return text.match(/\S+\s*/g) ?? [];
}

export class MockAgent implements AgentProvider {
  readonly id = 'mock' as const;
  private readonly running = new Map<string, AbortController>();

  constructor(private readonly timing: MockTiming = { speed: 1 }) {}

  async *startTurn(input: TurnInput, ctx: TurnContext): AsyncIterable<AgentEvent> {
    const abort = new AbortController();
    this.running.set(ctx.turnId, abort);
    const wait = (ms: number) => sleep(ms * this.timing.speed, abort.signal);
    try {
      for (const step of scriptFor(input)) {
        if (!(await wait(step.wait))) return;
        if ('event' in step) {
          yield step.event;
          continue;
        }
        for (const piece of chunks(step.stream)) {
          yield { type: 'message_delta', text: piece };
          if (!(await wait(35 + Math.random() * 40))) return;
        }
        yield { type: 'message', text: step.stream };
      }
    } finally {
      this.running.delete(ctx.turnId);
    }
  }

  async cancel(turnId: string): Promise<void> {
    this.running.get(turnId)?.abort();
  }

  async dispose(): Promise<void> {
    for (const abort of this.running.values()) abort.abort();
  }
}
