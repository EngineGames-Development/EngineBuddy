import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseSettings, type Settings } from './schema';

const SAVE_DELAY_MS = 400;

/**
 * Settings in a JSON file. Reads once at startup; writes are debounced (a drag produces many
 * updates) and atomic (write a temp file, then rename), so a crash can't leave half a file.
 */
export class SettingsStore {
  private current: Settings;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly file: string) {
    this.current = parseSettings(readJson(file));
  }

  get(): Readonly<Settings> {
    return this.current;
  }

  update(patch: Partial<Settings>): void {
    this.current = parseSettings({ ...this.current, ...patch });
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), SAVE_DELAY_MS);
  }

  flush(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.current, null, 2));
      renameSync(tmp, this.file);
    } catch (error) {
      console.warn('[settings] could not save:', error);
    }
  }
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[settings] unreadable, using defaults:', (error as Error).message);
    }
    return {};
  }
}
