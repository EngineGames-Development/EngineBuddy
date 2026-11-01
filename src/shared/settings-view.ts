// What the settings window shows and may change. Main owns the settings file; the settings window
// only ever sees this view and sends validated patches (./commands.ts, settingsCommandSchema).
import type { Lang, LanguagePref } from './i18n';

/** The brains: a model in Ollama on your PC (free), or the practice script. */
export const AGENTS = ['ollama', 'mock'] as const;
export type AgentKind = (typeof AGENTS)[number];

/** Models the setup assistant offers: Qwen3 (Apache 2.0), reliable with tools. */
export const SETUP_MODELS = ['qwen3:4b', 'qwen3:8b', 'qwen3:14b'] as const;
export type SetupModel = (typeof SETUP_MODELS)[number];

/** The first-run assistant: is the free brain ready, and if not, what's missing. */
export interface SetupView {
  /** Ollama answers on this PC. */
  ollama: boolean;
  /** Ollama is installed (its app is in the usual place), whether or not it runs. */
  installed: boolean;
  /** The model in Settings is downloaded. */
  modelReady: boolean;
  recommended: SetupModel;
  /** Total RAM in GB, rounded, for the recommendation text. */
  ramGb: number;
  pulling?: { model: SetupModel; status: string; percent?: number };
  error?: string;
}

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
  setup: SetupView;
  /** Something changed that only takes effect after a restart (agent, model, folders). */
  restartNeeded: boolean;
}
