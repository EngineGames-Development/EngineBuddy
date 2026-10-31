// The avatar's states (spec §2). All of them exist from day one; states without their own
// art fall back to a neighbour (ARCHITECTURE.md §4.3), so adding art never needs a code change.
export const AVATAR_STATES = [
  'IDLE',
  'TALKING',
  'THINKING',
  'HAPPY',
  'CONFUSED',
  'SURPRISED',
  'WORKING',
  'CODING',
  'ERROR',
  'SUCCESS',
  'SLEEPING',
  'LISTENING',
  'EXCITED',
  'WORRIED',
] as const;

export type AvatarState = (typeof AVATAR_STATES)[number];
