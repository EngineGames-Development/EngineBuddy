import { describe, expect, it } from 'vitest';
import { MAX_DIFF_LINES, diffLines, splitLines } from './line-diff';

describe('diffLines', () => {
  it('shows a changed line with its context', () => {
    const before = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'].join('\n');
    const after = before.replace('e', 'E');
    expect(diffLines(before, after)).toEqual([
      { kind: 'gap', text: '1 unchanged line' },
      { kind: 'same', text: 'b' },
      { kind: 'same', text: 'c' },
      { kind: 'same', text: 'd' },
      { kind: 'del', text: 'e' },
      { kind: 'add', text: 'E' },
      { kind: 'same', text: 'f' },
      { kind: 'same', text: 'g' },
      { kind: 'same', text: 'h' },
      { kind: 'gap', text: '2 unchanged lines' },
    ]);
  });

  it('shows a new file as all additions', () => {
    expect(diffLines('', 'one\ntwo\n')).toEqual([
      { kind: 'add', text: 'one' },
      { kind: 'add', text: 'two' },
    ]);
  });

  it('treats CRLF and LF alike', () => {
    expect(diffLines('a\r\nb\r\n', 'a\nb\n')).toEqual([{ kind: 'gap', text: '2 unchanged lines' }]);
  });

  it('finds an inserted line in the middle', () => {
    const d = diffLines('a\nb\nc', 'a\nb\nX\nc');
    expect(d.filter((l) => l.kind !== 'same')).toEqual([{ kind: 'add', text: 'X' }]);
  });

  it('caps very long diffs', () => {
    const after = Array.from({ length: 1000 }, (_, i) => `line ${i}`).join('\n');
    const d = diffLines('', after);
    expect(d).toHaveLength(MAX_DIFF_LINES + 1);
    expect(d.at(-1)).toEqual({ kind: 'gap', text: '… and 600 more lines of the diff' });
  });

  it('splits lines without a phantom last line', () => {
    expect(splitLines('a\nb\n')).toEqual(['a', 'b']);
    expect(splitLines('')).toEqual([]);
  });
});
