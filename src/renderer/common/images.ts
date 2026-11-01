// Turn a pasted or dropped picture into an attachment main will accept: redrawn on a canvas
// (which also drops anything that isn't pixels, like metadata) and scaled down to what vision models
// actually looks at.
import type { ImageAttachment } from '../../shared/chat';
import { MAX_IMAGE_BASE64 } from '../../shared/images';

const MAX_SIDE = 1568;

export async function imageFromFile(file: Blob): Promise<ImageAttachment> {
  if (!file.type.startsWith('image/')) throw new Error('not a picture');
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  // PNG keeps screenshots of text sharp; fall back to JPEG when PNG gets too big.
  let url = canvas.toDataURL('image/png');
  let mediaType: ImageAttachment['mediaType'] = 'image/png';
  if (url.length > MAX_IMAGE_BASE64 * 0.8) {
    url = canvas.toDataURL('image/jpeg', 0.85);
    mediaType = 'image/jpeg';
  }
  const data = url.slice(url.indexOf(',') + 1);
  if (data.length > MAX_IMAGE_BASE64) throw new Error('picture too big');
  return { mediaType, data };
}

export const imageUrl = (img: ImageAttachment) => `data:${img.mediaType};base64,${img.data}`;
