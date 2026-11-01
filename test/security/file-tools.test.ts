import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ToolRegistry, type PolicyContext } from '../../src/core/tools/tool-def';
import { SecretPaths, canonical, type PathEnv } from '../../src/security/policy/paths';
import { PolicyEngine } from '../../src/security/policy/policy-engine';
import { createFileTools } from '../../src/tools/files/file-edits';

const env: PathEnv = {
  home: 'C:\\Users\\me',
  appData: 'C:\\Users\\me\\AppData\\Roaming',
  localAppData: 'C:\\Users\\me\\AppData\\Local',
  systemRoot: 'C:\\Windows',
  vars: { USERPROFILE: 'C:\\Users\\me' },
  extra: [],
};

const engine = new PolicyEngine({
  registry: new ToolRegistry(createFileTools({ defaultCwd: 'C:\\proj' })),
  secrets: new SecretPaths(env),
  env,
  projectRoots: [canonical('C:\\proj')],
  cwd: 'C:\\proj',
  realpath: (p) => {
    if (/^[a-z]:\\?$/i.test(p)) return p;
    throw new Error('ENOENT');
  },
});

const decide = (tool: string, input: unknown) => {
  const d = engine.evaluate(`mcp__enginebuddy__${tool}`, input);
  return d.allowed ? d.permission : d.confirmable ? 'CONFIRM (ask)' : `${d.permission} (denied)`;
};
const edit = (path: string) => decide('edit_file', { path, old_text: 'a', new_text: 'b', reason: 'fix' });
const write = (path: string) => decide('write_file', { path, content: 'x', reason: 'new' });

describe('file tools: policy', () => {
  it('asks you for changes inside a project folder', () => {
    expect(edit('C:\\proj\\src\\main.ts')).toBe('CONFIRM (ask)');
    expect(write('src/new.ts')).toBe('CONFIRM (ask)');
  });

  it.each([
    ['outside the project', 'C:\\other\\file.txt'],
    ['climbing out', 'C:\\proj\\..\\other\\file.txt'],
    ['a .env file', 'C:\\proj\\.env'],
    ['a .env.local file', 'C:\\proj\\.env.local'],
    ['an SSH key', 'C:\\Users\\me\\.ssh\\id_ed25519'],
  ])('refuses %s', (_label, path) => {
    expect(edit(path)).toBe('BLOCKED (denied)');
    expect(write(path)).toBe('BLOCKED (denied)');
  });

  it('rejects input without a reason or with extra keys', () => {
    expect(decide('write_file', { path: 'C:\\proj\\a.txt', content: 'x' })).toBe('BLOCKED (denied)');
    expect(decide('edit_file', { path: 'a', old_text: 'a', new_text: 'b', reason: 'r', force: true })).toBe(
      'BLOCKED (denied)',
    );
  });
});

describe('file tools: running', () => {
  const dir = mkdtempSync(join(tmpdir(), 'eb-files-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const [writeTool, editTool] = createFileTools({ defaultCwd: dir });
  const signal = new AbortController().signal;
  const ctx: PolicyContext = { isSecretPath: () => false, isInProject: () => true };

  it('creates a file, with a diff of all additions in the confirmation', async () => {
    const input = { path: 'sub/new.txt', content: 'one\ntwo\n', reason: 'test' };
    const shown = writeTool!.describe!(input);
    expect(shown.title).toBe('Create this file?');
    expect(shown.diff).toEqual([
      { kind: 'add', text: 'one' },
      { kind: 'add', text: 'two' },
    ]);
    expect(writeTool!.permission(input, ctx).permission).toBe('CONFIRM');
    const result = await writeTool!.execute(input, signal);
    expect(result.ok).toBe(true);
    expect(readFileSync(join(dir, 'sub', 'new.txt'), 'utf8')).toBe('one\ntwo\n');
  });

  it('edits exactly one occurrence and keeps CRLF line endings', async () => {
    const file = join(dir, 'crlf.txt');
    writeFileSync(file, 'alpha\r\nbeta\r\ngamma\r\n');
    const input = { path: file, old_text: 'beta\n', new_text: 'BETA\nbeta2\n', reason: 'test' };
    expect(editTool!.describe!(input).diff?.filter((l) => l.kind !== 'same')).toEqual([
      { kind: 'del', text: 'beta' },
      { kind: 'add', text: 'BETA' },
      { kind: 'add', text: 'beta2' },
    ]);
    expect((await editTool!.execute(input, signal)).ok).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe('alpha\r\nBETA\r\nbeta2\r\ngamma\r\n');
  });

  it("writes nothing when the text isn't there exactly once", async () => {
    const file = join(dir, 'twice.txt');
    writeFileSync(file, 'x\nx\n');
    const twice = await editTool!.execute({ path: file, old_text: 'x', new_text: 'y', reason: 't' }, signal);
    expect(twice.ok).toBe(false);
    const missing = await editTool!.execute(
      { path: file, old_text: 'zzz', new_text: 'y', reason: 't' },
      signal,
    );
    expect(missing.ok).toBe(false);
    expect(readFileSync(file, 'utf8')).toBe('x\nx\n');
  });

  it('treats $ in the new text literally (no replace patterns)', async () => {
    const file = join(dir, 'dollar.txt');
    writeFileSync(file, 'price\n');
    await editTool!.execute({ path: file, old_text: 'price', new_text: "$& $' $$", reason: 't' }, signal);
    expect(readFileSync(file, 'utf8')).toBe("$& $' $$\n");
  });
});
