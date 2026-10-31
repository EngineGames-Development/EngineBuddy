import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

function AvatarPlaceholder() {
  return (
    <div className="placeholder" title="EngineBuddy (scaffold)">
      •‿•
    </div>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('avatar/index.html is missing #root');

createRoot(root).render(
  <StrictMode>
    <AvatarPlaceholder />
  </StrictMode>,
);
