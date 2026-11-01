import { describe, expect, it } from 'vitest';
import {
  EDGE_MARGIN,
  clampInto,
  displayFor,
  rescue,
  restoreSpot,
  snapToCorner,
  type DisplayArea,
} from './placement';

const primary: DisplayArea = { id: '1', workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
const right: DisplayArea = { id: '2', workArea: { x: 1920, y: 0, width: 2560, height: 1400 } };
const SIZE = 140;

describe('restoreSpot', () => {
  it('defaults to the bottom-right of the primary work area', () => {
    const spot = restoreSpot({
      size: SIZE,
      displays: [primary],
      primaryId: '1',
      lastDisplayId: undefined,
      saved: {},
    });
    expect(spot).toEqual({
      displayId: '1',
      topLeft: { x: 1920 - SIZE - EDGE_MARGIN, y: 1040 - SIZE - EDGE_MARGIN },
    });
  });

  it('restores the position saved for the last display', () => {
    const spot = restoreSpot({
      size: SIZE,
      displays: [primary, right],
      primaryId: '1',
      lastDisplayId: '2',
      saved: { '2': { x: 2500, y: 300 } },
    });
    expect(spot).toEqual({ displayId: '2', topLeft: { x: 2500, y: 300 } });
  });

  it('falls back to the primary display when the last one is unplugged', () => {
    const spot = restoreSpot({
      size: SIZE,
      displays: [primary],
      primaryId: '1',
      lastDisplayId: '2',
      saved: { '2': { x: 2500, y: 300 } },
    });
    expect(spot.displayId).toBe('1');
    expect(spot.topLeft.x).toBeLessThan(1920);
  });

  it('clamps a saved position that no longer fits (resolution got smaller)', () => {
    const spot = restoreSpot({
      size: SIZE,
      displays: [primary],
      primaryId: '1',
      lastDisplayId: '1',
      saved: { '1': { x: 3000, y: -50 } },
    });
    expect(spot.topLeft).toEqual({ x: 1920 - SIZE, y: 0 });
  });
});

describe('rescue', () => {
  it('leaves an avatar that is fully on-screen alone', () => {
    expect(rescue({ x: 100, y: 100, width: SIZE, height: SIZE }, [primary], '1')).toBeUndefined();
  });

  it('brings an avatar back from an unplugged monitor', () => {
    const r = rescue({ x: 3000, y: 500, width: SIZE, height: SIZE }, [primary], '1');
    expect(r).toEqual({ x: 1920 - SIZE, y: 500, width: SIZE, height: SIZE });
  });

  it('pulls back an avatar hanging off the edge of its display', () => {
    const r = rescue({ x: -40, y: 1000, width: SIZE, height: SIZE }, [primary, right], '1');
    expect(r).toEqual({ x: 0, y: 1040 - SIZE, width: SIZE, height: SIZE });
  });
});

describe('snapToCorner', () => {
  const area = primary.workArea;

  it('snaps when dropped near a corner', () => {
    expect(snapToCorner({ x: 1920 - SIZE - 40, y: 20, width: SIZE, height: SIZE }, area)).toEqual({
      x: 1920 - SIZE - EDGE_MARGIN,
      y: EDGE_MARGIN,
    });
  });

  it('does not snap when only near one edge', () => {
    expect(snapToCorner({ x: 10, y: 500, width: SIZE, height: SIZE }, area)).toBeUndefined();
  });

  it('does not snap in the middle of the screen', () => {
    expect(snapToCorner({ x: 900, y: 450, width: SIZE, height: SIZE }, area)).toBeUndefined();
  });
});

describe('clampInto / displayFor', () => {
  it('rounds to whole pixels', () => {
    expect(clampInto({ x: 10.4, y: 10.6, width: 10, height: 10 }, primary.workArea)).toMatchObject({
      x: 10,
      y: 11,
    });
  });

  it('picks the display with the largest overlap', () => {
    expect(displayFor({ x: 1900, y: 10, width: SIZE, height: SIZE }, [primary, right])?.id).toBe('2');
    expect(displayFor({ x: 9000, y: 10, width: SIZE, height: SIZE }, [primary, right])).toBeUndefined();
  });
});
