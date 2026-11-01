import { describe, expect, it } from 'vitest';
import { LANGUAGES, langFromLocale, resolveLang, translator, type MessageKey } from './i18n';

describe('i18n', () => {
  it('follows the system language, falling back to English', () => {
    expect(langFromLocale('de-DE')).toBe('de');
    expect(langFromLocale('fr_CA')).toBe('fr');
    expect(langFromLocale('ja-JP')).toBe('en');
    expect(langFromLocale(undefined)).toBe('en');
    expect(resolveLang('system', 'es-MX')).toBe('es');
    expect(resolveLang('de', 'en-US')).toBe('de');
  });

  it('fills in placeholders', () => {
    expect(translator('de')('chat.maxPictures', { n: 4 })).toBe('Höchstens 4 Bilder pro Nachricht.');
    expect(translator('en')('chat.deleteAsk', { title: 'x' })).toBe('Delete "x"?');
  });

  it('every language keeps the placeholders', () => {
    const keys: MessageKey[] = ['chat.maxPictures', 'chat.deleteAsk', 'settings.languageSystem'];
    const en = translator('en');
    for (const lang of LANGUAGES) {
      const t = translator(lang);
      for (const key of keys) expect(t(key).match(/\{\w+\}/g)).toEqual(en(key).match(/\{\w+\}/g));
    }
  });
});
