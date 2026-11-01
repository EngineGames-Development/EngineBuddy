import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ToolRegistry } from '../../src/core/tools/tool-def';
import { SecretPaths, canonical, type PathEnv } from '../../src/security/policy/paths';
import { PolicyEngine } from '../../src/security/policy/policy-engine';
import { createReadTools } from '../../src/tools/files/read-files';

const env: PathEnv = {
  home: 'C:\\Users\\me',
  appData: 'C:\\Users\\me\\AppData\\Roaming',
  localAppData: 'C:\\Users\\me\\AppData\\Local',
  systemRoot: 'C:\\Windows',
  vars: { USERPROFILE: 'C:\\Users\\me' },
  extra: [],
};

describe('read tools: policy', () => {
  const engine = new PolicyEngine({
    registry: new ToolRegistry(createReadTools({ defaultCwd: 'C:\\proj' })),
    secrets: new SecretPaths(env),
    env,
    projectRoots: [canonical('C:\\proj')],
    cwd: 'C:\\proj',
    realpath: (p) => {
      if (/^[a-z]:\\?$/i.test(p)) return p;
      throw new Error('ENOENT');
    },
  });
  const allowed = (tool: string, input: unknown) =>
    engine.evaluate(`mcp__enginebuddy__${tool}`, input).allowed;

  it('reads and lists inside the project', () => {
    expect(allowed('read_file', { path: 'src\\main.ts' })).toBe(true);
    expect(allowed('list_files', {})).toBe(true);
    expect(allowed('list_files', { path: 'C:\\proj\\src' })).toBe(true);
  });

  it.each([
    ['outside the project', 'C:\\other\\notes.txt'],
    ['climbing out', '..\\other\\x.txt'],
    ['a .env file', 'C:\\proj\\.env'],
    ['.env with a trailing dot', 'C:\\proj\\.env.'],
    ['.env via a stream', 'C:\\proj\\.env::$DATA'],
    ['.git config', 'C:\\proj\\.git\\config'],
    ['an SSH key', 'C:\\Users\\me\\.ssh\\id_ed25519'],
  ])('refuses %s', (_label, path) => {
    expect(allowed('read_file', { path })).toBe(false);
  });

  it('refuses listing outside the project and extra keys', () => {
    expect(allowed('list_files', { path: 'C:\\Users\\me' })).toBe(false);
    expect(allowed('read_file', { path: 'a.txt', encoding: 'x' })).toBe(false);
  });
});

describe('read tools: running', () => {
  const dir = mkdtempSync(join(tmpdir(), 'eb-read-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'src'));
  mkdirSync(join(dir, '.git'));
  writeFileSync(join(dir, 'src', 'a.ts'), 'export const a = 1;\n');
  writeFileSync(join(dir, 'pic.bin'), Buffer.from([1, 0, 2, 0]));
  const [readFile, listFiles] = createReadTools({ defaultCwd: dir });
  const signal = new AbortController().signal;

  it('reads a text file', async () => {
    const out = await readFile!.execute({ path: 'src/a.ts' }, signal);
    expect(out).toMatchObject({ ok: true, data: { content: 'export const a = 1;\n' } });
  });

  it('refuses binary files and missing files', async () => {
    expect((await readFile!.execute({ path: 'pic.bin' }, signal)).ok).toBe(false);
    expect((await readFile!.execute({ path: 'nope.txt' }, signal)).ok).toBe(false);
  });

  it('lists a folder without .git, folders marked with /', async () => {
    const out = await listFiles!.execute({}, signal);
    expect(out.ok).toBe(true);
    expect((out.data as { entries: string[] }).entries.sort()).toEqual(['pic.bin', 'src/']);
  });
});
