// Starting programs. Always an executable path plus an argument array: never a shell, never a
// command line built from model text.
import { spawn } from 'node:child_process';

export type Launcher = (exe: string, args: string[], opts?: { cwd?: string }) => Promise<void>;

/** Start the program detached and don't wait for it (it keeps running after EngineBuddy exits). */
export const launchDetached: Launcher = (exe, args, opts = {}) =>
  new Promise((resolve, reject) => {
    // VS Code's own CLI sets this; if it leaked into our environment, Electron apps would run as Node.
    const env = { ...process.env };
    delete env['ELECTRON_RUN_AS_NODE'];
    const child = spawn(exe, args, {
      env,
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
      ...(opts.cwd ? { cwd: opts.cwd } : {}),
    });
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
    child.once('error', reject);
  });
