import { app } from 'electron';
import { hardenWebContents } from './security/harden';
import { createAvatarWindow } from './windows/avatar-window';

// One EngineBuddy per desktop. A second launch just exits.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('web-contents-created', (_event, contents) => hardenWebContents(contents));
  app.on('window-all-closed', () => app.quit());

  void app.whenReady().then(() => {
    const avatar = createAvatarWindow();
    avatar.once('show', () => console.log('[main] avatar window shown', avatar.getBounds()));
  });
}
