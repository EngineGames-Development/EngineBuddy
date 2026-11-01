import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AVATAR_BOX, AVATAR_OFFSET, WINDOW_BASE } from '../../shared/layout';
import type { VoiceSettings } from '../../shared/settings-view';
import { SpeechBubble } from '../speech/SpeechBubble';
import { speak, stopSpeaking } from '../speech/voice';
import { Avatar } from './Avatar';
import { playGreeting } from './greeting';
import { installWindowInteraction } from './window-interaction';

/** Main sizes the window to WINDOW_BASE × scale, so the scale is just our width over the base. */
function useWindowScale(): number {
  const read = () => window.innerWidth / WINDOW_BASE.width;
  const [scale, setScale] = useState(read);
  useEffect(() => {
    const onResize = () => setScale(read());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return scale;
}

// Window settings main passes in the page URL (see main/windows/avatar-window.ts).
const params = new URLSearchParams(window.location.search);
const DISMISS_MS = Number(params.get('bubbleDismissMs')) || 12_000;
const GREETING = parseLines(params.get('greeting'));
const APP_START = Number(params.get('appStart')) || undefined;

function parseLines(raw: string | null): string[] {
  try {
    const value: unknown = JSON.parse(raw ?? '[]');
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/** Cold start → first greeting line, recorded for the step 10 measurement. */
function markGreeted(): void {
  if (!APP_START) return;
  const ms = Date.now() - APP_START;
  document.documentElement.dataset['greetedAfterMs'] = String(ms);
  console.info(`[avatar] greeting shown ${ms} ms after app start`);
}

/** Read each finished reply aloud when the voice is on (Settings → Voice). */
function useVoice(): void {
  useEffect(() => {
    let voice: VoiceSettings | undefined;
    let turnId: string | undefined;
    let text = '';
    const offUi = window.buddy.onUi((request) => {
      if (request.type !== 'voice') return;
      voice = request.voice;
      if (!voice.enabled) stopSpeaking();
    });
    const offEvents = window.buddy.onEvent((e) => {
      if (e.type === 'turn_start') {
        stopSpeaking();
        turnId = e.turnId;
        text = '';
      } else if (e.type === 'message_delta' && e.turnId === turnId) {
        text += e.text;
      } else if (e.type === 'message' && e.turnId === turnId && !text.trimEnd().endsWith(e.text.trim())) {
        text = `${text} ${e.text}`;
      } else if (e.type === 'turn_end' && e.turnId === turnId) {
        if (e.outcome === 'ok' && voice?.enabled) speak(text, voice);
        else stopSpeaking();
        turnId = undefined;
      } else if (e.type === 'mode_changed' && e.mode === 'sleep') {
        stopSpeaking();
      }
    });
    return () => {
      offUi();
      offEvents();
      stopSpeaking();
    };
  }, []);
}

function AvatarApp() {
  useVoice();
  const scale = useWindowScale();
  const [openSignal, setOpenSignal] = useState(0);
  useEffect(() => installWindowInteraction({ onAvatarClick: () => setOpenSignal((n) => n + 1) }), []);
  // The context menu's "Ask EngineBuddy".
  useEffect(
    () =>
      window.buddy.onUi((request) => {
        if (request.type === 'open_bubble') setOpenSignal((n) => n + 1);
      }),
    [],
  );
  useEffect(() => playGreeting(GREETING, markGreeted), []);

  return (
    <div
      className="stage"
      style={{ width: WINDOW_BASE.width, height: WINDOW_BASE.height, transform: `scale(${scale})` }}
    >
      <div
        className="avatar-box"
        style={{ left: AVATAR_OFFSET.x, top: AVATAR_OFFSET.y, width: AVATAR_BOX, height: AVATAR_BOX }}
      >
        <Avatar />
      </div>
      <SpeechBubble openSignal={openSignal} dismissMs={DISMISS_MS} scale={scale} />
    </div>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('avatar/index.html is missing #root');

createRoot(root).render(
  <StrictMode>
    <AvatarApp />
  </StrictMode>,
);
