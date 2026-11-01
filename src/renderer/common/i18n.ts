// The page's language comes from main as `?lang=` (shared/i18n.ts). Outside a page (tests) it's English.
import { langFromLocale, translator, type Lang } from '../../shared/i18n';

export const lang: Lang = langFromLocale(
  typeof location === 'undefined' ? 'en' : new URLSearchParams(location.search).get('lang'),
);

export const t = translator(lang);
