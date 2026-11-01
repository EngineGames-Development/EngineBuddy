// open_in_vscode (SAFE): open an existing file or folder in VS Code. The path is passed as one
// argument to Code.exe with execFile: no shell, nothing executed from the path itself.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, delimiter, join, resolve } from 'node:path';
import { z } from 'zod';
import type { ToolDef } from '../../core/tools/tool-def';

/**
 * Where Code.exe is. `code` on PATH is a .cmd script, which Node can't run without a shell
 * (CVE-2024-27980), so go from `…\bin\code.cmd` to the `Code.exe` next to its folder.
 */
export function findVsCode(
  env: NodeJS.ProcessEnv = process.env,
  exists: (path: string) => boolean = existsSync,
): string | undefined {
  const fromPath = (env['PATH'] ?? env['Path'] ?? '')
    .split(delimiter)
    .filter(Boolean)
    .filter((dir) => exists(join(dir, 'code.cmd')))
    .map((dir) => resolve(dir, '..', 'Code.exe'));
  const defaults = [
    env['LOCALAPPDATA'] && join(env['LOCALAPPDATA'], 'Programs', 'Microsoft VS Code', 'Code.exe'),
    env['ProgramFiles'] && join(env['ProgramFiles'], 'Microsoft VS Code', 'Code.exe'),
  ].filter((p): p is string => Boolean(p));
  return [...fromPath, ...defaults].find((p) => exists(p));
}

const input = z.object({
  path: z.string().min(1).max(1024).describe('Absolute path of an existing file or folder'),
});

export function createOpenInVsCode(
  launch = launchDetached,
  locate = findVsCode,
): ToolDef<typeof input.shape> {
  return {
    name: 'open_in_vscode',
    category: 'apps',
    description: 'Open an existing file or folder in VS Code. Takes an absolute path.',
    input,
    permission: ({ path }, ctx) =>
      ctx.isSecretPath(path)
        ? { permission: 'BLOCKED', reason: "Not opening that. It's where secrets live." }
        : { permission: 'SAFE' },
    activity: ({ path }) => `Opening ${basename(path) || path} in VS Code`,

    async execute({ path }) {
      const full = resolve(path);
      try {
        await stat(full);
      } catch {
        return { ok: false, summary: `${full} doesn't exist` };
      }
      const exe = locate();
      if (!exe) return { ok: false, summary: "Couldn't find VS Code" };
      await launch(exe, [full]);
      return { ok: true, summary: `Opened ${basename(full) || full} in VS Code`, data: { path: full } };
    },
  };
}

/** Start the program and don't wait for it (VS Code keeps running). */
function launchDetached(exe: string, args: string[]): Promise<void> {
  return new Promise((resolveLaunch, reject) => {
    // VS Code's own CLI sets this; if it leaked into our environment, Code.exe would run as Node.
    const env = { ...process.env };
    delete env['ELECTRON_RUN_AS_NODE'];
    const child = execFile(exe, args, { env, windowsHide: false });
    child.once('spawn', () => {
      child.unref();
      resolveLaunch();
    });
    child.once('error', reject);
  });
}

export const openInVsCode = createOpenInVsCode();
