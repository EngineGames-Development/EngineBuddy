import { describe, expect, it } from 'vitest';
import { POSES } from './poses';
import { blend, frameToPose } from './tween';

const IDLE = POSES.IDLE!;
const HAPPY = POSES.HAPPY!;

describe('blend', () => {
  it('starts at the old pose and ends at the new one', () => {
    expect(frameToPose(blend(IDLE, HAPPY, 0))).toEqual(IDLE);
    expect(frameToPose(blend(IDLE, HAPPY, 1))).toEqual(HAPPY);
  });

  it('switches discrete parts at the midpoint, fading the effect out then in', () => {
    const early = blend(IDLE, HAPPY, 0.25);
    const late = blend(IDLE, HAPPY, 0.75);
    expect([early.eyes, early.effect, early.effectAlpha]).toEqual(['pill', 'none', 0.5]);
    expect([late.eyes, late.effect, late.effectAlpha]).toEqual(['happy', 'sparkles', 0.5]);
  });

  it('squashes during the transition and not after it', () => {
    expect(blend(IDLE, HAPPY, 0.5).impulse).toBeCloseTo(1);
    expect(blend(IDLE, HAPPY, 1).impulse).toBe(0);
    expect(blend(IDLE, HAPPY, 7).impulse).toBe(0);
  });

  it('clamps out-of-range progress', () => {
    expect(blend(IDLE, HAPPY, -1).mouthCurve).toBe(IDLE.mouthCurve);
    expect(blend(IDLE, HAPPY, 3).mouthCurve).toBe(HAPPY.mouthCurve);
  });
});
