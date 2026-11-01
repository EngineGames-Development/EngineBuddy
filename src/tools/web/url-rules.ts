// Rules for the web tools (SECURITY.md §11): which addresses read_web_page may open.
//
// Looking things up online is SAFE: it's what makes a companion useful, and the user can turn it
// off in Settings. The risk is the other direction: a page (or a prompt-injected file) talking the
// model into fetching an address that carries your data out, or that points into your own network.
// So read_web_page only reaches public http(s) addresses, never with a login in the URL, and an address
// that looks like it smuggles data (a long opaque blob, a huge query) is refused. These rules only
// ever say no; they never widen anything.
import { isIP } from 'node:net';

export const MAX_URL_LENGTH = 600;
const MAX_QUERY_LENGTH = 300;
/** A run this long of letters/digits with no word breaks is almost never part of a normal address. */
const OPAQUE_RUN = /[A-Za-z0-9+/=_%-]{80,}/;

export type WebVerdict = { ok: true; host: string } | { ok: false; reason: string };

const NO = {
  bad: "That address doesn't look right, so I didn't open it.",
  scheme: 'I only open normal web pages (http or https).',
  login: "That address has a login in it. I don't send those anywhere.",
  local: "That's an address inside your own computer or network. I only go to the public internet.",
  smuggle: "That address looks like it's carrying data out, so I didn't open it.",
} as const;

export function checkWebUrl(raw: string): WebVerdict {
  if (raw.length > MAX_URL_LENGTH) return { ok: false, reason: NO.smuggle };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: NO.bad };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { ok: false, reason: NO.scheme };
  if (url.username || url.password) return { ok: false, reason: NO.login };
  const host = url.hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  if (isPrivateHost(host)) return { ok: false, reason: NO.local };
  if (url.search.length > MAX_QUERY_LENGTH) return { ok: false, reason: NO.smuggle };
  if (OPAQUE_RUN.test(url.pathname + url.search + url.hash)) return { ok: false, reason: NO.smuggle };
  return { ok: true, host };
}

/** localhost, single-label names, local TLDs, and private, loopback or link-local IPs. */
export function isPrivateHost(host: string): boolean {
  if (!host) return true;
  const ipKind = isIP(host);
  if (ipKind === 4) return isPrivateV4(host);
  if (ipKind === 6) return isPrivateV6(host);
  // Numeric forms browsers still treat as IPs (http://2130706433, http://0x7f.1): refuse.
  if (/^[0-9.]+$/.test(host) || /^0x/i.test(host) || /\.0x/i.test(host)) return true;
  if (!host.includes('.')) return true;
  if (/(^|\.)(localhost|local|localdomain|internal|intranet|lan|home|corp|home\.arpa)$/.test(host))
    return true;
  // Public names that exist only to resolve to whatever IP is written in them (127.0.0.1.nip.io).
  return /(^|\.)(nip\.io|sslip\.io|xip\.io|localtest\.me|lvh\.me|traefik\.me|localhost\.run)$/.test(host);
}

function isPrivateV4(ip: string): boolean {
  const [a = 0, b = 0] = ip.split('.').map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

function isPrivateV6(ip: string): boolean {
  const v = ip.toLowerCase();
  if (v === '::' || v === '::1') return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
  if (mapped?.[1]) return isPrivateV4(mapped[1]);
  // Any other IPv4-mapped/compatible form: not worth the risk.
  if (v.startsWith('::ffff:') || v.startsWith('::')) return true;
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v);
}
