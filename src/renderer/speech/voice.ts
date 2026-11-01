// Speaking replies aloud with the Windows voices (Web Speech API, no network, no extra cost).
// Only the words: code blocks and Markdown marks are dropped, since nobody wants to hear
// "backtick npm run dev backtick".
import type { VoiceSettings } from '../../shared/settings-view';

/** What is worth saying out loud from a Markdown reply. */
export function speakableText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?(```|$)/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*|__|[*_~#>]/g, '')
    .replace(/^\s*[-+]\s+/gm, '')
    .replace(/https?:\/\/\S+/g, 'a link')
    .replace(/\s+/g, ' ')
    .trim();
}

export function speak(text: string, voice: VoiceSettings): void {
  const words = speakableText(text);
  if (!words || typeof speechSynthesis === 'undefined') return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(words.slice(0, 2000));
  utterance.rate = voice.rate;
  const chosen = voice.voice && speechSynthesis.getVoices().find((v) => v.name === voice.voice);
  if (chosen) {
    utterance.voice = chosen;
    utterance.lang = chosen.lang;
  }
  speechSynthesis.speak(utterance);
}

export function stopSpeaking(): void {
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
}
