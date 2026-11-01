import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { AgentController } from '../../src/core/agent/agent-controller';
import { EventBus } from '../../src/core/events/event-bus';
import { ToolRegistry } from '../../src/core/tools/tool-def';
import { localToolTurn } from '../../src/integrations/local/local-tool-turn';
import { MockAgent } from '../../src/integrations/mock/mock-agent';
import type { AuditEntry } from '../../src/security/audit/audit-log';
import { SecretPaths, canonical, type PathEnv } from '../../src/security/policy/paths';
import { PolicyEngine } from '../../src/security/policy/policy-engine';
import { ToolRunner } from '../../src/security/tool-runner';
import { createOpenInVsCode } from '../../src/tools/applications/open-in-vscode';
import type { BuddyEvent } from '../../src/shared/events';

const tmp = mkdtempSync(join(tmpdir(), 'eb-local-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const env: PathEnv = {
  home: 'C:\\Users\\me',
  appData: 'C:\\a',
  localAppData: 'C:\\l',
  systemRoot: 'C:\\Windows',
  vars: {},
};

function setup() {
  const launched: string[][] = [];
  const registry = new ToolRegistry([
    createOpenInVsCode(
      async (_exe, args) => void launched.push(args),
      () => 'Code.exe',
    ),
  ]);
  const policy = new PolicyEngine({
    registry,
    secrets: new SecretPaths(env),
    env,
    projectRoots: [canonical(tmp)],
    cwd: tmp,
  });
  const audit: AuditEntry[] = [];
  const runner = new ToolRunner(registry, policy, { record: (e) => void audit.push(e) });
  const bus = new EventBus();
  const events: BuddyEvent[] = [];
  bus.on((e) => events.push(e));
  const controller = new AgentController({
    bus,
    provider: new MockAgent({ speed: 0 }),
    newTurnId: () => 't1',
  });
  return { registry, runner, controller, events, launched, audit };
}

describe('menu "Open in VS Code…" as a local turn', () => {
  it('runs the tool through policy and audit, with the same events as a model turn', async () => {
    const { registry, runner, controller, events, launched, audit } = setup();
    controller.submit(
      { text: 'Open in VS Code', source: 'menu', intent: 'open_in_vscode' },
      localToolTurn(registry, runner, 'open_in_vscode', { path: tmp }),
    );
    await controller.whenIdle();

    expect(events.map((e) => e.type)).toEqual([
      'turn_start',
      'narration',
      'tool_start',
      'tool_result',
      'message',
      'turn_end',
    ]);
    expect(events.find((e) => e.type === 'tool_result')).toMatchObject({ success: true });
    expect(launched).toEqual([[tmp]]);
    expect(audit).toEqual([expect.objectContaining({ event: 'result', tool: 'open_in_vscode', ok: true })]);
  });

  it('a blocked path fails visibly and launches nothing', async () => {
    const { registry, runner, controller, events, launched } = setup();
    controller.submit(
      { text: 'Open', source: 'menu' },
      localToolTurn(registry, runner, 'open_in_vscode', { path: 'C:\\Users\\me\\.ssh' }),
    );
    await controller.whenIdle();
    expect(events.find((e) => e.type === 'tool_result')).toMatchObject({
      success: false,
      summary: expect.stringMatching(/secrets/),
    });
    expect(events.find((e) => e.type === 'message')).toMatchObject({
      text: expect.stringMatching(/didn't work/),
    });
    expect(launched).toEqual([]);
  });
});
