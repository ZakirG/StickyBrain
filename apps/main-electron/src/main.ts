/**
 * Main Electron process
 * Handles window creation, IPC communication, and file watching
 */

import { app, BrowserWindow, ipcMain, nativeTheme } from 'electron';
import { join } from 'path';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  if (process.platform === 'win32' && require('electron-squirrel-startup')) {
    app.quit();
  }
} catch {
  // Module not present (expected on macOS/Linux dev) – ignore
}

let mainWindow: BrowserWindow | null = null;

/**
 * Creates the main floating window
 */
const createFloatingWindow = (): void => {
  // Create the browser window with floating properties
  mainWindow = new BrowserWindow({
    height: 500,
    width: 350,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    title: 'StickyRAG',
  });

  // Load renderer depending on environment
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  // Set initial position to top-right
  const { width: screenWidth, height: screenHeight } = require('electron').screen.getPrimaryDisplay().workAreaSize;
  mainWindow.setPosition(screenWidth - 350 - 20, 20);

  // Uncomment the next line if you need DevTools during debugging
  // mainWindow.webContents.openDevTools();
};

// App event handlers
app.whenReady().then(() => {
  createFloatingWindow();

  app.on('activate', () => {
    // On OS X it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      createFloatingWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// IPC Handlers
ipcMain.handle('refresh-request', async () => {
  console.log('Refresh request received');
  // Return dummy data for now
  return {
    snippets: [],
    summary: '',
  };
});

// Handle window blur/focus for opacity changes
ipcMain.on('set-inactive', () => {
  // This will be used to handle opacity changes
  console.log('Window set to inactive');
});

export {}; 