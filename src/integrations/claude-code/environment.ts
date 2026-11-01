// Where Claude Code is, and the environment it runs with.
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, delimiter, join } from 'node:path';
import type { ToolRegistry } from '../../core/tools/tool-def';
import { MCP_SERVER } from '../../security/policy/policy-engine';
import type { DescribeTool } from './translate';

/**
 * Variables that would make Claude Code bill per request instead of using the claude.ai
 * subscription login (SECURITY.md §10). They never reach the child process.
 */
const BILLING_ENV =
  /^(ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|ANTHROPIC_BASE_URL|CLAUDE_CODE_USE_BEDROCK|CLAUDE_CODE_USE_VERTEX|CLAUDE_CODE_USE_FOUNDRY)$/i;

export function subscriptionOnlyEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((e): e is [string, string] => e[1] !== undefined && !BILLING_ENV.test(e[0])),
  );
}

/** The configured path, else `~/.local/bin/claude.exe` (the installer's default), else PATH. */
export function locateClaude(
  configured: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
  exists = existsSync,
): string | undefined {
  if (configured) return exists(configured) ? configured : undefined;
  const candidates = [
    join(homedir(), '.local', 'bin', 'claude.exe'),
    ...(env['PATH'] ?? env['Path'] ?? '')
      .split(delimiter)
      .filter(Boolean)
      .map((dir) => join(dir, 'claude.exe')),
  ];
  return candidates.find((p) => exists(p));
}

const PREFIX = `mcp__${MCP_SERVER}__`;

/** Tool name + input → category and activity-list line. Built from the input, never from prose. */
export function describeTool(registry: ToolRegistry): DescribeTool {
  return (name, input) => {
    if (name.startsWith(PREFIX)) {
      const short = name.slice(PREFIX.length);
      const tool = registry.get(short);
      const parsed = tool?.input.safeParse(input ?? {});
      return {
        tool: short,
        category: tool?.category ?? 'system',
        activity: tool && parsed?.success ? tool.activity(parsed.data) : `Using ${short}`,
      };
    }
    const field = (key: string) => {
      const v = (input as Record<string, unknown> | null)?.[key];
      return typeof v === 'string' ? v : undefined;
    };
    switch (name) {
      case 'Read':
        return {
          tool: name,
          category: 'filesystem',
          activity: `Reading ${basename(field('file_path') ?? 'a file')}`,
        };
      case 'Glob':
        return { tool: name, category: 'filesystem', activity: 'Looking for files' };
      case 'Grep':
        return { tool: name, category: 'filesystem', activity: 'Searching the code' };
      case 'Bash':
      case 'PowerShell':
        return { tool: name, category: 'terminal', activity: 'Running a command' };
      case 'Write':
      case 'Edit':
      case 'MultiEdit':
      case 'NotebookEdit':
        return { tool: name, category: 'filesystem', activity: 'Editing a file' };
      case 'WebFetch':
      case 'WebSearch':
        return { tool: name, category: 'apps', activity: 'Looking something up online' };
      default:
        return { tool: name, category: 'system', activity: `Using ${name}` };
    }
  };
}
