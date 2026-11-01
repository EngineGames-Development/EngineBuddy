// A small line diff for the confirmation window: what a file change would do, with a few lines
// of context around each change. Pure, so the file tools and tests share it.
import type { DiffLine } from '../../shared/events';

const CONTEXT = 3;
/** Above this many cells the LCS table gets slow; the changed middle is shown as delete + add. */
const MAX_CELLS = 4_000_000;
/** The confirmation window shows at most this many lines; the rest is summarised. */
export const MAX_DIFF_LINES = 400;
/** Longer lines (minified code) are cut: the request travels to the window in its URL. */
const MAX_LINE = 300;

const cut = (line: DiffLine): DiffLine =>
  line.text.length > MAX_LINE ? { ...line, text: `${line.text.slice(0, MAX_LINE)}…` } : line;

export function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Every line, marked same / add / del. */
export function diffAll(before: string[], after: string[]): DiffLine[] {
  // Trim the common start and end first: most edits touch a small part of a file.
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let endB = before.length;
  let endA = after.length;
  while (endB > start && endA > start && before[endB - 1] === after[endA - 1]) {
    endB--;
    endA--;
  }
  const same = (lines: string[]): DiffLine[] => lines.map((text) => ({ kind: 'same', text }));
  return [
    ...same(before.slice(0, start)),
    ...middle(before.slice(start, endB), after.slice(start, endA)),
    ...same(before.slice(endB)),
  ];
}

function middle(a: string[], b: string[]): DiffLine[] {
  const del = (text: string): DiffLine => ({ kind: 'del', text });
  const add = (text: string): DiffLine => ({ kind: 'add', text });
  if (a.length * b.length > MAX_CELLS) return [...a.map(del), ...b.map(add)];

  // Classic LCS table, then walk it from the top.
  const w = b.length + 1;
  const lcs = new Uint32Array((a.length + 1) * w);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i * w + j] =
        a[i] === b[j] ? lcs[(i + 1) * w + j + 1]! + 1 : Math.max(lcs[(i + 1) * w + j]!, lcs[i * w + j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i]! });
      i++;
      j++;
    } else if (lcs[(i + 1) * w + j]! >= lcs[i * w + j + 1]!) out.push(del(a[i++]!));
    else out.push(add(b[j++]!));
  }
  while (i < a.length) out.push(del(a[i++]!));
  while (j < b.length) out.push(add(b[j++]!));
  return out;
}

/** The diff as shown: changes with CONTEXT lines around them, the rest folded into gaps. */
export function diffLines(before: string, after: string): DiffLine[] {
  const all = diffAll(splitLines(before), splitLines(after));
  const keep = all.map(() => false);
  all.forEach((line, i) => {
    if (line.kind === 'same') return;
    for (let k = Math.max(0, i - CONTEXT); k <= Math.min(all.length - 1, i + CONTEXT); k++) keep[k] = true;
  });

  const out: DiffLine[] = [];
  let skipped = 0;
  const flush = () => {
    if (skipped) out.push({ kind: 'gap', text: `${skipped} unchanged line${skipped === 1 ? '' : 's'}` });
    skipped = 0;
  };
  all.forEach((line, i) => {
    if (!keep[i]) {
      skipped++;
      return;
    }
    flush();
    out.push(cut(line));
  });
  flush();

  if (out.length <= MAX_DIFF_LINES) return out;
  const rest = out.length - MAX_DIFF_LINES;
  return [...out.slice(0, MAX_DIFF_LINES), { kind: 'gap', text: `… and ${rest} more lines of the diff` }];
}
