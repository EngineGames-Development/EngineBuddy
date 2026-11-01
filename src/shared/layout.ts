// Geometry of the avatar window, shared by main (which sizes and places the window) and the
// renderer (which lays out the avatar and bubble inside it).
//
// The window has a fixed shape: the avatar box sits at its exact centre, with room on every side
// for the speech bubble to open above or below it and to shift sideways near a screen edge. The
// empty area is transparent and click-through, so its size costs nothing in interaction. Keeping
// the avatar at the centre also keeps the window's centre on the avatar's monitor, which is what
// Windows uses to pick the window's DPI.
//
// All numbers are DIPs at scale 1. At scale s, the window is s times larger and the renderer
// draws everything with `transform: scale(s)`, so it can derive the scale from its own width.

export const AVATAR_BOX = 140;
export const BUBBLE_MAX_WIDTH = 300;
export const BUBBLE_MAX_HEIGHT = 240;
export const BUBBLE_GAP = 8;

const SIDE_X = BUBBLE_MAX_WIDTH - AVATAR_BOX;
const SIDE_Y = BUBBLE_MAX_HEIGHT + BUBBLE_GAP;

export const WINDOW_BASE = {
  width: AVATAR_BOX + 2 * SIDE_X,
  height: AVATAR_BOX + 2 * SIDE_Y,
} as const;

/** Where the avatar box sits inside the window, at scale 1. */
export const AVATAR_OFFSET = { x: SIDE_X, y: SIDE_Y } as const;

export const SCALE_MIN = 0.75;
// Above 1.5 the window gets taller than a 1080p screen, and Windows clamps oversized windows.
export const SCALE_MAX = 1.5;
export const SCALE_STEP = 0.125;

export function clampScale(scale: number): number {
  const stepped = Math.round(scale / SCALE_STEP) * SCALE_STEP;
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, stepped));
}
