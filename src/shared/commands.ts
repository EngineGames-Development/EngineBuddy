// Commands: everything a renderer can ask the main process to do. Renderers display model output,
// so they are an untrusted surface (ARCHITECTURE.md §3): main parses every payload with these
// schemas before acting on it. Unknown types and unknown keys are rejected, not stripped.
import { z } from 'zod';
import { LANGUAGE_PREFS } from './i18n';
import { AGENTS } from './settings-view';
import { MAX_IMAGES, imageSchema } from './images';

/** Long enough for a pasted stack trace, short enough that a runaway renderer can't flood main. */
export const MAX_INPUT_LENGTH = 8000;
/** No legitimate drag step moves the window further than this in one pointer event. */
const MAX_MOVE_STEP = 4000;

const id = z.string().regex(/^[a-z0-9-]{1,64}$/);

const nonBlankText = z
  .string()
  .max(MAX_INPUT_LENGTH)
  .refine((s) => s.trim().length > 0, 'must not be blank');

export const buddyCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('user_input'),
    text: nonBlankText,
    source: z.enum(['bubble', 'chat']),
    images: z.array(imageSchema).min(1).max(MAX_IMAGES).optional(),
  }),
  z.strictObject({ type: z.literal('cancel_turn') }),
  // Chat window: history (main replies with a ChatPush to the chat window).
  z.strictObject({ type: z.literal('chat_ready') }),
  z.strictObject({ type: z.literal('chat_new') }),
  z.strictObject({ type: z.literal('chat_open'), id }),
  z.strictObject({ type: z.literal('chat_delete'), id }),
  /** Main hides the chat window, captures the screen, and hands the picture back as an attachment. */
  z.strictObject({ type: z.literal('take_screenshot') }),
  z.strictObject({ type: z.literal('open_chat') }),
  z.strictObject({ type: z.literal('open_settings') }),
]);

export type BuddyCommand = z.infer<typeof buddyCommandSchema>;

// Window commands act on the window that sent them; main resolves which one from the IPC sender.
const moveStep = z.number().int().min(-MAX_MOVE_STEP).max(MAX_MOVE_STEP);

export const windowCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('set_click_through'), enabled: z.boolean() }),
  z.strictObject({ type: z.literal('move_by'), dx: moveStep, dy: moveStep }),
  /** The drag finished: main snaps to a nearby corner and saves the position. */
  z.strictObject({ type: z.literal('drag_end') }),
  /** Ctrl+scroll: grow or shrink by whole scale steps. */
  z.strictObject({ type: z.literal('scale_by'), steps: z.number().int().min(-4).max(4) }),
  /** Right-click on the avatar: main pops up the context menu at the cursor. */
  z.strictObject({ type: z.literal('context_menu') }),
]);

export type WindowCommand = z.infer<typeof windowCommandSchema>;

/** Your answer in the confirmation window. Main also checks which window sent it. */
export const confirmAnswerSchema = z.strictObject({
  id,
  allowed: z.boolean(),
});

export type ConfirmAnswer = z.infer<typeof confirmAnswerSchema>;

// Settings window → main. Main accepts these only from the settings window (it shows no model text).
export const voiceSettingsSchema = z.strictObject({
  enabled: z.boolean(),
  voice: z.string().max(200),
  rate: z.number().min(0.5).max(2),
  pitch: z.number().min(0.5).max(1.5).default(1),
});

export const settingsCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('ready') }),
  z.strictObject({
    type: z.literal('update'),
    patch: z
      .strictObject({
        agent: z.enum(AGENTS),
        ollamaModel: z
          .string()
          .max(100)
          .regex(/^[\w.:/-]*$/, 'not a model name'),
        claudeModel: z
          .string()
          .max(100)
          .regex(/^[\w.:[\]-]*$/, 'not a model name'),
        bubbleDismissSeconds: z.number().int().min(3).max(600),
        voice: voiceSettingsSchema,
        internet: z.boolean(),
        language: z.enum(LANGUAGE_PREFS),
      })
      .partial(),
  }),
  /** Main opens a folder picker; only what you pick there is added. */
  z.strictObject({ type: z.literal('add_root') }),
  z.strictObject({ type: z.literal('remove_root'), path: z.string().min(1).max(1024) }),
  z.strictObject({ type: z.literal('forget'), id }),
  z.strictObject({ type: z.literal('forget_all') }),
  z.strictObject({ type: z.literal('restart') }),
]);

export type SettingsCommand = z.infer<typeof settingsCommandSchema>;
