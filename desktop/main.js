/**
 * Costareen ERP - Electron shell.
 *
 * The UI is served over a custom `app://` protocol rather than file://.
 * That matters: a file:// page has a null origin, which breaks localStorage
 * (so the login session would not persist) and makes cross-origin requests to
 * Supabase unreliable. Registering `app` as a standard, secure scheme gives
 * the page a real origin and it behaves like a normal website.
 */

const { app, BrowserWindow, protocol, net, shell, Menu } = require('electron');
const path = require('node:path');
const url = require('node:url');

const APP_DIR = path.join(__dirname, 'app');

// Must run before the app is ready.
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }
]);

function resolveInsideApp(pathname) {
  // Strip any ../ so a crafted URL cannot escape the bundled app directory.
  const clean = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.[\\/])+/, '');
  const full = path.join(APP_DIR, clean === '/' || clean === '\\' ? 'index.html' : clean);
  return full.startsWith(APP_DIR) ? full : path.join(APP_DIR, 'index.html');
}

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 380,
    minHeight: 560,
    backgroundColor: '#f9f9f7',
    title: 'Costareen ERP',
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'icon.ico'),
    webPreferences: {
      // The page is our own and needs no Node access, so keep it sandboxed.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  win.loadURL('app://-/index.html');

  // Anything that is not our own page opens in the real browser, never inside
  // the app window - so a stray link cannot replace the ERP with a web page.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:/i.test(target)) shell.openExternal(target);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, target) => {
    if (!target.startsWith('app://')) {
      event.preventDefault();
      if (/^https?:/i.test(target)) shell.openExternal(target);
    }
  });

  win.on('closed', () => { win = null; });
}

app.whenReady().then(() => {
  protocol.handle('app', (request) => {
    const { pathname } = new URL(request.url);
    return net.fetch(url.pathToFileURL(resolveInsideApp(pathname)).toString());
  });

  // A minimal menu: keep reload and zoom, drop the developer clutter.
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'File',
      submenu: [
        { role: 'reload', label: 'Refresh' },
        { type: 'separator' },
        { role: 'quit', label: 'Exit' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    }
  ]));

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
