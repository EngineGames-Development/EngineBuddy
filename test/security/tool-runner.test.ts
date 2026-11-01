import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ToolRegistry, type ToolDef } from '../../src/core/tools/tool-def';
import { createOpenInVsCode, findVsCode } from '../../src/tools/applications/open-in-vscode';
import { getSystemInfo } from '../../src/tools/system/get-system-info';
import { AuditLog, redact, type AuditEntry } from '../../src/security/audit/audit-log';
import { SecretPaths, canonical, type PathEnv } from '../../src/security/policy/paths';
import { PolicyEngine } from '../../src/security/policy/policy-engine';
import { ToolRunner } from '../../src/security/tool-runner';

const tmp = mkdtempSync(join(tmpdir(), 'eb-test-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const env: PathEnv = {
  home: 'C:\\Users\\me',
  appData: 'C:\\a',
  localAppData: 'C:\\l',
  systemRoot: 'C:\\Windows',
  vars: {},
};

const exploding: ToolDef = {
  name: 'explode',
  category: 'system',
  description: 'always throws',
  input: z.object({}),
  permission: () => ({ permission: 'SAFE' }),
  activity: () => 'Exploding',
  execute: async () => {
    throw new Error('kaboom');
  },
};

function setup() {
  const launched: Array<[string, string[]]> = [];
  const vscode = createOpenInVsCode(
    async (exe, args) => void launched.push([exe, args]),
    () => 'C:\\VS Code\\Code.exe',
  );
  const registry = new ToolRegistry([getSystemInfo, vscode, exploding]);
  const policy = new PolicyEngine({
    registry,
    secrets: new SecretPaths(env),
    env,
    projectRoots: [canonical(tmp)],
    cwd: tmp,
  });
  const entries: AuditEntry[] = [];
  const runner = new ToolRunner(registry, policy, { record: (e) => entries.push(e) });
  const run = (name: string, input: unknown) =>
    runner.run(name, input, { turnId: 't1', signal: new AbortController().signal });
  return { run, entries, launched };
}

describe('ToolRunner', () => {
  it('runs get_system_info and audits the result', async () => {
    const { run, entries } = setup();
    const out = await run('get_system_info', {});
    expect(out.result?.ok).toBe(true);
    expect(out.result?.data).toMatchObject({
      cpu: { cores: expect.any(Number) },
      memory: { totalGB: expect.any(Number) },
    });
    expect(out.result?.summary).toMatch(/^CPU \d+%, RAM [\d.]+\/[\d.]+ GB/);
    expect(entries).toEqual([
      expect.objectContaining({ event: 'result', tool: 'get_system_info', ok: true, turnId: 't1' }),
    ]);
  });

  it('opens an existing folder in VS Code with the path as a single argument', async () => {
    const { run, launched } = setup();
    const out = await run('open_in_vscode', { path: tmp });
    expect(out.result?.ok).toBe(true);
    expect(launched).toEqual([['C:\\VS Code\\Code.exe', [tmp]]]);
  });

  it('refuses a path that does not exist, without launching anything', async () => {
    const { run, launched } = setup();
    const out = await run('open_in_vscode', { path: join(tmp, 'nope') });
    expect(out.result?.ok).toBe(false);
    expect(launched).toEqual([]);
  });

  it('denies blocked input and audits the denial, without executing', async () => {
    const { run, entries, launched } = setup();
    const out = await run('open_in_vscode', { path: 'C:\\Users\\me\\.ssh' });
    expect(out.decision.allowed).toBe(false);
    expect(out.result).toBeUndefined();
    expect(launched).toEqual([]);
    expect(entries[0]).toMatchObject({ event: 'deny', permission: 'BLOCKED', tool: 'open_in_vscode' });
  });

  it('turns a throwing tool into a failed result', async () => {
    const { run, entries } = setup();
    const out = await run('explode', {});
    expect(out.result).toEqual({ ok: false, summary: 'Failed: kaboom' });
    expect(entries[0]).toMatchObject({ event: 'result', ok: false });
  });
});

describe('findVsCode', () => {
  it('goes from code.cmd on PATH to the Code.exe next to its bin folder', () => {
    const files = new Set(['C:\\Apps\\VS Code\\bin\\code.cmd', 'C:\\Apps\\VS Code\\Code.exe']);
    const exe = findVsCode({ PATH: 'C:\\Windows;C:\\Apps\\VS Code\\bin' }, (p) => files.has(p));
    expect(exe).toBe('C:\\Apps\\VS Code\\Code.exe');
  });

  it('is undefined when VS Code is not installed', () => {
    expect(findVsCode({ PATH: 'C:\\Windows' }, () => false)).toBeUndefined();
  });
});

describe('AuditLog', () => {
  it('redacts secret-looking keys and cuts long strings', () => {
    expect(
      redact({ path: 'x', apiKey: 'sk-123', nested: { authToken: 'abc' }, long: 'y'.repeat(400) }),
    ).toEqual({
      path: 'x',
      apiKey: '[redacted]',
      nested: { authToken: '[redacted]' },
      long: `${'y'.repeat(300)}…(400)`,
    });
  });

  it('appends JSON lines to a daily file and prunes files older than 30 days', () => {
    const dir = join(tmp, 'logs');
    const now = new Date(2026, 10, 1, 12, 0, 0);
    const log = new AuditLog(dir, () => now);
    writeFileSync(join(dir, 'audit-2026-09-01.jsonl'), '');
    writeFileSync(join(dir, 'audit-2026-10-20.jsonl'), '');
    new AuditLog(dir, () => now); // pruning happens on open
    log.record({ tool: 'Bash', input: { command: 'dir' }, event: 'deny', by: 'hook', permission: 'CONFIRM' });

    expect(readdirSync(dir).sort()).toEqual(['audit-2026-10-20.jsonl', 'audit-2026-11-01.jsonl']);
    const line = JSON.parse(readFileSync(join(dir, 'audit-2026-11-01.jsonl'), 'utf8').trim());
    expect(line).toMatchObject({ tool: 'Bash', event: 'deny', by: 'hook', input: { command: 'dir' } });
    expect(line.ts).toBe(now.toISOString());
  });
});
