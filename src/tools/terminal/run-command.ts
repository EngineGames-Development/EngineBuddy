// run_command (CONFIRM): run a PowerShell command, but only after you clicked Allow in the
// confirmation window, which shows exactly this command text and folder. The classifier blocks
// some commands outright, even with your OK (security/policy/command-classifier.ts).
import { execFile, spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import type { ToolDef } from '../../core/tools/tool-def';

const TIMEOUT_MS = 60_000;
const MAX_OUTPUT = 16_000;
/** Make PowerShell write UTF-8, so non-English output (paths, messages) isn't mangled. */
const UTF8_PREFIX = '[Console]::OutputEncoding = [Text.Encoding]::UTF8; ';

const input = z.object({
  command: z.string().min(1).max(2000).describe('The exact PowerShell command to run'),
  cwd: z.string().min(1).max(1024).optional().describe('Absolute folder to run it in'),
  reason: z.string().min(1).max(300).describe('One short sentence for the user: why you want to run this'),
});

export interface RunCommandOptions {
  /** Where commands run when no cwd is given (the agent's working folder). */
  defaultCwd: string;
  /** Decides if a command is blocked outright. Injected from security, which tools can't import. */
  classify: (command: string) => { blocked: boolean; reason?: string };
  systemRoot?: string;
}

function powershellPath(systemRoot: string): string {
  return join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
}

/** Kill the process and everything it started (PowerShell can spawn children). */
function killTree(pid: number | undefined): void {
  if (!pid) return;
  execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => {});
}

export function createRunCommand(opts: RunCommandOptions): ToolDef<typeof input.shape> {
  const systemRoot = opts.systemRoot ?? process.env['SystemRoot'] ?? 'C:\\Windows';
  return {
    name: 'run_command',
    category: 'terminal',
    description:
      "Run a PowerShell command on the user's PC. The user sees the exact command and must click Allow first. " +
      'Give a short `reason`. Output is returned (cut at 16 kB); it times out after 60 s. ' +
      'Prefer open_application for simply starting a program.',
    input,
    permission: ({ command, cwd }, ctx) => {
      const verdict = opts.classify(command);
      if (verdict.blocked)
        return { permission: 'BLOCKED', ...(verdict.reason ? { reason: verdict.reason } : {}) };
      if (cwd && ctx.isSecretPath(cwd))
        return { permission: 'BLOCKED', reason: "Not running anything in there. It's where secrets live." };
      return { permission: 'CONFIRM', reason: 'Running a command needs your OK.' };
    },
    activity: () => 'Running a command',
    describe: ({ command, cwd, reason }) => ({
      title: 'Run this command?',
      target: command,
      details: [
        `Folder: ${resolve(cwd ?? opts.defaultCwd)}`,
        'Runs in Windows PowerShell as you, with your permissions.',
        `Stopped after ${TIMEOUT_MS / 1000} s.`,
      ],
      modelExplanation: reason,
    }),

    async execute({ command, cwd }, signal) {
      const dir = resolve(cwd ?? opts.defaultCwd);
      const s = await stat(dir).catch(() => undefined);
      if (!s?.isDirectory()) return { ok: false, summary: `${dir} isn't a folder` };

      return new Promise((done) => {
        const child = spawn(
          powershellPath(systemRoot),
          ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', UTF8_PREFIX + command],
          { cwd: dir, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
        );
        let stdout = '';
        let stderr = '';
        let truncated = false;
        const take = (current: string, chunk: Buffer) => {
          if (current.length >= MAX_OUTPUT) {
            truncated = true;
            return current;
          }
          const next = current + chunk.toString('utf8');
          if (next.length > MAX_OUTPUT) truncated = true;
          return next.slice(0, MAX_OUTPUT);
        };
        child.stdout.on('data', (c: Buffer) => (stdout = take(stdout, c)));
        child.stderr.on('data', (c: Buffer) => (stderr = take(stderr, c)));

        let stopped: 'timeout' | 'cancelled' | undefined;
        const timer = setTimeout(() => {
          stopped = 'timeout';
          killTree(child.pid);
        }, TIMEOUT_MS);
        const onAbort = () => {
          stopped = 'cancelled';
          killTree(child.pid);
        };
        signal.addEventListener('abort', onAbort, { once: true });

        const finish = (exitCode: number | null, error?: Error) => {
          clearTimeout(timer);
          signal.removeEventListener('abort', onAbort);
          const summary = error
            ? `Couldn't start PowerShell: ${error.message}`
            : stopped === 'timeout'
              ? `Stopped after ${TIMEOUT_MS / 1000} s`
              : stopped === 'cancelled'
                ? 'Stopped'
                : `Exit code ${exitCode}`;
          done({
            ok: !error && !stopped && exitCode === 0,
            summary,
            data: { exitCode, stdout, stderr, truncated, ...(stopped ? { stopped } : {}) },
          });
        };
        child.once('error', (e) => finish(null, e));
        child.once('close', (code) => finish(code));
      });
    },
  };
}
