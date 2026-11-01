import { join } from 'node:path';
import { app } from 'electron';
import type { BuddyCommand } from '../shared/commands';
import { broadcastEvent } from './ipc/broadcast';
import { registerIpc } from './ipc/ipc-router';
import { hardenWebContents } from './security/harden';
import { SettingsStore } from './settings/settings-store';
import { createTray } from './tray';
import { AvatarWindow } from './windows/avatar-window';

// Until the AgentController exists (Step 5), commands only become events: the user's message is
// broadcast as a `user_input` fact, so every window sees it. Nothing answers yet.
function handleCommand(command: BuddyCommand): void {
  switch (command.type) {
    case 'user_input':
      broadcastEvent({ type: 'user_input', text: command.text, source: command.source });
      break;
    case 'cancel_turn':
      console.log('[main] cancel_turn: no turn is running (AgentController arrives in Step 5)');
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
    const settings = new SettingsStore(join(app.getPath('userData'), 'settings.json'));
    const avatar = new AvatarWindow(settings);
    avatar.win.once('show', () => console.log('[main] avatar shown at', avatar.avatarRect()));

    // Pause = the Sleep mode: the avatar sleeps and (from Step 5) no turns run.
    let paused = false;
    const setPaused = (value: boolean) => {
      paused = value;
      broadcastEvent({ type: 'mode_changed', mode: paused ? 'sleep' : 'companion' });
    };

    registerIpc(handleCommand, (command, from) => {
      if (from === avatar.win) avatar.handle(command);
    });

    const tray = createTray({
      isVisible: () => avatar.visible,
      setVisible: (visible) => avatar.setVisible(visible),
      isPaused: () => paused,
      setPaused,
      exit: () => app.quit(),
    });

    app.on('second-instance', () => avatar.setVisible(true));
    app.on('before-quit', () => {
      settings.flush();
      tray.destroy();
    });
  });
}
