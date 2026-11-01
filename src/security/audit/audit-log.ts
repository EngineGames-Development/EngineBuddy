// The audit log (SECURITY.md §6): one JSON line per tool request, allowed or not, in
// `userData/logs/audit-YYYY-MM-DD.jsonl`. Kept for 30 days. Inputs are redacted before writing:
// secret-looking keys are masked and long strings are cut.
import { appendFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export interface AuditEntry {
  turnId?: string;
  tool: string;
  input: unknown;
  /**
   * 'allow' / 'deny' at a gate; 'ask' when a gate passes a CONFIRM request on to be confirmed;
   * 'result' after our own tool ran. `by: 'user'` marks your answer in the confirmation window.
   */
  event: 'allow' | 'deny' | 'ask' | 'result';
  permission?: string;
  /** Which gate or component recorded it. */
  by: string;
  rule?: string;
  reason?: string;
  ok?: boolean;
  summary?: string;
  durationMs?: number;
}

const RETENTION_DAYS = 30;
const MAX_STRING = 300;
const SECRET_KEY = /(token|secret|password|passwd|api[_-]?key|auth|cookie|credential)/i;

export function redact(value: unknown, depth = 0): unknown {
  if (typeof value === 'string')
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…(${value.length})` : value;
  if (depth > 4 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([k, v]) => [k, SECRET_KEY.test(k) ? '[redacted]' : redact(v, depth + 1)]),
  );
}

export interface AuditSink {
  record(entry: AuditEntry): void;
}

export class AuditLog implements AuditSink {
  constructor(
    private readonly dir: string,
    private readonly now: () => Date = () => new Date(),
  ) {
    mkdirSync(dir, { recursive: true });
    this.prune();
  }

  record(entry: AuditEntry): void {
    const at = this.now();
    const line = JSON.stringify({ ts: at.toISOString(), ...entry, input: redact(entry.input) });
    try {
      appendFileSync(join(this.dir, `audit-${day(at)}.jsonl`), `${line}\n`);
    } catch (error) {
      // Never let logging break a turn, but make the failure visible.
      console.error('[audit] write failed:', error);
    }
  }

  private prune(): void {
    const cutoff = day(new Date(this.now().getTime() - RETENTION_DAYS * 86_400_000));
    for (const name of readdirSync(this.dir)) {
      const m = /^audit-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(name);
      if (m?.[1] && m[1] < cutoff) rmSync(join(this.dir, name), { force: true });
    }
  }
}

function day(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
