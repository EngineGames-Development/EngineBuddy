// open_application (SAFE): start one of a fixed list of everyday programs, optionally in a folder.
// The model picks a name from the list; it never supplies a path to an executable or arguments.
// Anything else needs run_command, which asks you first.
import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import type { ToolDef } from '../../core/tools/tool-def';
import { launchDetached, type Launcher } from './launch';
import { findVsCode } from './open-in-vscode';

export const APPS = ['explorer', 'terminal', 'vscode', 'notepad', 'task_manager', 'calculator'] as const;
export type AppId = (typeof APPS)[number];

const LABELS: Record<AppId, string> = {
  explorer: 'File Explorer',
  terminal: 'Terminal',
  vscode: 'VS Code',
  notepad: 'Notepad',
  task_manager: 'Task Manager',
  calculator: 'Calculator',
};

/** Apps that can open in a folder. */
const TAKES_FOLDER: ReadonlySet<AppId> = new Set(['explorer', 'terminal', 'vscode']);

interface Plan {
  exe: string;
  args: string[];
  cwd?: string;
}

export interface AppEnv {
  systemRoot: string;
  localAppData: string;
  exists: (p: string) => boolean;
  findVsCode: () => string | undefined;
}

const defaultEnv = (): AppEnv => ({
  systemRoot: process.env['SystemRoot'] ?? 'C:\\Windows',
  localAppData: process.env['LOCALAPPDATA'] ?? '',
  exists: existsSync,
  findVsCode: () => findVsCode(),
});

/** Exactly which executable runs, with which arguments. Pure, so it's unit-tested. */
export function planLaunch(app: AppId, folder: string | undefined, env: AppEnv): Plan | undefined {
  const sys32 = join(env.systemRoot, 'System32');
  const explorer = join(env.systemRoot, 'explorer.exe');
  switch (app) {
    case 'explorer':
      return { exe: explorer, args: folder ? [folder] : [] };
    case 'terminal': {
      const wt = join(env.localAppData, 'Microsoft', 'WindowsApps', 'wt.exe');
      if (env.exists(wt)) return { exe: wt, args: folder ? ['-d', folder] : [] };
      const ps = join(sys32, 'WindowsPowerShell', 'v1.0', 'powershell.exe');
      return { exe: ps, args: ['-NoLogo', '-NoExit'], ...(folder ? { cwd: folder } : {}) };
    }
    case 'vscode': {
      const code = env.findVsCode();
      return code ? { exe: code, args: folder ? [folder] : [] } : undefined;
    }
    case 'notepad':
      return { exe: join(sys32, 'notepad.exe'), args: [] };
    // Task Manager auto-elevates; starting it through Explorer lets Windows handle that.
    case 'task_manager':
      return { exe: explorer, args: [join(sys32, 'taskmgr.exe')] };
    case 'calculator':
      return { exe: join(sys32, 'calc.exe'), args: [] };
  }
}

const input = z.object({
  app: z.enum(APPS).describe(`One of: ${APPS.join(', ')}`),
  folder: z
    .string()
    .min(1)
    .max(1024)
    .optional()
    .describe('Absolute folder path (explorer, terminal, vscode only)'),
});

export function createOpenApplication(
  launch: Launcher = launchDetached,
  env: () => AppEnv = defaultEnv,
): ToolDef<typeof input.shape> {
  return {
    name: 'open_application',
    category: 'apps',
    description:
      `Start an everyday program: ${APPS.map((a) => `${a} (${LABELS[a]})`).join(', ')}. ` +
      'explorer, terminal and vscode can open in a folder. For anything else, use run_command.',
    input,
    permission: ({ app, folder }, ctx) => {
      if (folder && !TAKES_FOLDER.has(app))
        return { permission: 'BLOCKED', reason: `${LABELS[app]} doesn't open folders.` };
      if (folder && ctx.isSecretPath(folder))
        return { permission: 'BLOCKED', reason: "Not opening that. It's where secrets live." };
      // Windows Terminal treats `;` in its arguments as a command separator, and Explorer splits on
      // commas, so a crafted folder name could smuggle in a command (docs/security-audit.md, F3).
      if (folder && /[;,]/.test(folder))
        return {
          permission: 'BLOCKED',
          reason:
            'That folder name has a ; or , in it, which these programs would misread. Open it another way.',
        };
      return { permission: 'SAFE' };
    },
    activity: ({ app }) => `Opening ${LABELS[app]}`,

    async execute({ app, folder }) {
      const dir = folder ? resolve(folder) : undefined;
      if (dir) {
        const s = await stat(dir).catch(() => undefined);
        if (!s?.isDirectory()) return { ok: false, summary: `${dir} isn't a folder` };
      }
      const plan = planLaunch(app, dir, env());
      if (!plan) return { ok: false, summary: `Couldn't find ${LABELS[app]}` };
      await launch(plan.exe, plan.args, plan.cwd ? { cwd: plan.cwd } : {});
      return { ok: true, summary: `Opened ${LABELS[app]}${dir ? ` in ${dir}` : ''}` };
    },
  };
}

export const openApplication = createOpenApplication();
