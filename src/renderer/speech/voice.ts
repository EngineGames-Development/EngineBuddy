// Speaking replies aloud with the Windows voices (Web Speech API, no network, no extra cost).
// Only the words: code blocks and Markdown marks are dropped, since nobody wants to hear
// "backtick npm run dev backtick".
//
// "Automatic" picks the best installed voice for the language the reply is written in: natural
// (neural) voices first, then the system default for that language. Replies are spoken sentence by
// sentence, because Chromium cuts off long utterances on some Windows voices.
import { LANGUAGES, type Lang } from '../../shared/i18n';
import type { VoiceSettings } from '../../shared/settings-view';
import { lang as uiLang } from '../common/i18n';

const MAX_SPOKEN = 2000;
const MAX_CHUNK = 220;

/** What is worth saying out loud from a Markdown reply. */
export function speakableText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*|__|[*_~#>|]/g, '')
    .replace(/^\s*[-+]\s+/gm, '')
    .replace(/https?:\/\/\S+/g, 'a link')
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const STOPWORDS: Record<Lang, readonly string[]> = {
  en: ['the', 'and', 'is', 'you', 'that', 'it', 'to', 'of', 'this', 'with', 'your', 'for'],
  de: ['der', 'die', 'das', 'und', 'ist', 'du', 'nicht', 'ich', 'mit', 'ein', 'eine', 'dein', 'auf'],
  fr: ['le', 'la', 'les', 'et', 'est', 'tu', 'pas', 'je', 'avec', 'une', 'des', 'ton', 'pour'],
  es: ['el', 'la', 'los', 'y', 'es', 'tú', 'no', 'yo', 'con', 'una', 'que', 'tu', 'para'],
};

/** A rough guess at which of our languages a text is in (by common words); `fallback` if unclear. */
export function guessLanguage(text: string, fallback: Lang): Lang {
  const words = text.toLowerCase().match(/[\p{L}]+/gu) ?? [];
  let best: Lang = fallback;
  let bestScore = 1; // need at least two hits to override the fallback
  for (const l of LANGUAGES) {
    const set = new Set(STOPWORDS[l]);
    const score = words.reduce((n, w) => n + (set.has(w) ? 1 : 0), 0);
    if (score > bestScore) {
      best = l;
      bestScore = score;
    }
  }
  return best;
}

export interface VoiceLike {
  name: string;
  lang: string;
  default: boolean;
  localService: boolean;
}

/** The voice to use: the one chosen in Settings if installed, else the best one for `lang`. */
export function pickVoice<V extends VoiceLike>(
  voices: readonly V[],
  lang: Lang,
  chosen: string,
): V | undefined {
  if (chosen) {
    const named = voices.find((v) => v.name === chosen);
    if (named) return named;
  }
  const score = (v: V) =>
    (/natural|neural/i.test(v.name) ? 10 : 0) + (/online/i.test(v.name) ? 3 : 0) + (v.default ? 1 : 0);
  return voices.filter((v) => v.lang.toLowerCase().startsWith(lang)).sort((a, b) => score(b) - score(a))[0];
}

/** Sentences, packed into chunks short enough to be spoken in one go. */
export function speechChunks(text: string, max = MAX_CHUNK): string[] {
  const sentences = text.match(/[^.!?…]+[.!?…]*\s*/g) ?? [];
  const chunks: string[] = [];
  let current = '';
  for (const s of sentences) {
    for (let piece = s; piece; piece = piece.slice(max)) {
      const part = piece.slice(0, max);
      if ((current + part).length > max && current) {
        chunks.push(current.trim());
        current = '';
      }
      current += part;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

export function speak(text: string, voice: VoiceSettings): void {
  const words = speakableText(text).slice(0, MAX_SPOKEN);
  if (!words || typeof speechSynthesis === 'undefined') return;
  speechSynthesis.cancel();
  const lang = guessLanguage(words, uiLang);
  const chosen = pickVoice(speechSynthesis.getVoices(), lang, voice.voice);
  for (const chunk of speechChunks(words)) {
    const utterance = new SpeechSynthesisUtterance(chunk);
    utterance.rate = voice.rate;
    utterance.pitch = voice.pitch;
    if (chosen) {
      utterance.voice = chosen;
      utterance.lang = chosen.lang;
    } else {
      utterance.lang = lang;
    }
    speechSynthesis.speak(utterance);
  }
}

export function stopSpeaking(): void {
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
}
