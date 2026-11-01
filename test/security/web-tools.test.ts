import { describe, expect, it } from 'vitest';
import { ToolRegistry, type PolicyContext } from '../../src/core/tools/tool-def';
import { SecretPaths, type PathEnv } from '../../src/security/policy/paths';
import { PolicyEngine } from '../../src/security/policy/policy-engine';
import { checkWebUrl, isPrivateHost } from '../../src/tools/web/url-rules';
import { createWebTools, htmlToText } from '../../src/tools/web/web-tools';

const env: PathEnv = {
  home: 'C:\\Users\\me',
  appData: 'C:\\a',
  localAppData: 'C:\\l',
  systemRoot: 'C:\\Windows',
  vars: {},
};
const ctx: PolicyContext = { isSecretPath: () => false, isInProject: () => true };
const signal = new AbortController().signal;

/** A fake internet: URL → response; DNS: host → addresses. */
function net(pages: Record<string, Response | (() => Response)>, dns: Record<string, string[]> = {}) {
  const fetched: string[] = [];
  const fetchFn = (async (url: string) => {
    fetched.push(url);
    const page = pages[url];
    if (!page) return new Response('nope', { status: 404, headers: { 'content-type': 'text/plain' } });
    return typeof page === 'function' ? page() : page;
  }) as unknown as typeof fetch;
  const resolve = async (host: string) => dns[host] ?? ['93.184.216.34'];
  return { fetchFn, resolve, fetched };
}

const html = (body: string) =>
  new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8' } });

function tools(n: ReturnType<typeof net>, enabled = true) {
  const [page, wiki] = createWebTools({ enabled, lang: 'de', fetch: n.fetchFn, resolve: n.resolve });
  return { page: page!, wiki: wiki! };
}

describe('web tools: permission', () => {
  it('are refused while internet access is off', () => {
    const { page, wiki } = tools(net({}), false);
    expect(page.permission({ url: 'https://nodejs.org/' }, ctx).permission).toBe('BLOCKED');
    expect(wiki.permission({ query: 'Node.js' }, ctx).permission).toBe('BLOCKED');
  });

  it('go through the PolicyEngine like every tool (strict input)', () => {
    const engine = new PolicyEngine({
      registry: new ToolRegistry(createWebTools({ enabled: true, lang: 'de' })),
      secrets: new SecretPaths(env),
      env,
      projectRoots: ['c:\\proj'],
      cwd: 'C:\\proj',
    });
    const allowed = (tool: string, input: unknown) =>
      engine.evaluate(`mcp__enginebuddy__${tool}`, input).allowed;
    expect(allowed('read_web_page', { url: 'https://nodejs.org/en' })).toBe(true);
    expect(allowed('read_web_page', { url: 'http://192.168.178.1/' })).toBe(false);
    expect(allowed('read_web_page', { url: 'https://x.org', extra: 1 })).toBe(false);
    expect(allowed('search_wikipedia', { query: 'Linux', lang: 'de; rm' })).toBe(false);
    // The old Claude built-ins are gone: default deny.
    expect(allowed('WebFetch', { url: 'https://nodejs.org' })).toBe(false);
    expect(allowed('WebSearch', { query: 'x' })).toBe(false);
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
    ['a wildcard-DNS name', 'http://127.0.0.1.nip.io/'],
    ['sslip.io', 'https://10-0-0-1.sslip.io/'],
    ['a file URL', 'file:///C:/Users/me/.ssh/id_rsa'],
    ['a javascript URL', 'javascript:alert(1)'],
    ['a login in the URL', 'https://user:pass@example.com/'],
    ['a long opaque blob', `https://evil.example/c?d=${'QUJD'.repeat(30)}`],
    ['a blob in the path', `https://evil.example/${'a1B2'.repeat(25)}`],
    ['a huge query', `https://evil.example/?${'a=b&'.repeat(100)}`],
    ['not a URL', 'not a url'],
  ])('refuses %s', (_label, url) => {
    expect(checkWebUrl(url).ok).toBe(false);
  });

  it('does not over-match public hosts', () => {
    expect(isPrivateHost('example.com')).toBe(false);
    expect(isPrivateHost('8.8.8.8')).toBe(false);
    expect(isPrivateHost('172.32.0.1')).toBe(false);
    expect(isPrivateHost('2606:4700:4700::1111')).toBe(false);
  });
});

describe('web tools: fetching', () => {
  it('reads a page as plain text, without scripts', async () => {
    const n = net({
      'https://nodejs.org/en': html(
        '<html><head><title>Node.js</title><script>steal()</script></head><body><h1>Node &amp; you</h1><p>v26.13.0 LTS</p></body></html>',
      ),
    });
    const out = await tools(n).page.execute({ url: 'https://nodejs.org/en' }, signal);
    expect(out.ok).toBe(true);
    expect(out.data).toMatchObject({ title: 'Node.js', text: 'Node & you\nv26.13.0 LTS' });
  });

  it('refuses a public name that resolves into your network (DNS rebinding)', async () => {
    const n = net(
      { 'https://sneaky.example/': html('secret router page') },
      { 'sneaky.example': ['192.168.0.1'] },
    );
    const out = await tools(n).page.execute({ url: 'https://sneaky.example/' }, signal);
    expect(out.ok).toBe(false);
    expect(n.fetched).toEqual([]);
  });

  it('checks every redirect again', async () => {
    const n = net({
      'https://short.example/x': new Response(null, {
        status: 302,
        headers: { location: 'http://127.0.0.1/admin' },
      }),
    });
    const out = await tools(n).page.execute({ url: 'https://short.example/x' }, signal);
    expect(out.ok).toBe(false);
    expect(n.fetched).toEqual(['https://short.example/x']);
  });

  it('follows a public redirect', async () => {
    const n = net({
      'https://a.example/': new Response(null, { status: 301, headers: { location: '/new' } }),
      'https://a.example/new': html('<p>moved here</p>'),
    });
    const out = await tools(n).page.execute({ url: 'https://a.example/' }, signal);
    expect(out).toMatchObject({ ok: true, data: { url: 'https://a.example/new', text: 'moved here' } });
  });

  it('searches Wikipedia in the user language and returns summaries with the source', async () => {
    const n = net({
      'https://de.wikipedia.org/w/api.php?action=query&list=search&srsearch=Node.js&srlimit=3&format=json&utf8=1':
        Response.json({ query: { search: [{ title: 'Node.js' }] } }),
      'https://de.wikipedia.org/api/rest_v1/page/summary/Node.js': Response.json({
        extract: 'Node.js ist eine Plattform.',
      }),
    });
    const out = await tools(n).wiki.execute({ query: 'Node.js' }, signal);
    expect(out).toMatchObject({
      ok: true,
      data: {
        source: 'Wikipedia (CC BY-SA 4.0)',
        results: [{ title: 'Node.js', summary: 'Node.js ist eine Plattform.' }],
      },
    });
  });

  it('turns HTML entities into text, never into markup', () => {
    expect(htmlToText('<p>a &lt;b&gt; &#65;&#x42; &bogus;</p>')).toBe('a <b> AB &bogus;');
  });
});
