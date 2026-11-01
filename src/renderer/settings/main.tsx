// The settings window. It shows what main sends (SettingsView) and asks main for changes; main
// accepts those only from this window. Project folders are added through Windows' own folder
// picker, opened by main, so no path typed into a page can widen what EngineBuddy may touch.
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { SettingsCommand } from '../../shared/commands';
import {
  SETUP_MODELS,
  type SettingsView,
  type SetupView,
  type VoiceSettings,
} from '../../shared/settings-view';
import { LANGUAGE_NAMES, LANGUAGES, type LanguagePref } from '../../shared/i18n';
import { t } from '../common/i18n';
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

function Setup({ setup }: { setup: SetupView }) {
  const { pulling } = setup;
  return (
    <section className="setup">
      <h2>{t('setup.title')}</h2>
      <p className="help">{t('setup.intro')}</p>

      <h3>{setup.ollama ? t('setup.step1Done') : t('setup.step1')}</h3>
      {!setup.ollama && setup.installed && (
        <>
          <p className="help">{t('setup.notStarted')}</p>
          <div className="row">
            <button className="primary" onClick={() => send({ type: 'setup_start_ollama' })}>
              {t('setup.startOllama')}
            </button>
            <button onClick={() => send({ type: 'setup_check' })}>{t('setup.checkAgain')}</button>
          </div>
        </>
      )}
      {!setup.ollama && !setup.installed && (
        <div className="row">
          <button className="primary" onClick={() => send({ type: 'setup_get_ollama' })}>
            {t('setup.getOllama')}
          </button>
          <button onClick={() => send({ type: 'setup_check' })}>{t('setup.checkAgain')}</button>
        </div>
      )}

      {setup.ollama && (
        <>
          <h3>{t('setup.step2')}</h3>
          {pulling ? (
            <div className="pull">
              <progress max={100} value={pulling.percent ?? 0} />
              <span>
                {t('setup.downloading', {
                  model: pulling.model,
                  percent: pulling.percent !== undefined ? `${pulling.percent}%` : '',
                })}
              </span>
              <button onClick={() => send({ type: 'setup_cancel' })}>{t('setup.cancel')}</button>
            </div>
          ) : (
            <>
              <p className="help">{t('setup.recommend', { ram: setup.ramGb, model: setup.recommended })}</p>
              <div className="row">
                <button
                  className="primary"
                  onClick={() => send({ type: 'setup_pull', model: setup.recommended })}
                >
                  {t('setup.download', { model: setup.recommended })}
                </button>
                <span className="help">{t('setup.other')}</span>
                {SETUP_MODELS.filter((m) => m !== setup.recommended).map((m) => (
                  <button key={m} onClick={() => send({ type: 'setup_pull', model: m })}>
                    {m}
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      )}
      {setup.error && <p className="error">{setup.error}</p>}
    </section>
  );
}

function Settings() {
  const [view, setView] = useState<SettingsView>();
  const [ollamaModel, setOllamaModel] = useState('');
  const voices = useVoices();

  useEffect(() => {
    const off = window.buddy.onSettings((v) => {
      setView(v);
      setOllamaModel(v.ollamaModel);
    });
    send({ type: 'ready' });
    return off;
  }, []);

  if (!view) return <p className="loading">{t('settings.loading')}</p>;

  const setVoice = (patch: Partial<VoiceSettings>) =>
    send({ type: 'update', patch: { voice: { ...view.voice, ...patch } } });

  return (
    <div className="settings">
      {view.restartNeeded && (
        <div className="restart">
          <span>{t('settings.restart')}</span>
          <button onClick={() => send({ type: 'restart' })}>{t('settings.restartNow')}</button>
        </div>
      )}

      {view.agent === 'ollama' && (!view.setup.ollama || !view.setup.modelReady) && (
        <Setup setup={view.setup} />
      )}

      <section>
        <h2>{t('settings.folders')}</h2>
        <p className="help">{t('settings.foldersHelp')}</p>
        <ul className="roots">
          {view.projectRoots.length === 0 && <li className="none">{t('settings.noFolders')}</li>}
          {view.projectRoots.map((root, i) => (
            <li key={root}>
              <span className="path">{root}</span>
              {i === 0 && <span className="badge">{t('settings.workingFolder')}</span>}
              <button className="remove" onClick={() => send({ type: 'remove_root', path: root })}>
                {t('common.remove')}
              </button>
            </li>
          ))}
        </ul>
        <button onClick={() => send({ type: 'add_root' })}>{t('settings.addFolder')}</button>
      </section>

      <section>
        <h2>{t('settings.language')}</h2>
        <label>
          <select
            aria-label={t('settings.language')}
            value={view.language}
            onChange={(e) => send({ type: 'update', patch: { language: e.target.value as LanguagePref } })}
          >
            <option value="system">
              {t('settings.languageSystem', { name: LANGUAGE_NAMES[view.systemLanguage] })}
            </option>
            {LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {LANGUAGE_NAMES[l]}
              </option>
            ))}
          </select>
        </label>
        <p className="help">{t('settings.languageHelp')}</p>
      </section>

      <section>
        <h2>{t('settings.internet')}</h2>
        <label className="check">
          <input
            type="checkbox"
            checked={view.internet}
            onChange={(e) => send({ type: 'update', patch: { internet: e.target.checked } })}
          />
          {t('settings.internetOn')}
        </label>
        <p className="help">{t('settings.internetHelp')}</p>
      </section>

      <section>
        <h2>{t('settings.voice')}</h2>
        <label className="check">
          <input
            type="checkbox"
            checked={view.voice.enabled}
            onChange={(e) => setVoice({ enabled: e.target.checked })}
          />
          {t('settings.readAloud')}
        </label>
        <label>
          {t('settings.voice')}
          <select value={view.voice.voice} onChange={(e) => setVoice({ voice: e.target.value })}>
            <option value="">{t('settings.voiceAuto')}</option>
            {voices.map((v) => (
              <option key={v.voiceURI} value={v.name}>
                {v.name} ({v.lang})
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('settings.speed')} <span className="value">{view.voice.rate.toFixed(1)}×</span>
          <input
            type="range"
            min={0.5}
            max={2}
            step={0.1}
            value={view.voice.rate}
            onChange={(e) => setVoice({ rate: Number(e.target.value) })}
          />
        </label>
        <label>
          {t('settings.pitch')} <span className="value">{view.voice.pitch.toFixed(1)}</span>
          <input
            type="range"
            min={0.5}
            max={1.5}
            step={0.1}
            value={view.voice.pitch}
            onChange={(e) => setVoice({ pitch: Number(e.target.value) })}
          />
        </label>
        <p className="help">{t('settings.voiceHelp')}</p>
        <button onClick={() => speak(t('settings.sample'), view.voice)}>{t('settings.tryIt')}</button>
      </section>

      <section>
        <h2>{t('settings.brain')}</h2>
        <label>
          {t('settings.mode')}
          <select
            value={view.agent}
            onChange={(e) =>
              send({ type: 'update', patch: { agent: e.target.value as SettingsView['agent'] } })
            }
          >
            <option value="ollama">{t('settings.modeOllama')}</option>
            <option value="mock">{t('settings.modeMock')}</option>
          </select>
        </label>
        {view.agent === 'ollama' && (
          <>
            <p className="help">{t('settings.ollamaHelp')}</p>
            <label>
              {t('settings.model')}
              <input
                value={ollamaModel}
                placeholder="qwen3:8b"
                onChange={(e) => setOllamaModel(e.target.value)}
                onBlur={() =>
                  ollamaModel !== view.ollamaModel &&
                  send({ type: 'update', patch: { ollamaModel: ollamaModel.trim() } })
                }
              />
            </label>
          </>
        )}
        <label>
          {t('settings.bubble')} <span className="value">{view.bubbleDismissSeconds} s</span>
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
        <h2>{t('settings.memory')}</h2>
        <p className="help">{t('settings.memoryHelp')}</p>
        <ul className="memories">
          {view.memories.length === 0 && <li className="none">{t('settings.nothing')}</li>}
          {view.memories.map((m) => (
            <li key={m.id}>
              <span>{m.text}</span>
              <button
                className="remove"
                title={t('settings.forget')}
                onClick={() => send({ type: 'forget', id: m.id })}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
        {view.memories.length > 0 && (
          <button
            className="danger"
            onClick={() => confirm(t('settings.forgetAllAsk')) && send({ type: 'forget_all' })}
          >
            {t('settings.forgetAll')}
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
