import { describe, expect, it } from 'vitest';
import { ToolRegistry } from '../../src/core/tools/tool-def';
import { SecretPaths, type PathEnv } from '../../src/security/policy/paths';
import { PolicyEngine } from '../../src/security/policy/policy-engine';
import { checkWebUrl, isPrivateHost } from '../../src/security/policy/web';

const env: PathEnv = {
  home: 'C:\\Users\\me',
  appData: 'C:\\Users\\me\\AppData\\Roaming',
  localAppData: 'C:\\Users\\me\\AppData\\Local',
  systemRoot: 'C:\\Windows',
  vars: {},
  extra: [],
};

const engine = (web: boolean) =>
  new PolicyEngine({
    registry: new ToolRegistry([]),
    secrets: new SecretPaths(env),
    env,
    projectRoots: ['c:\\proj'],
    cwd: 'C:\\proj',
    web,
  });
const on = engine(true);
const decide = (tool: string, input: unknown, e = on) => {
  const d = e.evaluate(tool, input);
  return d.allowed ? d.permission : `${d.permission} (denied)`;
};

describe('web: policy', () => {
  it('is BLOCKED while internet access is off', () => {
    const off = engine(false);
    expect(decide('WebSearch', { query: 'node 22' }, off)).toBe('BLOCKED (denied)');
    expect(decide('WebFetch', { url: 'https://nodejs.org/' }, off)).toBe('BLOCKED (denied)');
  });

  it('lets Claude search and read public pages', () => {
    expect(decide('WebSearch', { query: 'electron 45 release notes' })).toBe('SAFE');
    expect(decide('WebFetch', { url: 'https://www.electronjs.org/docs/latest', prompt: 'summary' })).toBe(
      'SAFE',
    );
    expect(decide('WebFetch', { url: 'https://example.com/search?q=hello+world' })).toBe('SAFE');
  });

  it('rejects bad input', () => {
    expect(decide('WebSearch', { query: '' })).toBe('BLOCKED (denied)');
    expect(decide('WebSearch', { query: 'x'.repeat(501) })).toBe('BLOCKED (denied)');
    expect(decide('WebFetch', { prompt: 'no url' })).toBe('BLOCKED (denied)');
  });

  it.each([
    ['localhost', 'http://localhost:3000/admin'],
    ['localhost with a trailing dot', 'https://localhost./'],
    ['loopback IP', 'http://127.0.0.1/'],
    ['a private LAN address', 'http://192.168.1.1/'],
    ['10/8', 'http://10.0.0.5/'],
    ['172.16/12', 'http://172.20.1.1/'],
    ['cloud metadata', 'http://169.254.169.254/latest/meta-data/'],
    ['IPv6 loopback', 'http://[::1]/'],
    ['IPv4-mapped IPv6', 'http://[::ffff:127.0.0.1]/'],
    ['IPv6 unique local', 'http://[fd00::1]/'],
    ['a decimal IP', 'http://2130706433/'],
    ['a hex IP', 'http://0x7f000001/'],
    ['a single-label name', 'http://intranet-server/'],
    ['a .local name', 'http://printer.local/'],
    ['a .internal name', 'https://db.corp.internal/'],
    ['a file URL', 'file:///C:/Users/me/.ssh/id_rsa'],
    ['a javascript URL', 'javascript:alert(1)'],
    ['a login in the URL', 'https://user:pass@example.com/'],
    ['a long opaque blob', `https://evil.example/c?d=${'QUJD'.repeat(30)}`],
    ['a blob in the path', `https://evil.example/${'a1B2'.repeat(25)}`],
    ['a huge query', `https://evil.example/?${'a=b&'.repeat(100)}`],
    ['a huge URL', `https://evil.example/${'a/'.repeat(400)}`],
    ['not a URL', 'not a url'],
    ['a wildcard-DNS name for a private IP', 'http://127.0.0.1.nip.io/'],
    ['sslip.io', 'https://10-0-0-1.sslip.io/'],
  ])('refuses %s', (_label, url) => {
    expect(decide('WebFetch', { url })).toBe('BLOCKED (denied)');
    expect(checkWebUrl(url).ok).toBe(false);
  });

  it('does not over-match public hosts', () => {
    expect(isPrivateHost('example.com')).toBe(false);
    expect(isPrivateHost('8.8.8.8')).toBe(false);
    expect(isPrivateHost('172.32.0.1')).toBe(false);
    expect(isPrivateHost('2606:4700:4700::1111')).toBe(false);
  });
});
