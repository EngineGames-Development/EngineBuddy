import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown } from './markdown';

describe('parseInline', () => {
  it('handles bold, italic and inline code', () => {
    expect(parseInline('a **b** *c* `d`')).toEqual([
      { type: 'text', text: 'a ' },
      { type: 'strong', children: [{ type: 'text', text: 'b' }] },
      { type: 'text', text: ' ' },
      { type: 'em', children: [{ type: 'text', text: 'c' }] },
      { type: 'text', text: ' ' },
      { type: 'code', text: 'd' },
    ]);
  });

  it('keeps code literal', () => {
    expect(parseInline('`**not bold**`')).toEqual([{ type: 'code', text: '**not bold**' }]);
  });

  it('leaves half-streamed markup as text', () => {
    expect(parseInline('so **bol')).toEqual([{ type: 'text', text: 'so **bol' }]);
    expect(parseInline('2 * 3 * 4')).toEqual([{ type: 'text', text: '2 * 3 * 4' }]);
  });

  it('never produces HTML: tags and links are plain text', () => {
    const text = '<img src=x onerror=alert(1)> [click](javascript:alert(1))';
    expect(parseInline(text)).toEqual([{ type: 'text', text }]);
  });
});

describe('parseMarkdown', () => {
  it('splits paragraphs on blank lines and joins wrapped lines', () => {
    expect(parseMarkdown('one\ntwo\n\nthree')).toEqual([
      { type: 'p', children: [{ type: 'text', text: 'one two' }] },
      { type: 'p', children: [{ type: 'text', text: 'three' }] },
    ]);
  });

  it('groups list items', () => {
    const blocks = parseMarkdown('Steps:\n- one\n- two\n1. first\n2. second');
    expect(blocks.map((b) => b.type)).toEqual(['p', 'ul', 'ol']);
    expect(blocks[1]).toMatchObject({ items: [[{ text: 'one' }], [{ text: 'two' }]] });
  });

  it('reads fenced code, closed or still streaming', () => {
    expect(parseMarkdown('```ld\nSECTIONS {}\n```\nafter')).toEqual([
      { type: 'code', text: 'SECTIONS {}' },
      { type: 'p', children: [{ type: 'text', text: 'after' }] },
    ]);
    expect(parseMarkdown('look:\n```\nline 1')).toEqual([
      { type: 'p', children: [{ type: 'text', text: 'look:' }] },
      { type: 'code', text: 'line 1' },
    ]);
  });
});
