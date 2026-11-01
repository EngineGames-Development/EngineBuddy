// Phase 1 settings live in `userData/settings.json` (docs/PHASE-1.md). The file is hand-editable,
// so every field falls back to its default on its own: one bad value never resets the others.
import { z } from 'zod';
import { AGENTS } from '../../shared/settings-view';
import { LANGUAGE_PREFS } from '../../shared/i18n';
import { SCALE_MAX, SCALE_MIN } from '../../shared/layout';

const point = z.object({ x: z.number().int(), y: z.number().int() });

export const settingsSchema = z.object({
  /** Avatar scale (Ctrl+scroll on the avatar). */
  scale: z.number().min(SCALE_MIN).max(SCALE_MAX).catch(1),
  /** Avatar top-left per display ID, so each monitor remembers its own spot. */
  positions: z.record(z.string(), point).catch({}),
  /** The display the avatar was last on. */
  lastDisplayId: z.string().optional().catch(undefined),
  /** How long the bubble stays after a reply (it waits while you hover or type). */
  bubbleDismissSeconds: z.number().min(3).max(600).catch(12),
  /** Which brain: a free local model in Ollama, or the scripted mock. */
  agent: z.enum(AGENTS).catch('ollama'),
  /** The free brain: a model in Ollama on this PC (integrations/ollama). */
  ollamaModel: z.string().max(100).catch(''),
  /** Where Ollama listens. Only loopback addresses are used; anything else falls back to the default. */
  ollamaUrl: z.string().max(200).catch(''),
  /** Folders EngineBuddy may read freely. The first one is the agent's working folder. */
  projectRoots: z.array(z.string()).catch([]),
  /** Let the agent search Wikipedia and read public pages (tools/web). */
  internet: z.boolean().catch(true),
  /** UI and default reply language. "system" follows Windows. */
  language: z.enum(LANGUAGE_PREFS).catch('system'),
  /** Read replies aloud (Windows voices, in the avatar window). */
  voice: z
    .object({
      enabled: z.boolean().catch(false),
      voice: z.string().max(200).catch(''),
      rate: z.number().min(0.5).max(2).catch(1),
      pitch: z.number().min(0.5).max(1.5).catch(1),
    })
    .catch({ enabled: false, voice: '', rate: 1, pitch: 1 }),
});

export type Settings = z.infer<typeof settingsSchema>;

export function parseSettings(raw: unknown): Settings {
  return settingsSchema.parse(typeof raw === 'object' && raw !== null ? raw : {});
}
