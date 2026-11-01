import { join } from 'node:path';
import { app, dialog } from 'electron';
import { AgentController } from '../core/agent/agent-controller';
import { EventBus } from '../core/events/event-bus';
import { localToolTurn } from '../integrations/local/local-tool-turn';
import { ConfirmationBroker } from '../security/confirmations/confirmation-broker';
import type { BuddyCommand } from '../shared/commands';
import { setUpAgent } from './agent-setup';
import { showContextMenu } from './context-menu';
import { broadcastEvent } from './ipc/broadcast';
import { registerIpc } from './ipc/ipc-router';
import { hardenWebContents } from './security/harden';
import { SettingsStore } from './settings/settings-store';
import { createTray } from './tray';
import { AvatarWindow } from './windows/avatar-window';
import { ConfirmWindow } from './windows/confirm-window';

/** The startup greeting: local lines, no tokens (docs/PHASE-1.md step 10). */
const GREETING = ['Hey.', 'What are we building today?'];

const bus = new EventBus();
bus.on(broadcastEvent);

let agent: AgentController;

function handleCommand(command: BuddyCommand): void {
  switch (command.type) {
    case 'user_input':
      bus.emit({ type: 'user_input', text: command.text, source: command.source });
      agent.submit({ text: command.text, source: command.source });
      break;
    case 'cancel_turn':
      agent.cancel();
      break;
  }
}

// One EngineBuddy per desktop. A second launch exits, and the first one shows itself.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('web-contents-created', (_event, contents) => hardenWebContents(contents));
  app.on('window-all-closed', () => app.quit());

  void app.whenReady().then(() => {
    const sinceStart = () => `${Math.round(process.uptime() * 1000)} ms after start`;
    console.log(`[main] ready ${sinceStart()}`);
    const settings = new SettingsStore(join(app.getPath('userData'), 'settings.json'));

    // Confirmations (SECURITY.md §5): a main-owned window asks you; closing it means no.
    const confirmWindow = new ConfirmWindow((id) => broker.answer(id, false));
    const broker: ConfirmationBroker = new ConfirmationBroker({
      presenter: confirmWindow,
      onShow: (p) =>
        bus.emit({ type: 'confirm_request', turnId: p.turnId ?? '', callId: p.id, request: p.request }),
      onResolve: (p, outcome) =>
        bus.emit({ type: 'confirm_resolved', callId: p.id, allowed: outcome === 'allowed' }),
    });

    const setup = setUpAgent(settings.get(), broker);
    agent = new AgentController({ bus, provider: setup.provider });
    if (setup.problem) console.warn(`[main] ${setup.problem}`);
    console.log(`[main] agent: ${setup.provider.id}`);

    const greeting = setup.problem ? [...GREETING, setup.problem] : GREETING;
    const avatar = new AvatarWindow(settings, {
      greeting: JSON.stringify(greeting),
      // For measuring cold start → greeting (step 10): when this process started, in epoch ms.
      appStart: String(Math.round(Date.now() - process.uptime() * 1000)),
    });
    avatar.win.once('show', () => {
      console.log(`[main] avatar shown ${sinceStart()} at`, avatar.avatarRect());
      // Only now start Claude Code in the background, while the avatar greets you (~14 s cold,
      // spike 0b). Loading the SDK and spawning the process earlier delayed the window by seconds.
      setup.provider.prewarm?.().catch((error: unknown) => console.warn('[main] prewarm failed:', error));
    });

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

    // Folder picker → open_in_vscode as a local turn: no model needed, same policy, audit and UI.
    const openInVsCode = async () => {
      const picked = await dialog.showOpenDialog(avatar.win, {
        title: 'Open in VS Code',
        properties: ['openDirectory'],
      });
      const path = picked.filePaths[0];
      if (picked.canceled || !path) return;
      agent.submit(
        { text: `Open ${path} in VS Code`, source: 'menu', intent: 'open_in_vscode' },
        localToolTurn(
          setup.registry,
          setup.runner,
          'open_in_vscode',
          { path },
          () => "Done. It's open in VS Code.",
        ),
      );
    };

    const exit = () => app.quit();
    avatar.onContextMenu = () =>
      showContextMenu(avatar.win, {
        ask: () => avatar.openBubble(),
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
    );

    const tray = createTray({
      isVisible: () => avatar.visible,
      setVisible: (visible) => avatar.setVisible(visible),
      isPaused: () => paused,
      setPaused,
      exit,
    });

    app.on('second-instance', () => avatar.setVisible(true));
    app.on('before-quit', () => {
      settings.flush();
      broker.denyAll();
      tray.destroy();
      void setup.provider.dispose();
    });
  });
}
