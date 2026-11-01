// Blending between poses. Pure functions, so the transition maths is testable without a DOM.
import type { Effect, EyeShape, Pose, PoseNumbers } from './poses';

/** What the rig draws in one frame: a pose, plus how visible the effect layer is. */
export interface Frame extends PoseNumbers {
  eyes: EyeShape;
  effect: Effect;
  effectAlpha: number;
  /** Extra squash-and-stretch on state change, 0…1 (peaks mid-transition). */
  impulse: number;
}

const NUMBER_KEYS = [
  'bodyY',
  'squash',
  'tilt',
  'eyeOpen',
  'lookX',
  'lookY',
  'mouthOpen',
  'mouthCurve',
  'mouthWidth',
  'arms',
  'armRaise',
  'glow',
  'alarm',
] as const satisfies ReadonlyArray<keyof PoseNumbers>;

export const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

/**
 * The frame `t` (0…1) of the way from `from` to `to`. Numbers ease; discrete parts (eye shape,
 * effect) switch at the midpoint, with the old effect fading out and the new one fading in.
 */
export function blend(from: Pose, to: Pose, progress: number): Frame {
  const t = Math.min(1, Math.max(0, progress));
  const k = easeOutCubic(t);
  const frame = { ...to } as Frame;
  for (const key of NUMBER_KEYS) frame[key] = from[key] + (to[key] - from[key]) * k;

  const second = t >= 0.5;
  frame.eyes = second ? to.eyes : from.eyes;
  if (from.effect === to.effect) {
    frame.effect = to.effect;
    frame.effectAlpha = 1;
  } else {
    frame.effect = second ? to.effect : from.effect;
    frame.effectAlpha = second ? (t - 0.5) * 2 : 1 - t * 2;
  }
  frame.impulse = t < 1 ? Math.sin(Math.PI * t) : 0;
  return frame;
}

/** The current frame as a pose, so an interrupted transition can start from where it is. */
export function frameToPose(frame: Frame): Pose {
  const pose = { eyes: frame.eyes, effect: frame.effect } as Pose;
  for (const key of NUMBER_KEYS) pose[key] = frame[key];
  return pose;
}

export function addOffsets(frame: Frame, offsets: Partial<PoseNumbers>): Frame {
  const out = { ...frame };
  for (const [key, value] of Object.entries(offsets) as Array<[keyof PoseNumbers, number]>) out[key] += value;
  return out;
}
