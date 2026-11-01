// What the settings window shows and may change. Main owns the settings file; the settings window
// only ever sees this view and sends validated patches (./commands.ts, settingsCommandSchema).
import type { Lang, LanguagePref } from './i18n';

/** The brains: a model in Ollama on your PC (free), or the practice script. */
export const AGENTS = ['ollama', 'mock'] as const;
export type AgentKind = (typeof AGENTS)[number];

export interface VoiceSettings {
  /** Read replies aloud. */
  enabled: boolean;
  /** A Windows voice name; empty = the system default. */
  voice: string;
  /** 0.5–2, 1 = normal speed. */
  rate: number;
  /** 0.5–1.5, 1 = the voice's own pitch. */
  pitch: number;
}

export interface MemoryEntry {
  id: string;
  text: string;
  created: number;
}

export interface SettingsView {
  projectRoots: string[];
  agent: AgentKind;
  ollamaModel: string;
  bubbleDismissSeconds: number;
  voice: VoiceSettings;
  internet: boolean;
  language: LanguagePref;
  /** The language "system" resolves to right now. */
  systemLanguage: Lang;
  memories: MemoryEntry[];
  /** Something changed that only takes effect after a restart (agent, model, folders). */
  restartNeeded: boolean;
}
