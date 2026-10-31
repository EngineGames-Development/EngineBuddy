// Spike 0a: transparent always-on-top window with per-pixel click-through.
// Throwaway. A striped "target" window sits underneath the avatar window so we can
// tell which window actually received each click. Everything is logged to events.jsonl.
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const OUT = __dirname;
const LOG = path.join(OUT, 'events.jsonl');
fs.writeFileSync(LOG, '');
const log = (who, type, data = {}) => {
  const ev = { t: Date.now(), who, type, ...data };
  fs.appendFileSync(LOG, JSON.stringify(ev) + '\n');
  if (target && !target.isDestroyed()) target.webContents.send('spike-event', ev);   // live checklist
};

let avatar, target;
const AUTO_QUIT = !process.argv.includes('--manual');
const AVATAR = { w: 300, h: 300, circle: 120 };

function writeLayout() {
  const b = avatar.getBounds();
  const center = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  const corner = { x: b.x + 25, y: b.y + 25 };          // inside the window, outside the circle
  const phys = (p) => screen.dipToScreenPoint(p);
  fs.writeFileSync(path.join(OUT, 'layout.json'), JSON.stringify({
    avatarBounds: b, center, corner, centerPhys: phys(center), cornerPhys: phys(corner),
    displays: screen.getAllDisplays().map((d) => ({ id: d.id, bounds: d.bounds, workArea: d.workArea, scaleFactor: d.scaleFactor })),
  }, null, 1));
}

app.whenReady().then(() => {
  const wa = screen.getPrimaryDisplay().workArea;
  target = new BrowserWindow({
    x: wa.x + wa.width - 760, y: wa.y + wa.height - 560, width: 700, height: 500,
    title: 'spike-target', alwaysOnTop: true, webPreferences: { preload: path.join(__dirname, 'preload.js'), sandbox: true, contextIsolation: true },
  });
  target.loadFile('target.html');
  target.on('closed', () => app.quit());

  avatar = new BrowserWindow({
    x: wa.x + wa.width - 560, y: wa.y + wa.height - 460, width: AVATAR.w, height: AVATAR.h,
    transparent: true, frame: false, hasShadow: false, resizable: false, skipTaskbar: true,
    backgroundColor: '#00000000', alwaysOnTop: true, focusable: true, show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), sandbox: true, contextIsolation: true },
  });
  avatar.setAlwaysOnTop(true, 'floating');
  avatar.setIgnoreMouseEvents(true, { forward: true });
  avatar.loadFile('avatar.html');
  avatar.once('ready-to-show', () => {
    avatar.showInactive();
    writeLayout();
    log('main', 'ready', { alwaysOnTop: avatar.isAlwaysOnTop(), electron: process.versions.electron });
  });

  ipcMain.on('spike', (e, msg) => {
    const who = e.sender === avatar.webContents ? 'avatar' : 'target';
    if (msg.type === 'ignore') {
      avatar.setIgnoreMouseEvents(msg.value, { forward: true });
      log(who, 'ignore', { value: msg.value });
    } else if (msg.type === 'drag') {
      const [x, y] = avatar.getPosition();
      avatar.setPosition(Math.round(x + msg.dx), Math.round(y + msg.dy));
    } else if (msg.type === 'dragend') {
      writeLayout();
      log(who, 'dragend', { bounds: avatar.getBounds() });
    } else {
      log(who, msg.type, msg.data);
    }
  });

  // Driver writes a "quit" file when done; hard stop after 90 s either way.
  const quitFile = path.join(OUT, 'quit');
  fs.rmSync(quitFile, { force: true });
  const iv = setInterval(() => { if (fs.existsSync(quitFile)) { clearInterval(iv); app.quit(); } }, 200);
  if (AUTO_QUIT) setTimeout(() => app.quit(), 90_000);
});
