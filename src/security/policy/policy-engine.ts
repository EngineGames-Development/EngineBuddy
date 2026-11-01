// PolicyEngine (SECURITY.md §2–3): the single place that decides whether a tool request may run.
// Both gates on the Claude Code path (the PreToolUse hook and canUseTool) and our own tool runner
// call it. Default deny: a tool that isn't in this table, or isn't registered, can't run.
//
// CONFIRM is never `allowed` here. For our own tools that can describe the request, the decision is
// `confirmable`: the gates let it through to the ToolRunner, which asks you in the confirmation
// window before running it. Built-in CONFIRM tools (Bash, Write, …) stay denied: we don't run them,
// so we couldn't show you exactly what would run.
import { z } from 'zod';
import type { Permission, PolicyContext, ToolRegistry } from '../../core/tools/tool-def';
import { isEnvFile, isInside, normalisePath, type PathEnv, type SecretPaths } from './paths';
import { checkWebUrl } from './web';

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
  /** CONFIRM on one of our own tools: may run if you click Allow (see ToolRunner). */
  confirmable?: true;
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
  /** WebSearch / WebFetch allowed (Settings → Internet). Off unless set. */
  web?: boolean;
}

const REASONS = {
  secret: "Not touching that. It's where secrets live.",
  outside: "That's outside your project folders, and for now I only read inside them.",
  envFile: "That's a .env file. Reading those will need your OK, and I can't ask for that yet.",
  shell: 'Use run_command for that instead: it shows you the exact command and asks you first.',
  write: 'Use write_file or edit_file for that instead: they show you the change first and ask.',
  webOff: 'Internet access is switched off in my settings.',
  unknown: "That tool isn't on my list, so no.",
  badInput: "That request didn't look right, so I didn't run it.",
  badPath: "I couldn't make sense of that path, so I left it alone.",
  needsConfirm: "That needs your OK, and I can't ask for it this way.",
} as const;

// Built-in Claude Code tools. Inputs are validated loosely (Claude Code may add fields), but the
// fields we decide on must be there and be strings.
const readInput = z.object({ file_path: z.string().min(1) });
const globInput = z.object({ pattern: z.string().min(1), path: z.string().optional() });
const searchInput = z.object({ query: z.string().min(1).max(500) });
const fetchInput = z.object({ url: z.string().min(1), prompt: z.string().optional() });

const CONFIRM_BUILTINS: Record<string, keyof typeof REASONS> = {
  Bash: 'shell',
  PowerShell: 'shell',
  Write: 'write',
  Edit: 'write',
  MultiEdit: 'write',
  NotebookEdit: 'write',
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
      case 'WebSearch':
      case 'WebFetch':
        return this.evaluateWeb(toolName, rawInput);
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
    if (verdict.permission === 'CONFIRM') {
      const d = this.confirm(name, verdict.reason ?? REASONS.needsConfirm, `tool:${name}`);
      return tool.describe ? { ...d, confirmable: true } : d;
    }
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

  private evaluateWeb(tool: 'WebSearch' | 'WebFetch', rawInput: unknown): Decision {
    if (!this.opts.web) return deny(tool, 'BLOCKED', REASONS.webOff, 'web-off');
    if (tool === 'WebSearch') {
      return searchInput.safeParse(rawInput).success
        ? allow(tool, 'web-search')
        : deny(tool, 'BLOCKED', REASONS.badInput, 'invalid-input');
    }
    const parsed = fetchInput.safeParse(rawInput);
    if (!parsed.success) return deny(tool, 'BLOCKED', REASONS.badInput, 'invalid-input');
    const verdict = checkWebUrl(parsed.data.url);
    return verdict.ok ? allow(tool, 'web-fetch') : deny(tool, 'BLOCKED', verdict.reason, 'web-url');
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
