// Where the avatar goes on screen: restore, clamp, snap. Pure geometry so it can be tested
// without Electron; main feeds it `screen` data and applies the result (ARCHITECTURE.md §8.1).
// Everything works on the avatar's own rectangle, never the (much larger, mostly empty) window.

export interface Point {
  x: number;
  y: number;
}

export interface Rect extends Point {
  width: number;
  height: number;
}

export interface DisplayArea {
  id: string;
  workArea: Rect;
}

/** Gap kept between the avatar and the screen edge when placed by default or snapped. */
export const EDGE_MARGIN = 16;
/** Dropping the avatar this close to a corner snaps it into the corner. */
export const SNAP_DISTANCE = 48;

export function clampInto(rect: Rect, area: Rect): Rect {
  const x = Math.min(Math.max(rect.x, area.x), area.x + area.width - rect.width);
  const y = Math.min(Math.max(rect.y, area.y), area.y + area.height - rect.height);
  return { ...rect, x: Math.round(x), y: Math.round(y) };
}

/** The default spot: bottom-right of the work area, above the taskbar. */
export function defaultSpot(size: number, area: Rect): Point {
  return {
    x: area.x + area.width - size - EDGE_MARGIN,
    y: area.y + area.height - size - EDGE_MARGIN,
  };
}

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** The display the rect overlaps most, or undefined if it's on none of them. */
export function displayFor(rect: Rect, displays: readonly DisplayArea[]): DisplayArea | undefined {
  let best: DisplayArea | undefined;
  let bestArea = 0;
  for (const d of displays) {
    const area = overlapArea(rect, d.workArea);
    if (area > bestArea) [best, bestArea] = [d, area];
  }
  return best;
}

/**
 * Where to put the avatar at startup. Uses the position saved for the last display it was on,
 * if that display still exists; otherwise the default spot on the primary display. Always clamped
 * into the chosen work area, so a changed resolution can't leave it off-screen.
 */
export function restoreSpot(opts: {
  size: number;
  displays: readonly DisplayArea[];
  primaryId: string;
  lastDisplayId: string | undefined;
  saved: Readonly<Record<string, Point>>;
}): { displayId: string; topLeft: Point } {
  const { size, displays, primaryId, lastDisplayId, saved } = opts;
  const last = displays.find((d) => d.id === lastDisplayId);
  const savedPoint = last && saved[last.id];
  const display = (savedPoint && last) || displays.find((d) => d.id === primaryId) || displays[0];
  if (!display) throw new Error('restoreSpot: no displays');

  const wanted = savedPoint ?? defaultSpot(size, display.workArea);
  const clamped = clampInto({ ...wanted, width: size, height: size }, display.workArea);
  return { displayId: display.id, topLeft: { x: clamped.x, y: clamped.y } };
}

/**
 * After a monitor is unplugged or its resolution changes: if the avatar is no longer fully
 * inside the work area it mostly sits on (or on no display at all), the clamped position on the
 * nearest one. Undefined if it's fine where it is.
 */
export function rescue(rect: Rect, displays: readonly DisplayArea[], primaryId: string): Rect | undefined {
  const home = displayFor(rect, displays) ?? displays.find((d) => d.id === primaryId) ?? displays[0];
  if (!home) return undefined;
  const clamped = clampInto(rect, home.workArea);
  return clamped.x === rect.x && clamped.y === rect.y ? undefined : clamped;
}

/** If the rect was dropped near a corner of the work area, its snapped position there. */
export function snapToCorner(rect: Rect, area: Rect): Point | undefined {
  const left = area.x + EDGE_MARGIN;
  const right = area.x + area.width - rect.width - EDGE_MARGIN;
  const top = area.y + EDGE_MARGIN;
  const bottom = area.y + area.height - rect.height - EDGE_MARGIN;

  const x =
    Math.abs(rect.x - left) <= SNAP_DISTANCE
      ? left
      : Math.abs(rect.x - right) <= SNAP_DISTANCE
        ? right
        : undefined;
  const y =
    Math.abs(rect.y - top) <= SNAP_DISTANCE
      ? top
      : Math.abs(rect.y - bottom) <= SNAP_DISTANCE
        ? bottom
        : undefined;
  return x !== undefined && y !== undefined ? { x, y } : undefined;
}
