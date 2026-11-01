// Poses: what each avatar state looks like, as data (ARCHITECTURE.md §5.1). A pose is a set of
// target values for the rig; a loop adds motion on top while the state lasts. Transitions tween
// between poses, so a new state never needs transition code.
import type { AvatarState } from '../../shared/avatar';

export type EyeShape = 'pill' | 'happy' | 'x' | 'closed';
export type Effect = 'none' | 'dots' | 'sparkles' | 'question' | 'zzz' | 'gear' | 'alert';

/** Continuous rig parameters. All of them tween. */
export interface PoseNumbers {
  /** Body lift in px (negative = up). */
  bodyY: number;
  /** Vertical squash: <1 squashes, >1 stretches. Width compensates. */
  squash: number;
  /** Body tilt in degrees. */
  tilt: number;
  /** Eye height factor, 0 (shut) … 1 (open). */
  eyeOpen: number;
  /** Where the eyes look, px. */
  lookX: number;
  lookY: number;
  /** Mouth: opening 0…1, curve -1 (frown) … 1 (smile), width px. */
  mouthOpen: number;
  mouthCurve: number;
  mouthWidth: number;
  /** Arms: 0 tucked away … 1 out; raise in degrees (positive = up). */
  arms: number;
  armRaise: number;
  /** Glow strength 0…1, and how far the rim/glow colour shifts from violet to alarm red. */
  glow: number;
  alarm: number;
}

export interface Pose extends PoseNumbers {
  eyes: EyeShape;
  effect: Effect;
}

const BASE: Pose = {
  bodyY: 0,
  squash: 1,
  tilt: 0,
  eyeOpen: 1,
  lookX: 0,
  lookY: 0,
  mouthOpen: 0,
  mouthCurve: 0.35,
  mouthWidth: 14,
  arms: 0,
  armRaise: 0,
  glow: 0.5,
  alarm: 0,
  eyes: 'pill',
  effect: 'none',
};

/** The states that have their own art. Phase 1: the 7 the slice needs, plus SLEEPING for Pause. */
export const POSES: Partial<Record<AvatarState, Pose>> = {
  IDLE: BASE,
  TALKING: { ...BASE, glow: 0.65, mouthWidth: 15 },
  THINKING: {
    ...BASE,
    lookX: 4,
    lookY: -5,
    eyeOpen: 0.85,
    mouthCurve: 0,
    mouthWidth: 8,
    glow: 0.6,
    effect: 'dots',
  },
  WORKING: {
    ...BASE,
    lookY: 4,
    eyeOpen: 0.7,
    mouthCurve: 0.1,
    mouthWidth: 9,
    arms: 1,
    armRaise: 10,
    glow: 0.75,
    effect: 'gear',
  },
  HAPPY: {
    ...BASE,
    bodyY: -3,
    eyes: 'happy',
    mouthCurve: 1,
    mouthOpen: 0.45,
    mouthWidth: 20,
    arms: 1,
    armRaise: 30,
    glow: 0.95,
    effect: 'sparkles',
  },
  CONFUSED: {
    ...BASE,
    tilt: -9,
    lookX: -3,
    lookY: -2,
    eyeOpen: 0.9,
    mouthCurve: -0.35,
    mouthWidth: 9,
    effect: 'question',
  },
  ERROR: {
    ...BASE,
    squash: 0.96,
    eyes: 'x',
    mouthCurve: -0.8,
    mouthWidth: 16,
    glow: 0.45,
    alarm: 1,
    effect: 'alert',
  },
  SLEEPING: {
    ...BASE,
    squash: 0.94,
    eyes: 'closed',
    mouthCurve: 0.15,
    mouthWidth: 6,
    glow: 0.2,
    effect: 'zzz',
  },
};

/** States without art borrow their nearest neighbour's (ARCHITECTURE.md §4.3). */
export const FALLBACK: Partial<Record<AvatarState, AvatarState>> = {
  SUCCESS: 'HAPPY',
  EXCITED: 'HAPPY',
  CODING: 'WORKING',
  SURPRISED: 'CONFUSED',
  WORRIED: 'CONFUSED',
  LISTENING: 'IDLE',
};

export function poseFor(state: AvatarState): Pose {
  return POSES[state] ?? POSES[FALLBACK[state] ?? 'IDLE'] ?? BASE;
}

/** Which state's art is actually drawn for `state`. */
export function artFor(state: AvatarState): AvatarState {
  return POSES[state] ? state : (FALLBACK[state] ?? 'IDLE');
}

/**
 * Motion on top of a pose while the state lasts. `t` is seconds since the state began. Returns
 * offsets that are added to the tweened pose.
 */
export function loopFor(state: AvatarState, t: number): Partial<PoseNumbers> {
  const breathe = Math.sin(t * 2.2) * 0.012;
  switch (artFor(state)) {
    case 'TALKING':
      // Irregular open/close at a speech-like rhythm (two sines so it doesn't look mechanical).
      return {
        squash: breathe,
        mouthOpen: 0.15 + 0.55 * Math.abs(Math.sin(t * 9) * 0.7 + Math.sin(t * 13.7) * 0.3),
      };
    case 'THINKING':
      return { tilt: Math.sin(t * 1.4) * 3, bodyY: Math.sin(t * 2.8) * 0.8, squash: breathe };
    case 'WORKING':
      // Typing: arms alternate quickly, head bobs slightly with them.
      return { armRaise: Math.sin(t * 16) * 9, bodyY: Math.abs(Math.sin(t * 8)) * -0.8 };
    case 'HAPPY':
      return { bodyY: -Math.abs(Math.sin(t * 7)) * 4, armRaise: Math.sin(t * 10) * 12 };
    case 'ERROR':
      // A short shake when it starts, then still.
      return { tilt: t < 0.5 ? Math.sin(t * 50) * 4 * (1 - t * 2) : 0 };
    case 'SLEEPING':
      return { squash: Math.sin(t * 1.1) * 0.025, bodyY: Math.sin(t * 1.1) * 0.6 };
    default:
      return { squash: breathe };
  }
}

/** Does this state's loop need a full frame rate, or is it slow enough to throttle? */
export function isCalm(state: AvatarState): boolean {
  const art = artFor(state);
  return art === 'IDLE' || art === 'SLEEPING' || art === 'CONFUSED';
}
