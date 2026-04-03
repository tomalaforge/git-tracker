const { app, BrowserWindow } = require('electron');
const path = require('path');
const url = require('url');

let win;

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

  // win.webContents.openDevTools(); // Uncomment for debugging

  // On macOS, hide the window instead of destroying it so the session is preserved
  win.on('close', (event) => {
    if (process.platform === 'darwin') {
      event.preventDefault();
      win.hide();
    }
  });
}

app.on('ready', createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (win === null) {
    createWindow();
  } else {
    win.show();
  }
});
