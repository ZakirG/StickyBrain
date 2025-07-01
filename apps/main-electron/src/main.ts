/**
 * Main Electron process
 * Handles window creation, IPC communication, and file watching
 */

import { app, BrowserWindow, ipcMain, screen } from 'electron';
import { join } from 'path';
import * as dotenv from 'dotenv';
import fs from 'fs';
import { startStickiesWatcher, watcherEvents, setBusy } from './stickiesWatcher';
import { fork, ChildProcess } from 'child_process';

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
let workerProcess: ChildProcess | null = null;
let lastParagraph: string | null = null;

// Path for window-state file
const statePath = join(app.getPath('userData'), 'window-state.json');

interface WindowState {
  x: number;
  y: number;
}

/**
 * Creates the main floating window
 */
const createFloatingWindow = (): void => {
  // Create the browser window with floating properties
  mainWindow = new BrowserWindow({
    height: 500,
    width: 350,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
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

  // Restore last position if available, else default top-right
  try {
    if (fs.existsSync(statePath)) {
      const state = JSON.parse(fs.readFileSync(statePath, 'utf-8')) as WindowState;
      mainWindow.setPosition(state.x, state.y);
    } else {
      const { width: sw } = screen.getPrimaryDisplay().workAreaSize;
      mainWindow.setPosition(sw - 350 - 20, 20);
    }
  } catch {
    // If parsing fails, fall back safely
    const { width: sw } = screen.getPrimaryDisplay().workAreaSize;
    mainWindow.setPosition(sw - 350 - 20, 20);
  }

  // Persist position on move/end
  mainWindow.on('move', () => {
    if (!mainWindow) return;
    const [x, y] = mainWindow.getPosition();
    fs.writeFileSync(statePath, JSON.stringify({ x, y }));
  });

  // Forward blur event to renderer to trigger opacity change
  mainWindow.on('blur', () => {
    mainWindow?.webContents.send('update-ui', { snippets: [], summary: '', inactive: true });
  });

  // Uncomment the next line if you need DevTools during debugging
  // mainWindow.webContents.openDevTools();
};

// App event handlers
app.whenReady().then(() => {
  createFloatingWindow();

  // Determine Stickies directory
  const prodFlag = process.argv.includes('--prod');
  const defaultTestDir = join(process.cwd(), 'test-stickies');
  const macStickiesDir = join(process.env.HOME || '', 'Library/Containers/com.apple.Stickies/Data/Library/Stickies');
  const stickiesDir = process.env.STICKIES_DIR || (prodFlag ? macStickiesDir : defaultTestDir);
  console.log('[main] Starting watcher on Stickies dir:', stickiesDir);
  console.log('[main] Directory exists:', fs.existsSync(stickiesDir));
  startStickiesWatcher({ stickiesDir });

  watcherEvents.on('input-paragraph', (payload) => {
    console.log('[main] input-paragraph event', payload.filePath);
    lastParagraph = payload.text;
    
    if (!workerProcess) {
      workerProcess = startWorker();
    }
    
    setBusy(true);
    console.log('[main] Sending paragraph to worker');
    workerProcess.send({ type: 'run', paragraph: payload.text });
  });

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

/**
 * Spawn the RAG worker process
 */
function startWorker(): ChildProcess {
  const workerPath = join(__dirname, '../../../packages/langgraph-worker/src/index.ts');
  const worker = fork(workerPath, ['--child'], {
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
  });

  worker.on('message', (msg: any) => {
    if (msg?.type === 'result') {
      console.log('[main] Worker result received');
      setBusy(false);
      // Forward result to renderer
      mainWindow?.webContents.send('update-ui', msg.result);
    }
  });

  worker.on('error', (err) => {
    console.error('[main] Worker error:', err);
    setBusy(false);
  });

  worker.on('exit', (code) => {
    console.log('[main] Worker exited with code:', code);
    setBusy(false);
  });

  return worker;
}

// IPC Handlers
ipcMain.handle('refresh-request', async () => {
  console.log('Refresh request received');
  
  if (lastParagraph) {
    if (!workerProcess) {
      workerProcess = startWorker();
    }
    setBusy(true);
    console.log('[main] Manual refresh with last paragraph');
    workerProcess.send({ type: 'run', paragraph: lastParagraph });
  } else {
    setBusy(false);
  }
  
  return {
    snippets: [],
    summary: '',
  };
});

// Handle window blur/focus for opacity changes
ipcMain.on('set-inactive', () => {
  console.log('Window set to inactive');
});

export {}; 