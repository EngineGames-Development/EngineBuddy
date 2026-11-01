import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AVATAR_BOX, AVATAR_OFFSET, WINDOW_BASE } from '../../shared/layout';
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

function AvatarApp() {
  const scale = useWindowScale();
  useEffect(() => installWindowInteraction(), []);

  return (
    <div
      className="stage"
      style={{ width: WINDOW_BASE.width, height: WINDOW_BASE.height, transform: `scale(${scale})` }}
    >
      <div
        className="avatar-box"
        style={{ left: AVATAR_OFFSET.x, top: AVATAR_OFFSET.y, width: AVATAR_BOX, height: AVATAR_BOX }}
      >
        {/* Step 3 placeholder. The real character (SVG rig) arrives in Step 4. */}
        <div className="placeholder" data-hit data-drag title="EngineBuddy">
          •‿•
        </div>
      </div>
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
