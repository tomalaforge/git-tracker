const { app, BrowserWindow, shell, ipcMain } = require('electron');
const path = require('path');
const url = require('url');

let win;
let appQuitting = false;

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#0f172a', // Matches Slate-900
    title: 'GitTracker',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Load the built Angular app
  const indexPath = path.join(__dirname, 'dist/git-tracker/browser/index.html');
  win.loadFile(indexPath);

  // Open external links in the default browser instead of a new Electron window
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // win.webContents.openDevTools(); // Uncomment for debugging

  // On macOS, hide the window instead of destroying it so the session is preserved
  win.on('close', (event) => {
    if (!appQuitting && process.platform === 'darwin') {
      event.preventDefault();
      win.hide();
    }
  });
}

// Track if the app is officially quitting (Cmd+Q or Menu)
app.on('before-quit', () => {
  appQuitting = true;
});

app.on('ready', createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (win) {
    win.show();
  } else {
    createWindow();
  }
});

// IPC handlers for badge support
ipcMain.on('set-badge-count', (event, count) => {
  if (process.platform === 'darwin') {
    app.setBadgeCount(count);
  }
});
