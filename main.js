const { app, BrowserWindow, shell, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const { exec } = require('child_process');

/**
 * Minimal ZIP extractor (no external dependencies).
 * Parses the central directory and inflates DEFLATE-compressed entries.
 * Returns a map of { filename: Buffer }.
 */
function extractZip(buffer) {
  const files = {};
  // Locate End Of Central Directory record (signature 0x06054b50), scanning backwards.
  const EOCD_SIG = 0x06054b50;
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) {
    throw new Error('Invalid ZIP: End of Central Directory not found');
  }

  const entryCount = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);

  const CEN_SIG = 0x02014b50;
  for (let n = 0; n < entryCount; n++) {
    if (buffer.readUInt32LE(offset) !== CEN_SIG) break;

    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);

    // Jump to the local header to find where the file data actually starts.
    const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);

    // Skip directory entries.
    if (!name.endsWith('/')) {
      if (method === 0) {
        files[name] = Buffer.from(compressed);
      } else if (method === 8) {
        files[name] = zlib.inflateRawSync(compressed);
      }
    }

    offset += 46 + nameLength + extraLength + commentLength;
  }

  return files;
}

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
      preload: path.join(__dirname, 'preload.js'),
    },
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

ipcMain.handle('git-pull-master', () => {
  return new Promise((resolve) => {
    exec(
      'git pull',
      { cwd: '/Users/thomaslaforge/Documents/Project/conductor/rosa-v1' },
      (err, stdout, stderr) => {
        if (err) {
          resolve({ success: false, output: stderr || err.message });
        } else {
          resolve({ success: true, output: stdout || stderr });
        }
      },
    );
  });
});

ipcMain.handle('download-coverage-artifact', async (event, { owner, repo, artifactId }) => {
  try {
    let token = null;
    if (fs.existsSync(tokenPath)) {
      token = fs.readFileSync(tokenPath, 'utf-8').trim();
    }
    if (!token) {
      return { success: false, error: 'Not authenticated' };
    }

    const url = `https://api.github.com/repos/${owner}/${repo}/actions/artifacts/${artifactId}/zip`;
    // fetch follows the 302 redirect to blob storage automatically (no CORS in main process).
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    if (!res.ok) {
      return { success: false, error: `Download failed (HTTP ${res.status})` };
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    const extracted = extractZip(buffer);

    const files = Object.entries(extracted).map(([filePath, content]) => ({
      path: filePath,
      base64: content.toString('base64'),
    }));

    return { success: true, files };
  } catch (err) {
    console.error('Failed to download coverage artifact', err);
    return { success: false, error: err?.message || 'Unknown error' };
  }
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
