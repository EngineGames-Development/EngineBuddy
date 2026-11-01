import { join } from 'node:path';
import { Menu, app, dialog, session, type BrowserWindow } from 'electron';
import { AgentController } from '../core/agent/agent-controller';
import { EventBus } from '../core/events/event-bus';
import { localToolTurn } from '../integrations/local/local-tool-turn';
import { ConfirmationBroker } from '../security/confirmations/confirmation-broker';
import type { BuddyCommand, SettingsCommand } from '../shared/commands';
import { IPC_CHANNELS, type UiRequest } from '../shared/ipc';
import { resolveLang, translator } from '../shared/i18n';
import type { SettingsView } from '../shared/settings-view';
import { MemoryStore } from '../tools/memory/memory';
import { ollamaBaseUrl, setUpAgent } from './agent-setup';
import { OLLAMA_DEFAULT_MODEL } from '../integrations/ollama/ollama-agent';
import { SetupAssistant } from './setup-assistant';
import { showContextMenu } from './context-menu';
import { ConversationStore } from './history/conversation-store';
import { broadcastEvent } from './ipc/broadcast';
import { registerIpc } from './ipc/ipc-router';
import { takeScreenshot } from './screenshot';
import { hardenWebContents } from './security/harden';
import { SettingsStore } from './settings/settings-store';
import { createTray } from './tray';
import { AvatarWindow } from './windows/avatar-window';
import { ConfirmWindow } from './windows/confirm-window';
import { PanelWindow } from './windows/panel-window';
import { setRendererLanguage } from './windows/renderer-url';

const bus = new EventBus();
bus.on(broadcastEvent);

// One EngineBuddy per desktop. A second launch exits, and the first one shows itself.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('web-contents-created', (_event, contents) => hardenWebContents(contents));
  app.on('window-all-closed', () => app.quit());

  // No application menu: its default accelerators (Ctrl+Shift+I DevTools, Ctrl+R reload) would
  // work in every window (docs/security-audit.md, F2).
  Menu.setApplicationMenu(null);

  void app.whenReady().then(() => {
    // Our pages never need the camera, microphone, location, notifications, etc. Electron grants
    // such requests by default; deny them all (docs/security-audit.md, F1). Screenshots are taken
    // by main itself (desktopCapturer), not by a page.
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);

    const sinceStart = () => `${Math.round(process.uptime() * 1000)} ms after start`;
    console.log(`[main] ready ${sinceStart()}`);
    const userData = app.getPath('userData');
    const settings = new SettingsStore(join(userData, 'settings.json'));
    const memory = new MemoryStore(join(userData, 'memory.json'));
    // The UI language: Settings, else Windows' display language. Fixed for this run (a change restarts).
    const systemLocale = app.getPreferredSystemLanguages()[0] ?? app.getLocale();
    const lang = resolveLang(settings.get().language, systemLocale);
    const t = translator(lang);
    setRendererLanguage(lang);

    const history = new ConversationStore(join(userData, 'history'), t('chat.newTitle'));
    bus.on((event) => history.handle(event));

    // Confirmations (SECURITY.md §5): a main-owned window asks you; closing it means no.
    const confirmWindow = new ConfirmWindow((id) => broker.answer(id, false));
    const broker: ConfirmationBroker = new ConfirmationBroker({
      presenter: confirmWindow,
      onShow: (p) =>
        bus.emit({ type: 'confirm_request', turnId: p.turnId ?? '', callId: p.id, request: p.request }),
      onResolve: (p, outcome) =>
        bus.emit({ type: 'confirm_resolved', callId: p.id, allowed: outcome === 'allowed' }),
    });

    const setup = setUpAgent(settings.get(), broker, memory, lang);
    const provider = setup.provider;
    const agent = new AgentController({ bus, provider });
    if (setup.problem) console.warn(`[main] ${setup.problem}`);
    console.log(`[main] agent: ${provider.id}`);

    // Each conversation remembers the agent's own conversation ID, so reopening it continues it.
    bus.on((event) => {
      if (event.type === 'turn_end') history.setAgentSessionId(provider.conversationId?.());
    });

    // The startup greeting: local lines, no tokens (docs/PHASE-1.md step 10).
    const greeting = [t('main.greeting1'), t('main.greeting2'), ...(setup.problem ? [setup.problem] : [])];
    const avatar = new AvatarWindow(settings, {
      greeting: JSON.stringify(greeting),
      // For measuring cold start → greeting (step 10): when this process started, in epoch ms.
      appStart: String(Math.round(Date.now() - process.uptime() * 1000)),
    });
    avatar.win.once('show', () => {
      console.log(`[main] avatar shown ${sinceStart()} at`, avatar.avatarRect());
      // Only now start the agent in the background, while the avatar greets you (the old Claude Code brain took ~14 s cold,
      // spike 0b). Loading the SDK and spawning the process earlier delayed the window by seconds.
      // It continues the conversation you had open last time.
      const last = history.active.agentSessionId;
      const start =
        last && provider.switchConversation ? provider.switchConversation(last) : provider.prewarm?.();
      start?.catch((error: unknown) => console.warn('[main] prewarm failed:', error));
      // Not set up yet (no Ollama, or no model): open the assistant instead of failing on the first question.
      if (settings.get().agent === 'ollama')
        void setupAssistant.check().then(() => {
          if (!setupAssistant.ready) settingsWindow.open();
        });
    });

    // Chat and settings: ordinary windows, opened from the menu, the tray or the bubble.
    const chatWindow = new PanelWindow({
      name: 'chat',
      title: 'EngineBuddy',
      width: 900,
      height: 680,
      minWidth: 520,
      minHeight: 400,
      onLoad: () => pushChat(),
    });
    const settingsWindow = new PanelWindow({
      name: 'settings',
      title: t('main.settingsTitle'),
      width: 640,
      height: 720,
      minWidth: 480,
      minHeight: 480,
      onLoad: () => pushSettings(),
    });
    const pushChat = () => chatWindow.send(IPC_CHANNELS.chat, { type: 'state', state: history.state() });
    history.onChange(pushChat);

    // Point the agent at the active conversation, stopping whatever ran in the old one.
    const followConversation = () => {
      agent.cancel();
      broker.denyAll();
      const wanted = history.active.agentSessionId;
      if (wanted !== provider.conversationId?.()) void provider.switchConversation?.(wanted);
    };

    let restartNeeded = false;
    // First-run assistant (Settings → Setup): Ollama and the model, so EngineBuddy works right away.
    const setupAssistant = new SetupAssistant({
      baseUrl: ollamaBaseUrl(settings.get()),
      model: () => settings.get().ollamaModel || OLLAMA_DEFAULT_MODEL,
      onModelReady: (model) => {
        const before = settings.get();
        settings.update({ agent: 'ollama', ollamaModel: model });
        if (before.agent !== 'ollama' || (before.ollamaModel || OLLAMA_DEFAULT_MODEL) !== model)
          restartNeeded = true;
      },
      onChange: () => pushSettings(),
      failed: (why) => t('setup.failed', { why }),
    });
    const settingsView = (): SettingsView => {
      const s = settings.get();
      return {
        projectRoots: s.projectRoots,
        agent: s.agent,
        ollamaModel: s.ollamaModel,
        bubbleDismissSeconds: s.bubbleDismissSeconds,
        voice: s.voice,
        internet: s.internet,
        language: s.language,
        systemLanguage: resolveLang('system', systemLocale),
        memories: [...memory.list()],
        setup: setupAssistant.view(),
        restartNeeded,
      };
    };
    const pushSettings = () => settingsWindow.send(IPC_CHANNELS.settings, settingsView());
    memory.onChange(pushSettings);
    const pushVoice = () => {
      const request: UiRequest = { type: 'voice', voice: settings.get().voice };
      avatar.win.webContents.send(IPC_CHANNELS.ui, request);
    };
    avatar.win.webContents.on('did-finish-load', pushVoice);

    // Pause = the Sleep mode: the avatar sleeps and the controller refuses new turns.
    let paused = false;
    const setPaused = (value: boolean) => {
      paused = value;
      const mode = paused ? 'sleep' : 'companion';
      if (paused) {
        agent.cancel();
        broker.denyAll();
      }
      agent.setMode(mode);
      bus.emit({ type: 'mode_changed', mode });
    };

    let lastScreenshot = 0;
    const handleCommand = (command: BuddyCommand, from: BrowserWindow): void => {
      switch (command.type) {
        case 'user_input':
          history.addUserMessage(command.text, command.images);
          bus.emit({ type: 'user_input', text: command.text, source: command.source });
          agent.submit({
            text: command.text,
            source: command.source,
            ...(command.images ? { images: command.images } : {}),
          });
          break;
        case 'cancel_turn':
          agent.cancel();
          break;
        case 'chat_ready':
          pushChat();
          break;
        case 'chat_new':
          history.startNew();
          followConversation();
          break;
        case 'chat_open':
          if (history.active.id !== command.id && history.open(command.id)) followConversation();
          break;
        case 'chat_delete': {
          const wasActive = history.active.id === command.id;
          history.delete(command.id);
          if (wasActive) followConversation();
          break;
        }
        case 'take_screenshot':
          // Only the chat window has the camera button; it's hidden for the capture.
          // A click means the window has focus; a page acting on its own gets at most one picture
          // every few seconds, and only of what you're looking at anyway (docs/security-audit.md, F9).
          if (!chatWindow.owns(from.webContents) || !from.isFocused()) return;
          if (Date.now() - lastScreenshot < 3000) return;
          lastScreenshot = Date.now();
          takeScreenshot(from)
            .then((image) => chatWindow.send(IPC_CHANNELS.chat, { type: 'attachment', image }))
            .catch((error: unknown) => {
              console.warn('[main] screenshot failed:', error);
              chatWindow.send(IPC_CHANNELS.chat, { type: 'notice', text: t('main.screenshotFailed') });
            });
          break;
        case 'open_chat':
          chatWindow.open();
          break;
        case 'open_settings':
          settingsWindow.open();
          break;
      }
    };

    const handleSettings = async (command: SettingsCommand, from: BrowserWindow): Promise<void> => {
      switch (command.type) {
        case 'ready':
          break;
        case 'update': {
          const { patch } = command;
          const before = settings.get();
          settings.update({
            ...(patch.agent ? { agent: patch.agent } : {}),
            ...(patch.ollamaModel !== undefined ? { ollamaModel: patch.ollamaModel } : {}),
            ...(patch.bubbleDismissSeconds ? { bubbleDismissSeconds: patch.bubbleDismissSeconds } : {}),
            ...(patch.voice ? { voice: patch.voice } : {}),
            ...(patch.internet !== undefined ? { internet: patch.internet } : {}),
            ...(patch.language ? { language: patch.language } : {}),
          });
          const after = settings.get();
          if (
            before.agent !== after.agent ||
            before.ollamaModel !== after.ollamaModel ||
            before.internet !== after.internet ||
            before.language !== after.language
          )
            restartNeeded = true;
          if (patch.voice) pushVoice();
          break;
        }
        case 'add_root': {
          // Only a folder you pick in Windows' own dialog gets in, never a path from a renderer.
          const picked = await dialog.showOpenDialog(from, {
            title: t('main.addFolder'),
            properties: ['openDirectory'],
          });
          const path = picked.filePaths[0];
          if (picked.canceled || !path || settings.get().projectRoots.includes(path)) break;
          settings.update({ projectRoots: [...settings.get().projectRoots, path] });
          restartNeeded = true;
          break;
        }
        case 'remove_root':
          if (!settings.get().projectRoots.includes(command.path)) break;
          settings.update({ projectRoots: settings.get().projectRoots.filter((p) => p !== command.path) });
          restartNeeded = true;
          break;
        case 'forget':
          memory.remove(command.id);
          break;
        case 'forget_all':
          memory.clear();
          break;
        case 'setup_check':
          await setupAssistant.check();
          break;
        case 'setup_get_ollama':
          setupAssistant.getOllama();
          break;
        case 'setup_pull':
          void setupAssistant.pull(command.model);
          break;
        case 'setup_cancel':
          setupAssistant.cancel();
          break;
        case 'restart':
          settings.flush();
          app.relaunch();
          app.exit(0);
          return;
      }
      pushSettings();
    };

    // Folder picker → open_in_vscode as a local turn: no model needed, same policy, audit and UI.
    const openInVsCode = async () => {
      const picked = await dialog.showOpenDialog(avatar.win, {
        title: t('menu.vscode').replace('…', ''),
        properties: ['openDirectory'],
      });
      const path = picked.filePaths[0];
      if (picked.canceled || !path) return;
      agent.submit(
        { text: `Open ${path} in VS Code`, source: 'menu', intent: 'open_in_vscode' },
        localToolTurn(setup.registry, setup.runner, 'open_in_vscode', { path }, () => t('main.vscodeDone')),
      );
    };

    const exit = () => app.quit();
    avatar.onContextMenu = () =>
      showContextMenu(avatar.win, t, {
        ask: () => avatar.openBubble(),
        openChat: () => chatWindow.open(),
        openSettings: () => settingsWindow.open(),
        // A structured intent through the controller: the same path as typed text (tool, narration, reaction).
        systemCheck: () => agent.submit({ text: 'System check', source: 'menu', intent: 'system_check' }),
        openInVsCode: () => void openInVsCode(),
        isPaused: () => paused,
        setPaused,
        exit,
      });

    registerIpc(
      handleCommand,
      (command, from) => {
        if (from === avatar.win) avatar.handle(command);
      },
      // Only the confirmation window showing this exact request may answer it.
      (answer, from) => {
        if (confirmWindow.owns(from.webContents, answer.id)) broker.answer(answer.id, answer.allowed);
        else console.warn('[main] ignored a confirmation answer from the wrong window');
      },
      // Settings change what EngineBuddy may touch, so only the settings window may send them.
      (command, from) => {
        if (settingsWindow.owns(from.webContents)) void handleSettings(command, from);
        else console.warn('[main] ignored a settings command from the wrong window');
      },
    );

    const tray = createTray(t, {
      isVisible: () => avatar.visible,
      setVisible: (visible) => avatar.setVisible(visible),
      isPaused: () => paused,
      setPaused,
      openChat: () => chatWindow.open(),
      openSettings: () => settingsWindow.open(),
      exit,
    });

    app.on('second-instance', () => avatar.setVisible(true));
    app.on('before-quit', () => {
      settings.flush();
      broker.denyAll();
      chatWindow.destroy();
      settingsWindow.destroy();
      tray.destroy();
      void provider.dispose();
    });
  });
}
