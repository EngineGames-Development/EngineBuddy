// read_file and list_files (SAFE): look at files in your project folders, nowhere else. Secret
// places, .env files and .git are refused, compared the way Windows resolves names (file-edits.ts).
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { z } from 'zod';
import type { PermissionVerdict, PolicyContext, ToolDef } from '../../core/tools/tool-def';
import { isEnvName, windowsSegments } from './file-edits';

/** Enough for a source file; a small model's context can't take much more anyway. */
const MAX_READ_BYTES = 200_000;
const MAX_ENTRIES = 300;

export interface ReadToolOptions {
  defaultCwd: string;
}

const readInput = z.object({
  path: z.string().min(1).max(1024).describe('Path of the file (absolute, or relative to the project)'),
});

const listInput = z.object({
  path: z
    .string()
    .max(1024)
    .optional()
    .describe('Folder to list (absolute, or relative to the project). Empty: the project folder'),
});

function readPermission(p: string, ctx: PolicyContext): PermissionVerdict {
  if (ctx.isSecretPath(p))
    return { permission: 'BLOCKED', reason: "Not touching that. It's where secrets live." };
  if (isEnvName(p)) return { permission: 'BLOCKED', reason: "I don't read .env files. They hold secrets." };
  if (windowsSegments(p).includes('.git'))
    return { permission: 'BLOCKED', reason: "I don't look inside .git; ask me about the code instead." };
  if (!ctx.isInProject(p))
    return {
      permission: 'BLOCKED',
      reason: "That's outside your project folders. Add the folder in Settings first.",
    };
  return { permission: 'SAFE' };
}

export function createReadTools(opts: ReadToolOptions): ToolDef[] {
  const full = (p: string) => resolve(opts.defaultCwd, p);

  const readFileTool: ToolDef<typeof readInput.shape> = {
    name: 'read_file',
    category: 'filesystem',
    description:
      "Read a text file in the user's project folders. Use list_files first if you don't know the name.",
    input: readInput,
    permission: ({ path }, ctx) => readPermission(path, ctx),
    activity: ({ path }) => `Reading ${basename(path)}`,
    async execute({ path }) {
      const target = full(path);
      const info = await stat(target).catch(() => undefined);
      if (!info?.isFile()) return { ok: false, summary: `${basename(target)} doesn't exist` };
      const raw = await readFile(target);
      const cut = raw.length > MAX_READ_BYTES;
      const text = raw.subarray(0, MAX_READ_BYTES).toString('utf8');
      if (text.includes('\u0000')) return { ok: false, summary: `${basename(target)} isn't a text file` };
      return {
        ok: true,
        summary: `Read ${basename(target)}${cut ? ' (first part)' : ''}`,
        data: { path: target, content: text, ...(cut ? { truncated: true } : {}) },
      };
    },
  };

  const listFilesTool: ToolDef<typeof listInput.shape> = {
    name: 'list_files',
    category: 'filesystem',
    description: "List the files and folders in a folder of the user's projects (not recursive).",
    input: listInput,
    permission: ({ path }, ctx) => readPermission(path || opts.defaultCwd, ctx),
    activity: ({ path }) => `Looking in ${basename(path || opts.defaultCwd)}`,
    async execute({ path }) {
      const target = full(path || opts.defaultCwd);
      const entries = await readdir(target, { withFileTypes: true }).catch(() => undefined);
      if (!entries) return { ok: false, summary: `${basename(target)} isn't a folder I can open` };
      const shown = entries
        .filter((e) => e.name !== '.git')
        .slice(0, MAX_ENTRIES)
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
      return {
        ok: true,
        summary: `${entries.length} entries in ${basename(target)}`,
        data: { path: target, entries: shown, ...(entries.length > MAX_ENTRIES ? { more: true } : {}) },
      };
    },
  };

  return [readFileTool, listFilesTool];
}
