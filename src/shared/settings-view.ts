// What the settings window shows and may change. Main owns the settings file; the settings window
// only ever sees this view and sends validated patches (./commands.ts, settingsCommandSchema).

export interface VoiceSettings {
  /** Read replies aloud. */
  enabled: boolean;
  /** A Windows voice name; empty = the system default. */
  voice: string;
  /** 0.5–2, 1 = normal speed. */
  rate: number;
}

export interface MemoryEntry {
  id: string;
  text: string;
  created: number;
}

export interface SettingsView {
  projectRoots: string[];
  agent: 'claude-code' | 'mock';
  claudeModel: string;
  bubbleDismissSeconds: number;
  voice: VoiceSettings;
  memories: MemoryEntry[];
  /** Something changed that only takes effect after a restart (agent, model, folders). */
  restartNeeded: boolean;
}
