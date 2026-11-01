// Images from renderers (pasted, dropped, screenshots) are untrusted bytes. Main accepts only the
// four formats Claude reads, checks the declared type against the file's own signature, and caps
// the size, so a renderer can't pass off something else as a picture.
import { z } from 'zod';
import type { ImageMediaType } from './chat';

export const MAX_IMAGES = 4;
/** ~3.7 MB of picture. Renderers downscale to 1568 px first, which keeps real screenshots far below. */
export const MAX_IMAGE_BASE64 = 5_000_000;

const SIGNATURES: Record<ImageMediaType, (b: Uint8Array) => boolean> = {
  'image/png': (b) => [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v),
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/gif': (b) => String.fromCharCode(...b.slice(0, 4)) === 'GIF8',
  'image/webp': (b) =>
    String.fromCharCode(...b.slice(0, 4)) === 'RIFF' && String.fromCharCode(...b.slice(8, 12)) === 'WEBP',
};

/** The first bytes of a base64 string (enough for any signature above). */
function head(base64: string): Uint8Array {
  try {
    const bin = atob(base64.slice(0, 24));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  } catch {
    return new Uint8Array();
  }
}

export function matchesSignature(mediaType: ImageMediaType, base64: string): boolean {
  return SIGNATURES[mediaType](head(base64));
}

export const imageSchema = z
  .strictObject({
    mediaType: z.enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp']),
    data: z
      .string()
      .min(16)
      .max(MAX_IMAGE_BASE64)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'must be base64'),
  })
  .refine((img) => matchesSignature(img.mediaType, img.data), "bytes don't match the image type");
