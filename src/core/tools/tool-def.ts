// The shape of a tool (ARCHITECTURE.md §7). Defined in core so that `security` (which decides)
// and `tools` (which implement) share it without importing each other.
import type { z } from 'zod';
import type { ConfirmationRequest, ToolCategory } from '../../shared/events';

export type Permission = 'SAFE' | 'CONFIRM' | 'BLOCKED';

/** What a tool's permission rule may ask about the input. Paths are normalised before checking. */
export interface PolicyContext {
  isSecretPath(path: string): boolean;
  isInProject(path: string): boolean;
}

export interface PermissionVerdict {
  permission: Permission;
  /** Friendly, shown to the user and the model when the answer is no. */
  reason?: string;
}

export interface ToolResult {
  ok: boolean;
  /** One line for the activity list and audit log, e.g. "CPU 23%, RAM 11/32 GB". */
  summary: string;
  /** What the model gets back (serialised as JSON). */
  data?: unknown;
}

// `any` here so a registry can hold tools with different input types; each ToolDef is still
// fully typed where it's written, and input is always parsed by its own schema before use.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface ToolDef<Shape extends z.ZodRawShape = any> {
  /** Unique name, as the model sees it (inside the `enginebuddy` MCP server). */
  name: string;
  category: ToolCategory;
  /** For the model. */
  description: string;
  /** Validated before policy and before execute. Strict: unknown keys are rejected. */
  input: z.ZodObject<Shape>;
  permission(input: z.infer<z.ZodObject<Shape>>, ctx: PolicyContext): PermissionVerdict;
  /** The activity-list line, built from the input (never from model prose). */
  activity(input: z.infer<z.ZodObject<Shape>>): string;
  /**
   * What the confirmation window shows (SECURITY.md §5), built from the validated input: the
   * literal command, the exact paths. Required for any tool whose permission can be CONFIRM;
   * without it, CONFIRM is denied.
   */
  describe?(input: z.infer<z.ZodObject<Shape>>): ConfirmationRequest;
  execute(input: z.infer<z.ZodObject<Shape>>, signal: AbortSignal): Promise<ToolResult>;
}

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDef>();

  constructor(tools: readonly ToolDef[] = []) {
    for (const t of tools) this.register(t);
  }

  register(tool: ToolDef): void {
    if (this.tools.has(tool.name)) throw new Error(`duplicate tool: ${tool.name}`);
    this.tools.set(tool.name, tool);
  }

  get(name: string): ToolDef | undefined {
    return this.tools.get(name);
  }

  list(): ToolDef[] {
    return [...this.tools.values()];
  }
}
