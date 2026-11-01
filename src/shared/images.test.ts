import { describe, expect, it } from 'vitest';
import { buddyCommandSchema, settingsCommandSchema } from './commands';
import { MAX_IMAGES, imageSchema } from './images';

// Real file signatures, padded out to a plausible length.
const PNG = btoa(String.fromCharCode(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a) + 'x'.repeat(30));
const JPEG = btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xe0) + 'x'.repeat(30));

describe('imageSchema', () => {
  it('accepts a PNG and a JPEG with matching bytes', () => {
    expect(imageSchema.safeParse({ mediaType: 'image/png', data: PNG }).success).toBe(true);
    expect(imageSchema.safeParse({ mediaType: 'image/jpeg', data: JPEG }).success).toBe(true);
  });

  it.each([
    ['a JPEG labelled as PNG', { mediaType: 'image/png', data: JPEG }],
    ['not base64', { mediaType: 'image/png', data: `${PNG}<script>` }],
    ['an SVG', { mediaType: 'image/svg+xml', data: PNG }],
    ['an extra key', { mediaType: 'image/png', data: PNG, path: 'C:\\x' }],
    ['something huge', { mediaType: 'image/png', data: PNG + 'A'.repeat(6_000_000) }],
  ])('rejects %s', (_label, image) => {
    expect(imageSchema.safeParse(image).success).toBe(false);
  });

  it('allows a few pictures per message, not more', () => {
    const msg = (n: number) => ({
      type: 'user_input',
      text: 'look',
      source: 'chat',
      images: Array.from({ length: n }, () => ({ mediaType: 'image/png', data: PNG })),
    });
    expect(buddyCommandSchema.safeParse(msg(MAX_IMAGES)).success).toBe(true);
    expect(buddyCommandSchema.safeParse(msg(MAX_IMAGES + 1)).success).toBe(false);
  });
});

describe('chat and settings commands', () => {
  it('accepts the chat commands with proper ids only', () => {
    expect(buddyCommandSchema.safeParse({ type: 'chat_open', id: 'a1b2-c3' }).success).toBe(true);
    expect(buddyCommandSchema.safeParse({ type: 'chat_open', id: '../../secrets' }).success).toBe(false);
    expect(buddyCommandSchema.safeParse({ type: 'take_screenshot' }).success).toBe(true);
  });

  it('lets the settings window change only known settings', () => {
    const ok = { type: 'update', patch: { voice: { enabled: true, voice: '', rate: 1.2 } } };
    expect(settingsCommandSchema.safeParse(ok).success).toBe(true);
    // Folders come only from the folder picker in main, never as a path from the page.
    expect(
      settingsCommandSchema.safeParse({ type: 'update', patch: { projectRoots: ['C:\\'] } }).success,
    ).toBe(false);
    expect(settingsCommandSchema.safeParse({ type: 'add_root', path: 'C:\\' }).success).toBe(false);
    expect(
      settingsCommandSchema.safeParse({ type: 'update', patch: { claudeModel: 'x; rm -rf' } }).success,
    ).toBe(false);
  });
});
