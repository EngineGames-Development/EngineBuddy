// Phase 1 settings live in `userData/settings.json` (docs/PHASE-1.md). The file is hand-editable,
// so every field falls back to its default on its own: one bad value never resets the others.
import { z } from 'zod';
import { SCALE_MAX, SCALE_MIN } from '../../shared/layout';

const point = z.object({ x: z.number().int(), y: z.number().int() });

export const settingsSchema = z.object({
  /** Avatar scale (Ctrl+scroll on the avatar). */
  scale: z.number().min(SCALE_MIN).max(SCALE_MAX).catch(1),
  /** Avatar top-left per display ID, so each monitor remembers its own spot. */
  positions: z.record(z.string(), point).catch({}),
  /** The display the avatar was last on. */
  lastDisplayId: z.string().optional().catch(undefined),
});

export type Settings = z.infer<typeof settingsSchema>;

export function parseSettings(raw: unknown): Settings {
  return settingsSchema.parse(typeof raw === 'object' && raw !== null ? raw : {});
}
