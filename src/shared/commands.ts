// Commands: everything a renderer can ask the main process to do. Renderers display model output,
// so they are an untrusted surface (ARCHITECTURE.md §3): main parses every payload with these
// schemas before acting on it. Unknown types and unknown keys are rejected, not stripped.
import { z } from 'zod';

/** Long enough for a pasted stack trace, short enough that a runaway renderer can't flood main. */
export const MAX_INPUT_LENGTH = 8000;
/** No legitimate drag step moves the window further than this in one pointer event. */
const MAX_MOVE_STEP = 4000;

const nonBlankText = z
  .string()
  .max(MAX_INPUT_LENGTH)
  .refine((s) => s.trim().length > 0, 'must not be blank');

export const buddyCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('user_input'),
    text: nonBlankText,
    source: z.enum(['bubble', 'chat']),
  }),
  z.strictObject({ type: z.literal('cancel_turn') }),
]);

export type BuddyCommand = z.infer<typeof buddyCommandSchema>;

// Window commands act on the window that sent them; main resolves which one from the IPC sender.
// Step 3 adds drag-end (persist + snap) and scale.
const moveStep = z.number().int().min(-MAX_MOVE_STEP).max(MAX_MOVE_STEP);

export const windowCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('set_click_through'), enabled: z.boolean() }),
  z.strictObject({ type: z.literal('move_by'), dx: moveStep, dy: moveStep }),
]);

export type WindowCommand = z.infer<typeof windowCommandSchema>;
