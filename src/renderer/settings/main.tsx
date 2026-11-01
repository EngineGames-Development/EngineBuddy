// The settings window. It shows what main sends (SettingsView) and asks main for changes; main
// accepts those only from this window. Project folders are added through Windows' own folder
// picker, opened by main, so no path typed into a page can widen what EngineBuddy may touch.
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { SettingsCommand } from '../../shared/commands';
import type { SettingsView, VoiceSettings } from '../../shared/settings-view';
import { speak } from '../speech/voice';
import './settings.css';

const send = (command: SettingsCommand) => window.buddy.settings.send(command);

function useVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    const read = () => setVoices(speechSynthesis.getVoices());
    read();
    speechSynthesis.addEventListener('voiceschanged', read);
    return () => speechSynthesis.removeEventListener('voiceschanged', read);
  }, []);
  return voices;
}

function Settings() {
  const [view, setView] = useState<SettingsView>();
  const [model, setModel] = useState('');
  const voices = useVoices();

  useEffect(() => {
    const off = window.buddy.onSettings((v) => {
      setView(v);
      setModel(v.claudeModel);
    });
    send({ type: 'ready' });
    return off;
  }, []);

  if (!view) return <p className="loading">Loading…</p>;

  const setVoice = (patch: Partial<VoiceSettings>) =>
    send({ type: 'update', patch: { voice: { ...view.voice, ...patch } } });

  return (
    <div className="settings">
      {view.restartNeeded && (
        <div className="restart">
          <span>Some changes take effect after a restart.</span>
          <button onClick={() => send({ type: 'restart' })}>Restart now</button>
        </div>
      )}

      <section>
        <h2>Project folders</h2>
        <p className="help">
          EngineBuddy may read files here without asking, and change them after you OK a diff. The first one
          is where it works and runs commands.
        </p>
        <ul className="roots">
          {view.projectRoots.length === 0 && (
            <li className="none">None yet. It uses an empty folder of its own.</li>
          )}
          {view.projectRoots.map((root, i) => (
            <li key={root}>
              <span className="path">{root}</span>
              {i === 0 && <span className="badge">working folder</span>}
              <button className="remove" onClick={() => send({ type: 'remove_root', path: root })}>
                Remove
              </button>
            </li>
          ))}
        </ul>
        <button onClick={() => send({ type: 'add_root' })}>+ Add folder…</button>
      </section>

      <section>
        <h2>Voice</h2>
        <label className="check">
          <input
            type="checkbox"
            checked={view.voice.enabled}
            onChange={(e) => setVoice({ enabled: e.target.checked })}
          />
          Read replies aloud
        </label>
        <label>
          Voice
          <select value={view.voice.voice} onChange={(e) => setVoice({ voice: e.target.value })}>
            <option value="">System default</option>
            {voices.map((v) => (
              <option key={v.voiceURI} value={v.name}>
                {v.name} ({v.lang})
              </option>
            ))}
          </select>
        </label>
        <label>
          Speed <span className="value">{view.voice.rate.toFixed(1)}×</span>
          <input
            type="range"
            min={0.5}
            max={2}
            step={0.1}
            value={view.voice.rate}
            onChange={(e) => setVoice({ rate: Number(e.target.value) })}
          />
        </label>
        <button onClick={() => speak("Hey. That's how I sound.", view.voice)}>▶ Try it</button>
      </section>

      <section>
        <h2>Brain</h2>
        <label>
          Mode
          <select
            value={view.agent}
            onChange={(e) =>
              send({ type: 'update', patch: { agent: e.target.value as SettingsView['agent'] } })
            }
          >
            <option value="claude-code">Claude Code (your claude.ai subscription)</option>
            <option value="mock">Practice script (no Claude, no usage)</option>
          </select>
        </label>
        <label>
          Model
          <input
            value={model}
            placeholder="Claude Code's default (e.g. sonnet, opus)"
            onChange={(e) => setModel(e.target.value)}
            onBlur={() =>
              model !== view.claudeModel && send({ type: 'update', patch: { claudeModel: model.trim() } })
            }
          />
        </label>
        <label>
          Speech bubble stays for <span className="value">{view.bubbleDismissSeconds} s</span>
          <input
            type="range"
            min={3}
            max={60}
            value={Math.min(60, view.bubbleDismissSeconds)}
            onChange={(e) =>
              send({ type: 'update', patch: { bubbleDismissSeconds: Number(e.target.value) } })
            }
          />
        </label>
      </section>

      <section>
        <h2>Memory</h2>
        <p className="help">
          Notes EngineBuddy keeps about you across restarts. It writes them itself (ask it to remember
          something); delete anything you don't want it to know.
        </p>
        <ul className="memories">
          {view.memories.length === 0 && <li className="none">Nothing yet.</li>}
          {view.memories.map((m) => (
            <li key={m.id}>
              <span>{m.text}</span>
              <button className="remove" title="Forget" onClick={() => send({ type: 'forget', id: m.id })}>
                ×
              </button>
            </li>
          ))}
        </ul>
        {view.memories.length > 0 && (
          <button
            className="danger"
            onClick={() => confirm('Forget everything?') && send({ type: 'forget_all' })}
          >
            Forget everything
          </button>
        )}
      </section>
    </div>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('settings/index.html is missing #root');
createRoot(root).render(
  <StrictMode>
    <Settings />
  </StrictMode>,
);
