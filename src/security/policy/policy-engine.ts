// PolicyEngine (SECURITY.md §2–3): the single place that decides whether a tool request may run.
// Both gates on the Claude Code path (the PreToolUse hook and canUseTool) and our own tool runner
// call it. Default deny: a tool that isn't in this table, or isn't registered, can't run.
//
// Phase 1 has no confirmation window, so CONFIRM is reported as CONFIRM but never allowed. Phase 2
// adds the ConfirmationBroker, which asks you about exactly those decisions.
import { z } from 'zod';
import type { Permission, PolicyContext, ToolRegistry } from '../../core/tools/tool-def';
import { isEnvFile, isInside, normalisePath, type PathEnv, type SecretPaths } from './paths';

/** Our in-process MCP server's name; Claude Code prefixes our tools with `mcp__<server>__`. */
export const MCP_SERVER = 'enginebuddy';
const MCP_PREFIX = `mcp__${MCP_SERVER}__`;

export interface Decision {
  /** The tool's name without the MCP prefix. */
  tool: string;
  permission: Permission;
  allowed: boolean;
  /** Friendly, for the user and the model. Always set when not allowed. */
  reason: string;
  /** Which rule decided, for the audit log. */
  rule: string;
}

export interface PolicyOptions {
  registry: ToolRegistry;
  secrets: SecretPaths;
  env: PathEnv;
  /** Folders the agent may read freely. Normalise with `normalisePath` first. */
  projectRoots: readonly string[];
  /** Relative paths in tool input resolve against this (the agent's cwd). */
  cwd: string;
  realpath?: (p: string) => string;
}

const REASONS = {
  secret: "Not touching that. It's where secrets live.",
  outside: "That's outside your project folders, and for now I only read inside them.",
  envFile: "That's a .env file. Reading those will need your OK, and I can't ask for that yet.",
  shell: "I can't run commands yet. That needs a confirmation step I don't have until Phase 2.",
  write: "I can't change files yet. That needs your OK first, and I can't ask for that until Phase 2.",
  web: "I can't go online yet. That needs your OK first, and I can't ask for that until Phase 2.",
  unknown: "That tool isn't on my list, so no.",
  badInput: "That request didn't look right, so I didn't run it.",
  badPath: "I couldn't make sense of that path, so I left it alone.",
  needsConfirm: "That needs your OK, and I can't ask for that until Phase 2.",
} as const;

// Built-in Claude Code tools. Inputs are validated loosely (Claude Code may add fields), but the
// fields we decide on must be there and be strings.
const readInput = z.object({ file_path: z.string().min(1) });
const globInput = z.object({ pattern: z.string().min(1), path: z.string().optional() });

const CONFIRM_BUILTINS: Record<string, keyof typeof REASONS> = {
  Bash: 'shell',
  PowerShell: 'shell',
  Write: 'write',
  Edit: 'write',
  MultiEdit: 'write',
  NotebookEdit: 'write',
  WebFetch: 'web',
  WebSearch: 'web',
};

export class PolicyEngine {
  constructor(private readonly opts: PolicyOptions) {}

  evaluate(toolName: string, rawInput: unknown): Decision {
    if (toolName.startsWith(MCP_PREFIX)) return this.evaluateOwn(toolName.slice(MCP_PREFIX.length), rawInput);
    switch (toolName) {
      case 'Read':
        return this.evaluateRead(rawInput);
      case 'Glob':
        return this.evaluateGlob(rawInput);
    }
    const confirmReason = CONFIRM_BUILTINS[toolName];
    if (confirmReason) return this.confirm(toolName, REASONS[confirmReason], `builtin:${toolName}`);
    // Grep is deliberately not allowed yet: it reads file contents across a whole folder, so it
    // could pull a .env file into the conversation without anyone asking for it.
    return deny(toolName, 'BLOCKED', REASONS.unknown, 'default-deny');
  }

  /** The PolicyContext handed to our own tools' permission rules. */
  readonly context: PolicyContext = {
    isSecretPath: (p) => {
      const n = this.normalise(p);
      return !n.ok || this.opts.secrets.isSecret(n.path, this.opts.projectRoots);
    },
    isInProject: (p) => {
      const n = this.normalise(p);
      return n.ok && this.inProject(n.path);
    },
  };

  private evaluateOwn(name: string, rawInput: unknown): Decision {
    const tool = this.opts.registry.get(name);
    if (!tool) return deny(name, 'BLOCKED', REASONS.unknown, 'default-deny');
    const parsed = tool.input.strict().safeParse(rawInput ?? {});
    if (!parsed.success) return deny(name, 'BLOCKED', REASONS.badInput, 'invalid-input');
    const verdict = tool.permission(parsed.data, this.context);
    if (verdict.permission === 'SAFE') return allow(name, `tool:${name}`);
    if (verdict.permission === 'CONFIRM')
      return this.confirm(name, verdict.reason ?? REASONS.needsConfirm, `tool:${name}`);
    return deny(name, 'BLOCKED', verdict.reason ?? REASONS.secret, `tool:${name}`);
  }

  private evaluateRead(rawInput: unknown): Decision {
    const parsed = readInput.safeParse(rawInput);
    if (!parsed.success) return deny('Read', 'BLOCKED', REASONS.badInput, 'invalid-input');
    return this.evaluatePath('Read', parsed.data.file_path, { reading: true });
  }

  private evaluateGlob(rawInput: unknown): Decision {
    const parsed = globInput.safeParse(rawInput);
    if (!parsed.success) return deny('Glob', 'BLOCKED', REASONS.badInput, 'invalid-input');
    const { pattern, path } = parsed.data;
    // The pattern must stay inside `path`: no absolute patterns, no climbing out with `..`.
    if (/^([a-z]:|[\\/]|~|%)/i.test(pattern) || /(^|[\\/])\.\.([\\/]|$)/.test(pattern)) {
      return deny('Glob', 'BLOCKED', REASONS.outside, 'glob-escape');
    }
    return this.evaluatePath('Glob', path ?? this.opts.cwd, { reading: false });
  }

  private evaluatePath(tool: string, rawPath: string, { reading }: { reading: boolean }): Decision {
    const n = this.normalise(rawPath);
    if (!n.ok) return deny(tool, 'BLOCKED', REASONS.badPath, `path:${n.reason}`);
    if (this.opts.secrets.isSecret(n.path, this.opts.projectRoots))
      return deny(tool, 'BLOCKED', REASONS.secret, 'secret-path');
    if (reading && isEnvFile(n.path)) return this.confirm(tool, REASONS.envFile, 'env-file');
    if (!this.inProject(n.path)) return this.confirm(tool, REASONS.outside, 'outside-project');
    return allow(tool, 'in-project');
  }

  private confirm(tool: string, reason: string, rule: string): Decision {
    return deny(tool, 'CONFIRM', reason, rule);
  }

  private normalise(p: string) {
    return normalisePath(p, {
      cwd: this.opts.cwd,
      env: this.opts.env,
      ...(this.opts.realpath ? { realpath: this.opts.realpath } : {}),
    });
  }

  private inProject(path: string): boolean {
    return this.opts.projectRoots.some((root) => isInside(path, root));
  }
}

function allow(tool: string, rule: string): Decision {
  return { tool, permission: 'SAFE', allowed: true, reason: '', rule };
}

function deny(tool: string, permission: Permission, reason: string, rule: string): Decision {
  return { tool, permission, allowed: false, reason, rule };
}
