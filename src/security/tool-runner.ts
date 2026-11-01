// Runs one of our own tools the only allowed way: validate → policy → execute → audit
// (SECURITY.md §3). The Claude Code gates have usually checked already; this checks again, so a
// tool can't run through any path that skipped them (e.g. a menu intent).
import type { ToolDef, ToolRegistry, ToolResult } from '../core/tools/tool-def';
import type { AuditSink } from './audit/audit-log';
import { MCP_SERVER, type Decision, type PolicyEngine } from './policy/policy-engine';

export interface RunOutcome {
  decision: Decision;
  tool?: ToolDef;
  result?: ToolResult;
}

export class ToolRunner {
  constructor(
    private readonly registry: ToolRegistry,
    private readonly policy: PolicyEngine,
    private readonly audit: AuditSink,
  ) {}

  async run(
    name: string,
    rawInput: unknown,
    ctx: { turnId?: string; signal: AbortSignal },
  ): Promise<RunOutcome> {
    const decision = this.policy.evaluate(`mcp__${MCP_SERVER}__${name}`, rawInput);
    const tool = this.registry.get(name);
    const base = { tool: name, input: rawInput, by: 'runner', ...(ctx.turnId ? { turnId: ctx.turnId } : {}) };
    if (!decision.allowed || !tool) {
      this.audit.record({
        ...base,
        event: 'deny',
        permission: decision.permission,
        rule: decision.rule,
        reason: decision.reason,
      });
      return { decision, ...(tool ? { tool } : {}) };
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
      event: 'result',
      ok: result.ok,
      summary: result.summary,
      durationMs: Date.now() - started,
    });
    return { decision, tool, result };
  }
}
