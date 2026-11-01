// write_file and edit_file (CONFIRM): change files in your project folders, but only after you saw
// the change as a diff in the confirmation window and clicked Allow. Outside the project folders,
// in secret places and in .env files they're refused outright.
//
// edit_file replaces one exact piece of text that must occur exactly once, and checks that again
// when it runs: if the file changed in between, nothing is written.
import { readFileSync, statSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';
import { z } from 'zod';
import { diffLines } from '../../core/diff/line-diff';
import type { PermissionVerdict, PolicyContext, ToolDef } from '../../core/tools/tool-def';

const MAX_CONTENT = 400_000;
/** Bigger files aren't something to rewrite from a chat. */
const MAX_FILE_BYTES = 2_000_000;

export interface FileToolOptions {
  /** Relative paths resolve against this (the agent's working folder), like the policy does. */
  defaultCwd: string;
}

const path = z.string().min(1).max(1024).describe('Path of the file (absolute, or relative to the project)');
const reason = z.string().min(1).max(300).describe('One short sentence for the user: why this change');

const writeInput = z.object({
  path,
  content: z.string().max(MAX_CONTENT).describe('The complete new content of the file'),
  reason,
});

const editInput = z.object({
  path,
  old_text: z.string().min(1).max(MAX_CONTENT).describe('Exact text to replace; must occur exactly once'),
  new_text: z.string().max(MAX_CONTENT).describe('What to put there instead'),
  reason,
});

function filePermission(p: string, ctx: PolicyContext): PermissionVerdict {
  if (ctx.isSecretPath(p))
    return { permission: 'BLOCKED', reason: "Not touching that. It's where secrets live." };
  // Windows ignores trailing dots and spaces, and `name:stream` writes to the same file, so
  // compare the names the way Windows will resolve them.
  const segments = p.split(/[\\/]+/).map((s) =>
    s
      .replace(/:.*$/, '')
      .replace(/[. ]+$/, '')
      .toLowerCase(),
  );
  if (/^\.env(\..*)?$/.test(segments.at(-1) ?? ''))
    return { permission: 'BLOCKED', reason: "I don't change .env files. Do that one yourself." };
  // Git runs files in .git (hooks, config) on its own later: an edit there is a delayed command.
  if (segments.includes('.git'))
    return { permission: 'BLOCKED', reason: "I don't touch .git. Files in there can run code later." };
  if (!ctx.isInProject(p))
    return {
      permission: 'BLOCKED',
      reason: "That's outside your project folders, so I won't change it. Add the folder in Settings first.",
    };
  return { permission: 'CONFIRM', reason: 'Changing a file needs your OK.' };
}

function readText(full: string): string | undefined {
  try {
    // describe() runs in main's event loop: don't block it reading something huge.
    if (statSync(full).size > MAX_FILE_BYTES) return undefined;
    return readFileSync(full, 'utf8');
  } catch {
    return undefined;
  }
}

/** Write via a temp file, so a crash can't leave half a file behind. */
async function writeAtomic(full: string, text: string): Promise<void> {
  await mkdir(dirname(full), { recursive: true });
  const tmp = `${full}.enginebuddy-tmp`;
  await writeFile(tmp, text, 'utf8');
  await rename(tmp, full);
}

function countOf(text: string, piece: string): number {
  let n = 0;
  for (let i = text.indexOf(piece); i !== -1; i = text.indexOf(piece, i + piece.length)) n++;
  return n;
}

/** Keep the file's line endings: the model writes \n, Windows files often use \r\n. */
function matchEndings(original: string, text: string): string {
  return original.includes('\r\n') ? text.replace(/\r?\n/g, '\r\n') : text;
}

export function createFileTools(opts: FileToolOptions): ToolDef[] {
  const full = (p: string) => resolve(opts.defaultCwd, p);

  const writeFileTool: ToolDef<typeof writeInput.shape> = {
    name: 'write_file',
    category: 'filesystem',
    description:
      "Create a file, or replace a file's whole content, inside the user's project folders. The user sees the change " +
      'as a diff and must click Allow. For small changes to an existing file prefer edit_file.',
    input: writeInput,
    permission: ({ path: p }, ctx) => filePermission(p, ctx),
    activity: ({ path: p }) => `Writing ${basename(p)}`,
    describe: ({ path: p, content, reason: why }) => {
      const before = readText(full(p));
      return {
        title: before === undefined ? 'Create this file?' : 'Replace this file?',
        target: full(p),
        details: [
          before === undefined ? 'New file.' : 'The whole file gets the new content below.',
          `${content.length.toLocaleString('en')} characters.`,
        ],
        modelExplanation: why,
        diff: diffLines(before ?? '', content),
      };
    },
    async execute({ path: p, content }) {
      const target = full(p);
      const before = await readFile(target, 'utf8').catch(() => undefined);
      await writeAtomic(target, before === undefined ? content : matchEndings(before, content));
      return {
        ok: true,
        summary: `${before === undefined ? 'Created' : 'Wrote'} ${basename(target)}`,
        data: { path: target, created: before === undefined },
      };
    },
  };

  const editFileTool: ToolDef<typeof editInput.shape> = {
    name: 'edit_file',
    category: 'filesystem',
    description:
      "Change part of an existing file inside the user's project folders: `old_text` (exact, occurring once) is " +
      'replaced by `new_text`. Read the file first. The user sees the change as a diff and must click Allow.',
    input: editInput,
    permission: ({ path: p }, ctx) => filePermission(p, ctx),
    activity: ({ path: p }) => `Editing ${basename(p)}`,
    describe: ({ path: p, old_text, new_text, reason: why }) => {
      const before = readText(full(p));
      const found =
        before === undefined ? 0 : countOf(before.replace(/\r\n/g, '\n'), old_text.replace(/\r\n/g, '\n'));
      const after =
        before !== undefined && found === 1
          ? before
              .replace(/\r\n/g, '\n')
              .replace(old_text.replace(/\r\n/g, '\n'), () => new_text.replace(/\r\n/g, '\n'))
          : undefined;
      return {
        title: 'Change this file?',
        target: full(p),
        details:
          after === undefined
            ? [
                before === undefined
                  ? "The file doesn't exist, so this will fail."
                  : `The text to replace occurs ${found} times, so this will fail.`,
              ]
            : ['Only the lines shown change.'],
        modelExplanation: why,
        ...(after !== undefined ? { diff: diffLines(before!.replace(/\r\n/g, '\n'), after) } : {}),
      };
    },
    async execute({ path: p, old_text, new_text }) {
      const target = full(p);
      const raw = await readFile(target).catch(() => undefined);
      if (!raw) return { ok: false, summary: `${basename(target)} doesn't exist` };
      if (raw.length > MAX_FILE_BYTES)
        return { ok: false, summary: `${basename(target)} is too big to edit here` };
      const before = raw.toString('utf8');
      const text = before.replace(/\r\n/g, '\n');
      const oldText = old_text.replace(/\r\n/g, '\n');
      const found = countOf(text, oldText);
      if (found !== 1)
        return {
          ok: false,
          summary:
            found === 0 ? 'The text to replace isn’t there (anymore)' : `The text occurs ${found} times`,
        };
      const after = text.replace(oldText, () => new_text.replace(/\r\n/g, '\n'));
      await writeAtomic(target, matchEndings(before, after));
      return { ok: true, summary: `Edited ${basename(target)}`, data: { path: target } };
    },
  };

  return [writeFileTool, editFileTool];
}
