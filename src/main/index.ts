import { join } from 'node:path';
import { app } from 'electron';
import { AgentController } from '../core/agent/agent-controller';
import { EventBus } from '../core/events/event-bus';
import { MockAgent } from '../integrations/mock/mock-agent';
import type { BuddyCommand } from '../shared/commands';
import { broadcastEvent } from './ipc/broadcast';
import { registerIpc } from './ipc/ipc-router';
import { hardenWebContents } from './security/harden';
import { SettingsStore } from './settings/settings-store';
import { createTray } from './tray';
import { AvatarWindow } from './windows/avatar-window';

const bus = new EventBus();
bus.on(broadcastEvent);

// Step 5: the MockAgent answers, so the whole UI path works without Claude. Step 8 swaps in
// ClaudeCodeAgent behind the same interface.
const agent = new AgentController({ bus, provider: new MockAgent() });

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
    const settings = new SettingsStore(join(app.getPath('userData'), 'settings.json'));
    const avatar = new AvatarWindow(settings);
    avatar.win.once('show', () => console.log('[main] avatar shown at', avatar.avatarRect()));

    // Pause = the Sleep mode: the avatar sleeps and the controller refuses new turns.
    let paused = false;
    const setPaused = (value: boolean) => {
      paused = value;
      const mode = paused ? 'sleep' : 'companion';
      if (paused) agent.cancel();
      agent.setMode(mode);
      bus.emit({ type: 'mode_changed', mode });
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
