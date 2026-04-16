const { app, BrowserWindow, shell, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

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

// IPC handlers for token persistence
const tokenPath = path.join(app.getPath('userData'), 'github_token.txt');

ipcMain.handle('save-token', (event, token) => {
  try {
    fs.writeFileSync(tokenPath, token, 'utf-8');
    return true;
  } catch (err) {
    console.error('Failed to save token', err);
    return false;
  }
});

ipcMain.handle('load-token', () => {
  try {
    if (fs.existsSync(tokenPath)) {
      return fs.readFileSync(tokenPath, 'utf-8');
    }
  } catch (err) {
    console.error('Failed to load token', err);
  }
  return null;
});

ipcMain.handle('clear-token', () => {
  try {
    if (fs.existsSync(tokenPath)) {
      fs.unlinkSync(tokenPath);
    }
    return true;
  } catch (err) {
    console.error('Failed to clear token', err);
    return false;
  }
});
