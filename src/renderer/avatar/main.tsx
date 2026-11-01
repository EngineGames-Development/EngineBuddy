import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AVATAR_BOX, AVATAR_OFFSET, WINDOW_BASE } from '../../shared/layout';
import { SpeechBubble } from '../speech/SpeechBubble';
import { Avatar } from './Avatar';
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

function AvatarApp() {
  const scale = useWindowScale();
  const [openSignal, setOpenSignal] = useState(0);
  useEffect(() => installWindowInteraction({ onAvatarClick: () => setOpenSignal((n) => n + 1) }), []);

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
