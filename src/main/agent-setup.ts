import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { app } from 'electron';
import type { AgentProvider } from '../core/agent/agent-provider';
import type { ToolRegistry } from '../core/tools/tool-def';
import { MockAgent } from '../integrations/mock/mock-agent';
import { AuditLog } from '../security/audit/audit-log';
import { commandEnv } from '../security/command-env';
import type { ConfirmationBroker } from '../security/confirmations/confirmation-broker';
import { classifyCommand } from '../security/policy/command-classifier';
import { SecretPaths, normalisePath, type PathEnv } from '../security/policy/paths';
import { PolicyEngine } from '../security/policy/policy-engine';
import { ToolRunner } from '../security/tool-runner';
import { createToolRegistry } from '../tools';
import type { MemoryStore } from '../tools/memory/memory';
import { PERSONALITY_PROMPT, contextPrompt } from '../core/personality/personality';
import {
  OLLAMA_DEFAULT_MODEL,
  OLLAMA_DEFAULT_URL,
  OllamaAgent,
  isLoopbackUrl,
} from '../integrations/ollama/ollama-agent';
import { LANGUAGE_NAMES, translator, type Lang } from '../shared/i18n';
import type { Settings } from './settings/schema';

/** Ollama's address: the configured one if it's on this PC, else the default. */
export function ollamaBaseUrl(settings: Readonly<Settings>): string {
  return settings.ollamaUrl && isLoopbackUrl(settings.ollamaUrl) ? settings.ollamaUrl : OLLAMA_DEFAULT_URL;
}

export interface AgentSetup {
  provider: AgentProvider;
  registry: ToolRegistry;
  runner: ToolRunner;
  /** Why the real agent couldn't be used, if it fell back to the mock. */
  problem?: string;
}

/**
 * Builds the tool and security stack and the agent. It works in the first project root;
 * with none configured, in an empty `userData/workspace` folder (so it can't wander anywhere).
 */
export function setUpAgent(
  settings: Readonly<Settings>,
  broker: ConfirmationBroker,
  memory: MemoryStore,
  lang: Lang = 'en',
): AgentSetup {
  const t = translator(lang);
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

  const registry = createToolRegistry({
    defaultCwd: cwd,
    classify: classifyCommand,
    systemRoot: env.systemRoot,
    // Approved commands don't get AI service keys (SECURITY.md §10).
    env: () => commandEnv(process.env),
    memory,
    web: { enabled: settings.internet, lang },
  });
  const audit = new AuditLog(join(userData, 'logs'));
  const policy = new PolicyEngine({
    registry,
    secrets: new SecretPaths(env),
    env,
    projectRoots: roots,
    cwd,
  });
  const runner = new ToolRunner(registry, policy, audit, broker);

  if (settings.agent === 'mock') return { provider: new MockAgent(), registry, runner };

  const context = () =>
    contextPrompt({
      now: new Date(),
      language: LANGUAGE_NAMES[lang],
      internet: settings.internet,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });

  const provider = new OllamaAgent({
    // Only loopback: the conversation stays on this PC.
    baseUrl: ollamaBaseUrl(settings),
    model: settings.ollamaModel || OLLAMA_DEFAULT_MODEL,
    registry,
    runner,
    storeDir: join(userData, 'ollama'),
    texts: {
      notRunning: (model) => t('ollama.notRunning', { model }),
      notPulled: (model) => t('ollama.notPulled', { model }),
      noTools: (model) => t('ollama.noTools', { model }),
      said: (text) => t('ollama.said', { text }),
      stopHere: t('ollama.stopHere'),
    },
    systemPrompt: () => PERSONALITY_PROMPT + context() + memory.promptSection(),
  });
  return { provider, registry, runner };
}
