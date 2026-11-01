// The first-run assistant behind Settings → Setup: is Ollama running, is the model there, and
// downloading it (through Ollama). Main owns this state; the settings window only shows it.
import { totalmem } from 'node:os';
import { shell } from 'electron';
import {
  hasModel,
  ollamaAppPath,
  ollamaStatus,
  pullModel,
  recommendedModel,
  startOllama,
  waitForOllama,
} from '../integrations/ollama/ollama-setup';
import type { SetupModel, SetupView } from '../shared/settings-view';

/** Where people get Ollama: its official download page, opened in the user's browser. */
const OLLAMA_DOWNLOAD = 'https://ollama.com/download/windows';

export interface SetupOptions {
  baseUrl: string;
  /** The model in Settings right now. */
  model: () => string;
  /** A model finished downloading: make it the one in Settings. */
  onModelReady: (model: SetupModel) => void;
  onChange: () => void;
  /** Download failed, in the UI language. */
  failed: (why: string) => string;
}

export class SetupAssistant {
  private ollama = false;
  private models: string[] = [];
  private pulling: SetupView['pulling'];
  private error: string | undefined;
  private abort: AbortController | undefined;
  private readonly recommended = recommendedModel(totalmem());

  constructor(private readonly opts: SetupOptions) {}

  view(): SetupView {
    return {
      ollama: this.ollama,
      installed: this.ollama || ollamaAppPath() !== undefined,
      modelReady: hasModel(this.models, this.opts.model()),
      recommended: this.recommended,
      ramGb: Math.round(totalmem() / 1024 ** 3),
      ...(this.pulling ? { pulling: this.pulling } : {}),
      ...(this.error ? { error: this.error } : {}),
    };
  }

  get ready(): boolean {
    return this.ollama && hasModel(this.models, this.opts.model());
  }

  async check(): Promise<void> {
    const status = await ollamaStatus(this.opts.baseUrl);
    this.ollama = status.running;
    this.models = status.models;
    this.opts.onChange();
  }

  /** Installed but not running: start it (as from the Start menu) and wait until it answers. */
  async start(): Promise<void> {
    if (this.ollama || !startOllama()) return;
    this.opts.onChange();
    await waitForOllama(this.opts.baseUrl);
    await this.check();
  }

  getOllama(): void {
    void shell.openExternal(OLLAMA_DOWNLOAD);
  }

  async pull(model: SetupModel): Promise<void> {
    if (this.pulling) return;
    this.error = undefined;
    this.abort = new AbortController();
    this.pulling = { model, status: '' };
    this.opts.onChange();
    let last = 0;
    try {
      await pullModel(
        this.opts.baseUrl,
        model,
        (p) => {
          this.pulling = {
            model,
            status: p.status,
            ...(p.percent !== undefined ? { percent: p.percent } : {}),
          };
          // A few updates a second are plenty for a progress bar.
          if (Date.now() - last > 250) {
            last = Date.now();
            this.opts.onChange();
          }
        },
        this.abort.signal,
      );
      this.opts.onModelReady(model);
    } catch (error) {
      if (!this.abort.signal.aborted)
        this.error = this.opts.failed(error instanceof Error ? error.message.slice(0, 200) : String(error));
    } finally {
      this.pulling = undefined;
      this.abort = undefined;
      await this.check();
    }
  }

  cancel(): void {
    this.abort?.abort();
  }
}
