import { describe, expect, it } from 'vitest';
import { guessLanguage, pickVoice, speakableText, speechChunks } from './voice';

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

describe('voice choice', () => {
  const v = (name: string, lang: string, isDefault = false) => ({
    name,
    lang,
    default: isDefault,
    localService: true,
  });
  const voices = [
    v('Microsoft David', 'en-US', true),
    v('Microsoft Hedda', 'de-DE'),
    v('Microsoft Katja Online (Natural)', 'de-DE'),
    v('Microsoft Hortense', 'fr-FR'),
  ];

  it('prefers natural voices for the language', () => {
    expect(pickVoice(voices, 'de', '')?.name).toBe('Microsoft Katja Online (Natural)');
    expect(pickVoice(voices, 'fr', '')?.name).toBe('Microsoft Hortense');
    expect(pickVoice(voices, 'es', '')).toBeUndefined();
  });

  it('uses the voice picked in Settings when it is installed', () => {
    expect(pickVoice(voices, 'de', 'Microsoft Hedda')?.name).toBe('Microsoft Hedda');
    expect(pickVoice(voices, 'de', 'Gone')?.name).toBe('Microsoft Katja Online (Natural)');
  });

  it('guesses the language of a reply', () => {
    expect(guessLanguage('Das ist nicht so schlimm, ich mache das mit dir.', 'en')).toBe('de');
    expect(guessLanguage('That is fine, and you can do it with this.', 'de')).toBe('en');
    expect(guessLanguage('Ok.', 'fr')).toBe('fr');
  });

  it('splits long text into sentence chunks', () => {
    const text = 'One. Two! Three? ' + 'word '.repeat(100);
    const chunks = speechChunks(text, 50);
    expect(chunks.every((c) => c.length <= 50)).toBe(true);
    expect(chunks.join(' ').replace(/\s+/g, ' ')).toBe(text.trim().replace(/\s+/g, ' '));
  });

  it('drops emoji and keeps link labels', () => {
    expect(speakableText('Done 🎉 see [the docs](https://x.y/z).')).toBe('Done see the docs.');
  });
});
