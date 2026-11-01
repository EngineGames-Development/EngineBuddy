// Path normalisation and the secret-path denylist (SECURITY.md §4). Every path a tool touches is
// normalised here before any rule looks at it: %VARS% and ~ expanded, resolved against the cwd,
// symlinks/junctions and 8.3 short names resolved with realpath, then compared case-insensitively
// with forward slashes. Paths that can't be normalised safely are refused, not guessed at.
import { realpathSync } from 'node:fs';
import { win32 } from 'node:path';

export interface PathEnv {
  home: string;
  appData: string;
  localAppData: string;
  /** e.g. C:\Windows */
  systemRoot: string;
  /** Environment for %VAR% expansion (case-insensitive names). */
  vars: Readonly<Record<string, string | undefined>>;
  /** Extra files or folders to always block, e.g. EngineBuddy's own secrets file. */
  extra?: readonly string[];
}

export type Normalised = { ok: true; path: string } | { ok: false; reason: string };

/** Comparable form: lowercase, forward slashes, no trailing slash. */
export function canonical(p: string): string {
  return win32.normalize(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

export function expandVars(p: string, env: PathEnv): string | undefined {
  let unknown = false;
  const lower = Object.fromEntries(Object.entries(env.vars).map(([k, v]) => [k.toLowerCase(), v]));
  const out = p.replace(/%([^%]+)%/g, (_, name: string) => {
    const value = lower[name.toLowerCase()];
    if (value === undefined) unknown = true;
    return value ?? '';
  });
  if (unknown) return undefined;
  return out.replace(/^~(?=$|[\\/])/, env.home);
}

/** Resolve symlinks and short names for the longest existing prefix of `p`. */
export function realpathLoose(p: string, realpath: (p: string) => string = realpathSync.native): string {
  let head = p;
  const tail: string[] = [];
  for (;;) {
    try {
      return win32.join(realpath(head), ...tail.reverse());
    } catch {
      const parent = win32.dirname(head);
      if (parent === head) return p;
      tail.push(win32.basename(head));
      head = parent;
    }
  }
}

export function normalisePath(
  input: string,
  opts: { cwd: string; env: PathEnv; realpath?: (p: string) => string },
): Normalised {
  if (!input || input.includes('\0')) return { ok: false, reason: 'empty or invalid path' };
  const expanded = expandVars(input.trim(), opts.env);
  if (expanded === undefined) return { ok: false, reason: 'unknown %VARIABLE% in path' };
  // UNC shares, \\?\ and \\.\ device paths can point anywhere (and bypass normalisation). No.
  if (/^[\\/]{2}/.test(expanded)) return { ok: false, reason: 'network and device paths are not allowed' };
  // Alternate data streams (file.txt:secret) would read a different stream than the name suggests.
  if (/^[a-z]:.*:/i.test(expanded) || (!/^[a-z]:/i.test(expanded) && expanded.includes(':'))) {
    return { ok: false, reason: 'alternate data streams are not allowed' };
  }
  const absolute = win32.resolve(opts.cwd, expanded);
  return { ok: true, path: canonical(realpathLoose(absolute, opts.realpath)) };
}

export function isInside(path: string, root: string): boolean {
  return path === root || path.startsWith(root.endsWith('/') ? root : `${root}/`);
}

const BROWSER_PROFILES = [
  'google/chrome/user data',
  'google/chrome beta/user data',
  'chromium/user data',
  'microsoft/edge/user data',
  'bravesoftware/brave-browser/user data',
  'vivaldi/user data',
];

/** The denylist. Matching is on canonical paths; see `canonical`. */
export class SecretPaths {
  private readonly dirs: string[];
  private readonly files: string[];

  constructor(env: PathEnv) {
    const home = canonical(env.home);
    const appData = canonical(env.appData);
    const local = canonical(env.localAppData);
    const sys = canonical(env.systemRoot);

    // Whole folders: everything under them is blocked.
    this.dirs = [
      ...BROWSER_PROFILES.map((p) => `${local}/${p}`),
      `${appData}/opera software`,
      `${appData}/mozilla/firefox/profiles`,
      `${appData}/microsoft/credentials`,
      `${local}/microsoft/credentials`,
      `${appData}/microsoft/protect`,
      `${appData}/microsoft/vault`,
      `${local}/microsoft/vault`,
      `${home}/.ssh`,
      `${home}/.aws`,
      `${home}/.azure`,
      `${home}/.gnupg`,
      `${home}/.claude`,
      `${sys}/system32/config`,
    ];
    this.files = [
      `${home}/.kube/config`,
      `${home}/.docker/config.json`,
      `${home}/.npmrc`,
      `${home}/.git-credentials`,
      `${home}/.netrc`,
      `${home}/.pypirc`,
      `${home}/.claude.json`,
      ...(env.extra ?? []).map(canonical),
    ];
  }

  /** `path` must already be normalised. Key files are secret only outside project roots. */
  isSecret(path: string, projectRoots: readonly string[] = []): boolean {
    if (this.dirs.some((d) => isInside(path, d)) || this.files.some((f) => isInside(path, f))) return true;
    const keyFile = /\.(kdbx|pfx|p12|pem|key|ppk)$/.test(path);
    return keyFile && !projectRoots.some((root) => isInside(path, root));
  }
}

/** `.env`, `.env.local`, ... Listing them is fine; reading them needs a confirmation (Phase 2). */
export function isEnvFile(path: string): boolean {
  return /(^|\/)\.env(\.[^/]*)?$/.test(path);
}
