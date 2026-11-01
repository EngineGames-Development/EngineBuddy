import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { app } from 'electron';
import type { AgentProvider } from '../core/agent/agent-provider';
import { ClaudeCodeAgent } from '../integrations/claude-code/claude-code-agent';
import { locateClaude } from '../integrations/claude-code/environment';
import { MockAgent } from '../integrations/mock/mock-agent';
import { AuditLog } from '../security/audit/audit-log';
import { SecretPaths, normalisePath, type PathEnv } from '../security/policy/paths';
import { PolicyEngine } from '../security/policy/policy-engine';
import { ToolRunner } from '../security/tool-runner';
import { createToolRegistry } from '../tools';
import type { Settings } from './settings/schema';

export interface AgentSetup {
  provider: AgentProvider;
  runner: ToolRunner;
  /** Why the real agent couldn't be used, if it fell back to the mock. */
  problem?: string;
}

/**
 * Builds the tool and security stack and the agent. Claude Code works in the first project root;
 * with none configured, in an empty `userData/workspace` folder (so it can't wander anywhere).
 */
export function setUpAgent(settings: Readonly<Settings>): AgentSetup {
  const userData = app.getPath('userData');
  const env: PathEnv = {
    home: homedir(),
    appData: app.getPath('appData'),
    localAppData: process.env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local'),
    systemRoot: process.env['SystemRoot'] ?? 'C:\\Windows',
    vars: process.env,
    extra: [join(userData, 'secrets.json')],
  };

  const workspace = join(userData, 'workspace');
  mkdirSync(workspace, { recursive: true });
  const cwd = settings.projectRoots[0] ?? workspace;
  const roots = [...settings.projectRoots, workspace]
    .map((p) => normalisePath(p, { cwd, env }))
    .flatMap((n) => (n.ok ? [n.path] : []));

  const registry = createToolRegistry();
  const audit = new AuditLog(join(userData, 'logs'));
  const policy = new PolicyEngine({ registry, secrets: new SecretPaths(env), env, projectRoots: roots, cwd });
  const runner = new ToolRunner(registry, policy, audit);

  if (settings.agent === 'mock') return { provider: new MockAgent(), runner };

  const executable = locateClaude(settings.claudeExecutable);
  if (!executable) {
    return {
      provider: new MockAgent(),
      runner,
      problem:
        "I can't find Claude Code, so I'm running on my practice script. Install it, or set claudeExecutable in settings.json.",
    };
  }
  const provider = new ClaudeCodeAgent({
    executable,
    cwd,
    registry,
    policy,
    runner,
    audit,
    ...(settings.claudeModel ? { model: settings.claudeModel } : {}),
  });
  return { provider, runner };
}
