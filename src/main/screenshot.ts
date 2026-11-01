import { desktopCapturer, screen, type BrowserWindow } from 'electron';
import type { ImageAttachment } from '../shared/chat';

/** Claude scales larger pictures down to about this anyway; sending more only costs time. */
const MAX_SIDE = 1568;

/**
 * A screenshot of the screen `near` is on, taken only because you clicked the camera button.
 * The asking window is hidden for the moment of the capture, so it isn't in the picture.
 */
export async function takeScreenshot(near: BrowserWindow): Promise<ImageAttachment> {
  const display = screen.getDisplayMatching(near.getBounds());
  const wasVisible = near.isVisible();
  if (wasVisible) near.hide();
  try {
    // Give the compositor a moment to actually remove the window.
    await new Promise((r) => setTimeout(r, 250));
    const { width, height } = display.size;
    const factor = display.scaleFactor;
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: Math.round(width * factor), height: Math.round(height * factor) },
    });
    const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0];
    if (!source || source.thumbnail.isEmpty()) throw new Error('no screen to capture');
    let image = source.thumbnail;
    const size = image.getSize();
    const scale = Math.min(1, MAX_SIDE / Math.max(size.width, size.height));
    if (scale < 1)
      image = image.resize({
        width: Math.round(size.width * scale),
        height: Math.round(size.height * scale),
        quality: 'good',
      });
    return { mediaType: 'image/jpeg', data: image.toJPEG(85).toString('base64') };
  } finally {
    if (wasVisible) {
      near.show();
      near.focus();
    }
  }
}
