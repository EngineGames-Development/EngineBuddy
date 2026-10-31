import { app } from 'electron';
import type { BuddyCommand } from '../shared/commands';
import { broadcastEvent } from './ipc/broadcast';
import { registerIpc } from './ipc/ipc-router';
import { hardenWebContents } from './security/harden';
import { createAvatarWindow } from './windows/avatar-window';

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

// One EngineBuddy per desktop. A second launch just exits.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('web-contents-created', (_event, contents) => hardenWebContents(contents));
  app.on('window-all-closed', () => app.quit());

  void app.whenReady().then(() => {
    registerIpc(handleCommand);
    const avatar = createAvatarWindow();
    avatar.once('show', () => console.log('[main] avatar window shown', avatar.getBounds()));
  });
}
