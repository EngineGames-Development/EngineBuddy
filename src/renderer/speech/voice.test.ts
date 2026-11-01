import { describe, expect, it } from 'vitest';
import { speakableText } from './voice';

describe('speakableText', () => {
  it('keeps the words and drops Markdown and code blocks', () => {
    expect(speakableText('**Done.** Run `npm test`:\n```\nnpm test\n```\n- one\n- two')).toBe(
      'Done. Run npm test: one two',
    );
  });

  it('says "a link" instead of reading out URLs', () => {
    expect(speakableText('See https://example.com/x?y=1 for more')).toBe('See a link for more');
  });
});
