import { type WebContents } from 'electron';
import { isOwnRendererUrl } from '../windows/renderer-url';

// Applied to every WebContents the app creates (SECURITY.md §7): no popups, no navigating away
// from our own bundled pages, no <webview>.
export function hardenWebContents(contents: WebContents): void {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));

  contents.on('will-navigate', (event, url) => {
    if (!isOwnRendererUrl(url)) event.preventDefault();
  });

  contents.on('will-attach-webview', (event) => event.preventDefault());
}
