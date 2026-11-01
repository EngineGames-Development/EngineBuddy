// Runs one of our own tools the only allowed way: validate → policy → (confirm) → execute → audit
// (SECURITY.md §3). The Claude Code gates have usually checked already; this checks again, so a
// tool can't run through any path that skipped them (e.g. a menu intent).
import type { ToolDef, ToolRegistry, ToolResult } from '../core/tools/tool-def';
import type { AuditSink } from './audit/audit-log';
import type { ConfirmationBroker, ConfirmOutcome } from './confirmations/confirmation-broker';
import { MCP_SERVER, type Decision, type PolicyEngine } from './policy/policy-engine';

export interface RunOutcome {
  decision: Decision;
  tool?: ToolDef;
  result?: ToolResult;
}

const NO: Record<Exclude<ConfirmOutcome, 'allowed'>, string> = {
  denied: 'The user said no in the confirmation window. Do not retry it or try another way.',
  timeout: 'Nobody answered the confirmation in time, so it did not run.',
  cancelled: 'The turn was cancelled before anyone answered, so it did not run.',
};

export class ToolRunner {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly policy: PolicyEngine,
    private readonly audit: AuditSink,
    /** Without a broker (tests, Phase 1 setups), CONFIRM is simply denied. */
    private readonly broker?: ConfirmationBroker,
  ) {}

  async run(
    name: string,
    rawInput: unknown,
    ctx: { turnId?: string; signal: AbortSignal },
  ): Promise<RunOutcome> {
    let decision = this.policy.evaluate(`mcp__${MCP_SERVER}__${name}`, rawInput);
    const tool = this.registry.get(name);
    const base = { tool: name, input: rawInput, ...(ctx.turnId ? { turnId: ctx.turnId } : {}) };
    const deny = (d: Decision, by: string) => {
      this.audit.record({
        ...base,
        by,
        event: 'deny',
        permission: d.permission,
        rule: d.rule,
        reason: d.reason,
      });
      return { decision: d, ...(tool ? { tool } : {}) };
    };

    if (!tool) return deny(decision, 'runner');
    if (!decision.allowed) {
      if (!decision.confirmable || !this.broker || !tool.describe) return deny(decision, 'runner');
      const input = tool.input.parse(rawInput ?? {});
      const outcome = await this.broker.ask(tool.describe(input), {
        ...(ctx.turnId ? { turnId: ctx.turnId } : {}),
        signal: ctx.signal,
      });
      if (outcome !== 'allowed')
        return deny({ ...decision, reason: NO[outcome], rule: `confirm:${outcome}` }, 'user');
      decision = { ...decision, allowed: true, reason: '', rule: 'confirm:allowed' };
      this.audit.record({ ...base, by: 'user', event: 'allow', permission: 'CONFIRM', rule: decision.rule });
    }

    const started = Date.now();
    let result: ToolResult;
    try {
      result = await tool.execute(tool.input.parse(rawInput ?? {}), ctx.signal);
    } catch (error) {
      result = { ok: false, summary: `Failed: ${error instanceof Error ? error.message : String(error)}` };
    }
    this.audit.record({
      ...base,
      by: 'runner',
      event: 'result',
      ok: result.ok,
      summary: result.summary,
      durationMs: Date.now() - started,
    });
    return { decision, tool, result };
  }
}
