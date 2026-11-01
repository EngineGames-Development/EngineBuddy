// LIVE test against your real Claude Code (uses your subscription; never an API key).
// Skipped unless EB_INTEGRATION=1:  EB_INTEGRATION=1 npx vitest run test/integration
//
// Asserts the two promises SECURITY.md makes about the Claude Code path:
//   §3   a Bash request from the model is denied by our gates, never runs, and is audited;
//   §10  a stray ANTHROPIC_API_KEY in the environment doesn't switch it to per-request billing.
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { AgentEvent } from '../../src/core/agent/agent-provider';
import { ClaudeCodeAgent } from '../../src/integrations/claude-code/claude-code-agent';
import { locateClaude } from '../../src/integrations/claude-code/environment';
import type { AuditEntry } from '../../src/security/audit/audit-log';
import { SecretPaths, canonical, type PathEnv } from '../../src/security/policy/paths';
import { PolicyEngine } from '../../src/security/policy/policy-engine';
import { ToolRunner } from '../../src/security/tool-runner';
import { createToolRegistry } from '../../src/tools';

const live = process.env['EB_INTEGRATION'] === '1';
const executable = locateClaude(process.env['CLAUDE_EXE']);

describe.skipIf(!live || !executable)('ClaudeCodeAgent (live)', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'eb-live-'));

  const env: PathEnv = {
    home: process.env['USERPROFILE'] ?? 'C:\\Users\\Default',
    appData: process.env['APPDATA'] ?? '',
    localAppData: process.env['LOCALAPPDATA'] ?? '',
    systemRoot: process.env['SystemRoot'] ?? 'C:\\Windows',
    vars: process.env,
  };
  const registry = createToolRegistry();
  const audit: AuditEntry[] = [];
  const sink = { record: (e: AuditEntry) => void audit.push(e) };
  const policy = new PolicyEngine({
    registry,
    secrets: new SecretPaths(env),
    env,
    projectRoots: [canonical(sandbox)],
    cwd: sandbox,
  });
  const agent = new ClaudeCodeAgent({
    executable: executable ?? '',
    cwd: sandbox,
    registry,
    policy,
    runner: new ToolRunner(registry, policy, sink),
    audit: sink,
    // A fake key: if it leaked through, Claude Code would try per-request billing (and fail auth).
    env: { ...process.env, ANTHROPIC_API_KEY: 'sk-ant-fake-must-be-stripped' },
  });
  afterAll(async () => {
    await agent.dispose();
    // Best effort: on Windows the folder can stay locked for a while after claude.exe exits.
    try {
      rmSync(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch (error) {
      console.warn(`[live test] left ${sandbox} behind:`, (error as Error).message);
    }
  });

  it('denies Bash through the gates, logs it, and runs on the subscription', async () => {
    const marker = join(sandbox, 'bash-ran.txt');
    const events: AgentEvent[] = [];
    for await (const e of agent.startTurn(
      { text: `Use the Bash tool to run exactly this command: echo hi > "${marker}"`, source: 'bubble' },
      { turnId: 'live-1', mode: 'companion' },
    )) {
      events.push(e);
    }
    expect(events.some((e) => e.type === 'agent_error')).toBe(false); // would include the billing refusal
    expect(existsSync(marker)).toBe(false);
    expect(audit).toContainEqual(
      expect.objectContaining({ tool: 'Bash', event: 'deny', by: 'hook', permission: 'CONFIRM' }),
    );
  }, 180_000);
});
