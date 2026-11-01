// Where the bubble goes inside the avatar window: above the avatar if the screen has room there,
// otherwise below, shifted sideways to stay on screen (ARCHITECTURE.md §8.1). Pure geometry in
// the window's base coordinates (scale 1); see shared/layout.ts for the window's shape.
import { AVATAR_BOX, AVATAR_OFFSET, BUBBLE_GAP, BUBBLE_MAX_HEIGHT, WINDOW_BASE } from '../../shared/layout';

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Side = 'above' | 'below';

export interface BubblePlacement {
  side: Side;
  left: number;
  /** Distance from the window's top (below) or bottom (above), so the bubble grows away from the avatar. */
  top?: number;
  bottom?: number;
  /** Where the tail sits, from the bubble's left edge. */
  tailX: number;
}

// The visible character is smaller than its box: anchor to the top of the effects / bottom of the feet.
const HEAD_INSET = 14;
const FEET_INSET = 12;
/** Keep the bubble this far from the screen edge. */
const SCREEN_MARGIN = 6;
const TAIL_MARGIN = 18;

export const AVATAR_IN_WINDOW: Box = { ...AVATAR_OFFSET, width: AVATAR_BOX, height: AVATAR_BOX };

/** The screen's work area in the window's base coordinates. */
export function workAreaInWindow(screenArea: Box, windowPos: { x: number; y: number }, scale: number): Box {
  return {
    x: (screenArea.x - windowPos.x) / scale,
    y: (screenArea.y - windowPos.y) / scale,
    width: screenArea.width / scale,
    height: screenArea.height / scale,
  };
}

/** Pick the side once, when the bubble opens, so it doesn't flip while the reply streams in. */
export function chooseSide(work: Box, avatar: Box = AVATAR_IN_WINDOW): Side {
  const above = avatar.y + HEAD_INSET - work.y;
  const below = work.y + work.height - (avatar.y + avatar.height - FEET_INSET);
  const needed = BUBBLE_MAX_HEIGHT + BUBBLE_GAP;
  if (above >= needed) return 'above';
  if (below >= needed) return 'below';
  return above >= below ? 'above' : 'below';
}

export function placeBubble(
  side: Side,
  width: number,
  work: Box,
  avatar: Box = AVATAR_IN_WINDOW,
): BubblePlacement {
  const centre = avatar.x + avatar.width / 2;
  const minLeft = Math.max(0, work.x + SCREEN_MARGIN);
  const maxLeft = Math.min(WINDOW_BASE.width - width, work.x + work.width - width - SCREEN_MARGIN);
  const left = Math.round(Math.min(Math.max(centre - width / 2, minLeft), Math.max(minLeft, maxLeft)));
  const tailX = Math.round(Math.min(Math.max(centre - left, TAIL_MARGIN), width - TAIL_MARGIN));

  return side === 'above'
    ? { side, left, tailX, bottom: WINDOW_BASE.height - (avatar.y + HEAD_INSET - BUBBLE_GAP) }
    : { side, left, tailX, top: avatar.y + avatar.height - FEET_INSET + BUBBLE_GAP };
}
