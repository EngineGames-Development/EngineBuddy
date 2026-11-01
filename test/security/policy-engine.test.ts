import { describe, expect, it } from 'vitest';
import { ToolRegistry } from '../../src/core/tools/tool-def';
import { createOpenInVsCode } from '../../src/tools/applications/open-in-vscode';
import { getSystemInfo } from '../../src/tools/system/get-system-info';
import { SecretPaths, canonical, normalisePath, type PathEnv } from '../../src/security/policy/paths';
import { PolicyEngine } from '../../src/security/policy/policy-engine';

const env: PathEnv = {
  home: 'C:\\Users\\me',
  appData: 'C:\\Users\\me\\AppData\\Roaming',
  localAppData: 'C:\\Users\\me\\AppData\\Local',
  systemRoot: 'C:\\Windows',
  vars: {
    USERPROFILE: 'C:\\Users\\me',
    APPDATA: 'C:\\Users\\me\\AppData\\Roaming',
    LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local',
  },
  extra: ['C:\\Users\\me\\AppData\\Roaming\\enginebuddy\\secrets.json'],
};

// A fake filesystem for realpath: a junction inside the project that points at ~/.ssh, and an
// 8.3 short name for AppData. Everything else resolves to itself.
const LINKS: Record<string, string> = {
  'c:\\proj\\sneaky': 'C:\\Users\\me\\.ssh',
  'c:\\users\\me\\appdat~1': 'C:\\Users\\me\\AppData',
};
const realpath = (p: string) => {
  const target = LINKS[p.toLowerCase()];
  if (target) return target;
  if (/^[a-z]:\\?$/i.test(p)) return p;
  throw new Error('ENOENT'); // makes realpathLoose walk up to a known prefix
};

const engine = new PolicyEngine({
  registry: new ToolRegistry([
    getSystemInfo,
    createOpenInVsCode(
      async () => {},
      () => 'Code.exe',
    ),
  ]),
  secrets: new SecretPaths(env),
  env,
  projectRoots: [canonical('C:\\proj')],
  cwd: 'C:\\proj',
  realpath,
});

const decide = (tool: string, input: unknown) => {
  const d = engine.evaluate(tool, input);
  return `${d.permission}${d.allowed ? '' : ' (denied)'}`;
};
const read = (file_path: string) => decide('Read', { file_path });

describe('PolicyEngine: built-in tools', () => {
  it('Read is SAFE inside a project root', () => {
    expect(read('C:\\proj\\src\\main.c')).toBe('SAFE');
    expect(read('src/main.c')).toBe('SAFE'); // relative to cwd
  });

  it('Read outside project roots needs a confirmation (denied in Phase 1)', () => {
    expect(read('C:\\Users\\me\\Documents\\notes.txt')).toBe('CONFIRM (denied)');
  });

  it('.env files need a confirmation even inside a project', () => {
    expect(read('C:\\proj\\.env')).toBe('CONFIRM (denied)');
    expect(read('C:\\proj\\api\\.env.local')).toBe('CONFIRM (denied)');
    expect(read('C:\\proj\\docs\\env.md')).toBe('SAFE');
  });

  it.each([
    ['ssh key', 'C:\\Users\\me\\.ssh\\id_ed25519'],
    ['aws credentials via %VAR%', '%USERPROFILE%\\.aws\\credentials'],
    ['npmrc via ~', '~\\.npmrc'],
    ['claude credentials', 'C:\\Users\\me\\.claude\\.credentials.json'],
    ['chrome passwords', 'C:\\Users\\me\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Login Data'],
    [
      'edge cookies',
      'C:\\Users\\me\\AppData\\Local\\Microsoft\\Edge\\User Data\\Profile 1\\Network\\Cookies',
    ],
    ['firefox logins', '%APPDATA%\\Mozilla\\Firefox\\Profiles\\abc.default\\logins.json'],
    ['windows credentials', 'C:\\Users\\me\\AppData\\Roaming\\Microsoft\\Credentials\\ABCDEF'],
    ['SAM hive', 'C:\\Windows\\System32\\config\\SAM'],
    ['our own secrets file', 'C:\\Users\\me\\AppData\\Roaming\\enginebuddy\\secrets.json'],
    ['a key file outside projects', 'C:\\Users\\me\\Downloads\\server.pem'],
    ['a password database', 'D:\\vault\\passwords.kdbx'],
  ])('BLOCKS %s', (_label, path) => {
    expect(read(path)).toBe('BLOCKED (denied)');
  });

  it.each([
    ['traversal out of the project', 'C:\\proj\\..\\Users\\me\\.ssh\\id_rsa'],
    ['mixed case and forward slashes', 'c:/USERS/ME/.SSH/config'],
    ['a junction inside the project', 'C:\\proj\\sneaky\\id_rsa'],
    ['an 8.3 short name', 'C:\\Users\\me\\APPDAT~1\\Roaming\\Microsoft\\Credentials\\x'],
    ['UNC share', '\\\\server\\share\\file.txt'],
    ['\\\\?\\ device path', '\\\\?\\C:\\Users\\me\\.ssh\\id_rsa'],
    ['alternate data stream', 'C:\\proj\\file.txt:hidden'],
    ['unknown variable', '%NOPE%\\x'],
  ])('BLOCKS tricks: %s', (_label, path) => {
    expect(read(path)).toBe('BLOCKED (denied)');
  });

  it('does not over-match: a folder that only starts like a secret one is not secret', () => {
    expect(read('C:\\Users\\me\\.sshfoo\\notes.txt')).toBe('CONFIRM (denied)');
    expect(read('C:\\proj\\certs\\dev.pem')).toBe('SAFE'); // key files inside a project are its own
  });

  it('Glob is SAFE in a project, but its pattern cannot escape', () => {
    expect(decide('Glob', { pattern: '**/*.ts' })).toBe('SAFE');
    expect(decide('Glob', { pattern: '*.c', path: 'C:\\proj\\src' })).toBe('SAFE');
    expect(decide('Glob', { pattern: '../**/*' })).toBe('BLOCKED (denied)');
    expect(decide('Glob', { pattern: 'C:/Users/me/.ssh/*' })).toBe('BLOCKED (denied)');
    expect(decide('Glob', { pattern: '*', path: 'C:\\Users\\me\\.ssh' })).toBe('BLOCKED (denied)');
  });

  it.each(['Bash', 'PowerShell', 'Write', 'Edit', 'NotebookEdit', 'WebFetch', 'WebSearch'])(
    '%s needs a confirmation (denied in Phase 1)',
    (tool) => {
      expect(decide(tool, { command: 'dir C:\\' })).toBe('CONFIRM (denied)');
    },
  );

  it('anything else is BLOCKED by default, including Grep for now', () => {
    expect(decide('Grep', { pattern: 'x' })).toBe('BLOCKED (denied)');
    expect(decide('Task', {})).toBe('BLOCKED (denied)');
    expect(decide('mcp__other_server__steal', {})).toBe('BLOCKED (denied)');
  });

  it('bad input to a built-in is BLOCKED', () => {
    expect(decide('Read', { path: 'C:\\proj\\x' })).toBe('BLOCKED (denied)');
    expect(decide('Read', null)).toBe('BLOCKED (denied)');
  });

  it('gives a friendly reason when it says no', () => {
    expect(engine.evaluate('Bash', { command: 'dir' }).reason).toMatch(/run_command/);
    expect(engine.evaluate('Read', { file_path: '~/.ssh/id_rsa' }).reason).toMatch(/secrets/);
  });
});

describe('PolicyEngine: our tools', () => {
  const own = (name: string, input: unknown) => decide(`mcp__enginebuddy__${name}`, input);

  it('get_system_info is SAFE and takes no input', () => {
    expect(own('get_system_info', {})).toBe('SAFE');
    expect(own('get_system_info', undefined)).toBe('SAFE');
    expect(own('get_system_info', { verbose: true })).toBe('BLOCKED (denied)');
  });

  it('open_in_vscode is SAFE for normal paths, BLOCKED for secret ones', () => {
    expect(own('open_in_vscode', { path: 'C:\\proj' })).toBe('SAFE');
    expect(own('open_in_vscode', { path: 'D:\\code\\other-project' })).toBe('SAFE');
    expect(own('open_in_vscode', { path: 'C:\\Users\\me\\.ssh' })).toBe('BLOCKED (denied)');
    expect(own('open_in_vscode', { path: '\\\\server\\share' })).toBe('BLOCKED (denied)');
  });

  it('validates input', () => {
    expect(own('open_in_vscode', {})).toBe('BLOCKED (denied)');
    expect(own('open_in_vscode', { path: '' })).toBe('BLOCKED (denied)');
    expect(own('open_in_vscode', { path: 42 })).toBe('BLOCKED (denied)');
    expect(own('open_in_vscode', { path: 'C:\\proj', args: '--disable-extensions' })).toBe(
      'BLOCKED (denied)',
    );
  });

  it('unregistered tools under our prefix are BLOCKED', () => {
    expect(own('format_disk', {})).toBe('BLOCKED (denied)');
  });
});

describe('normalisePath', () => {
  it('canonicalises', () => {
    expect(normalisePath('C:\\Proj\\A\\..\\B\\', { cwd: 'C:\\', env, realpath })).toEqual({
      ok: true,
      path: 'c:/proj/b',
    });
  });
});
