/**
 * Main Electron process
 * Handles window creation, IPC communication, and file watching
 */

import { app, BrowserWindow, ipcMain, screen } from 'electron';
import { join, resolve } from 'path';
import * as dotenv from 'dotenv';
import fs from 'fs';
import { startStickiesWatcher, watcherEvents, setBusy } from './stickiesWatcher';
import { fork, ChildProcess } from 'child_process';
import { join as joinPath } from 'path';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const parseRTF = require('rtf-parser');
import { promisify } from 'util';

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

// Path for window-state file
const statePath = join(app.getPath('userData'), 'window-state.json');

interface WindowState {
  x: number;
  y: number;
}

// Keep track of the worker process
let workerProcess: ChildProcess | null = null;
let lastParagraph: string | null = null;

// utility to extract plain text quickly
// eslint-disable-next-line @typescript-eslint/no-var-requires
const parseRtfAsync = promisify(parseRTF.string);

async function extractPlainTextFromRtfFile(rtfFilePath: string): Promise<string> {
  try {
    const raw = fs.readFileSync(rtfFilePath, 'utf8');
    const doc = await parseRtfAsync(raw);
    if (!doc || !doc.content) return '';
    const plain = doc.content
      .map((para: any) => (para.content || [])
        .map((span: any) => span.value || '')
        .join(''))
      .join('\n\n');
    return plain.trim();
  } catch {
    return '';
  }
}

async function cleanSnippetText(raw: string): Promise<string> {
  let text = raw;
  
  // Always do aggressive cleaning for snippets since RTF parsing doesn't remove artifacts
  try {
    // Try parsing as RTF first to get plain text
    const doc = await parseRtfAsync(raw);
          if (doc && doc.content) {
        text = doc.content
        .map((para: any) => (para.content || [])
          .map((span: any) => span.value || '')
          .join(''))
        .join('\n');
      console.log('\n\n\n>> got RTF parsed content, now doing aggressive cleaning');
    }
  } catch {
    console.log('\n\n\n>> RTF parsing failed, using raw content for aggressive cleaning');
    // If RTF parsing fails, use raw content for aggressive cleaning
  }
  
  // Continue with aggressive RTF artifact removal using the text we have
  let cleaned = text;
  
  // Remove specific RTF artifacts first (before other processing)
  cleaned = cleaned.replace(/irnaturaltightenfactor0(?:HYPERLINK)?/g, '');
  cleaned = cleaned.replace("irnatural", '');
  cleaned = cleaned.replace("tightenfactor0", '');
  cleaned = cleaned.replace(/naturaltightenfactor\d*/g, '');
  
  // Remove hyperlink formatting: \*HYPERLINK "url"url\
  cleaned = cleaned.replace(/\\\*HYPERLINK\s+"[^"]*"[^\\]*\\/g, '');
  
  // Remove other complex RTF controls
  cleaned = cleaned.replace(/\\\*[^\\]*\\/g, '');
  
  // Convert RTF line breaks to actual newlines
  cleaned = cleaned.replace(/\\\\/g, '\n');
  cleaned = cleaned.replace(/\\par\b/g, '\n');
  cleaned = cleaned.replace(/\\line\b/g, '\n');
  
  // Remove hex-encoded characters
  cleaned = cleaned.replace(/\\'(?:[0-9a-fA-F]{2})/g, '');
  
  // Remove RTF control words (like \tightenfactor0)
  cleaned = cleaned.replace(/\\[a-zA-Z]+\d*/g, '');
  
  // Remove any remaining single backslashes
  cleaned = cleaned.replace(/\\/g, '');
  
  // Remove braces
  cleaned = cleaned.replace(/[{}]/g, '');
  
  // Clean up multiple consecutive newlines (keep max 2)
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  
  // Clean up whitespace but preserve newlines
  cleaned = cleaned.replace(/[ \t]+/g, ' '); // collapse spaces and tabs
  cleaned = cleaned.replace(/ {2,}/g, ' '); // replace 2+ spaces with single space
  cleaned = cleaned.replace(/\n\s+/g, '\n'); // clean up whitespace after newlines
  cleaned = cleaned.replace(/\s+\n/g, '\n'); // clean up whitespace before newlines
  
  // Remove any leading/trailing whitespace
  cleaned = cleaned.trim();
  
  // Remove any remaining artifacts at the beginning
  cleaned = cleaned.replace(/^[^a-zA-Z0-9\n]*/, '');
  
  // Normalize curly quotes and weird CP1252 apostrophes to straight ASCII equivalents
  cleaned = cleaned
    .replace(/[\u2018\u2019\u201A\u0091\u0092]/g, "'") // single quotes
    .replace(/[\u201C\u201D\u201E\u0093\u0094]/g, '"');
  
  console.log('🧹 [MAIN] Cleaned snippet content:', JSON.stringify(cleaned));
  return cleaned;
}

/**
 * Creates the main floating window
 */
const createFloatingWindow = (): void => {
  // Create the browser window with floating properties
  mainWindow = new BrowserWindow({
    height: 800,
    width: 550,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    frame: false,
    transparent: false,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    title: 'StickyBrain',
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
      mainWindow.setPosition(sw - 550 - 20, 20);
    }
  } catch {
    // If parsing fails, fall back safely
    const { width: sw } = screen.getPrimaryDisplay().workAreaSize;
    mainWindow.setPosition(sw - 550 - 20, 20);
  }

  // Persist position on move/end
  mainWindow.on('move', () => {
    if (!mainWindow) return;
    const [x, y] = mainWindow.getPosition();
    fs.writeFileSync(statePath, JSON.stringify({ x, y }));
  });

  // Note: Blur event handler removed to prevent clearing content when window loses focus

  // Open DevTools only when explicitly enabled via env flag
  if (process.env.OPEN_DEVTOOLS === '1') {
    mainWindow.webContents.openDevTools();
  }
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
    // Notify UI that we are starting
    mainWindow?.webContents.send('rag-started');
    
    // Start the RAG pipeline
    setBusy(true);
    
    if (workerProcess?.killed === false) {
      workerProcess.kill();
    }
    workerProcess = startWorker();
    
    workerProcess.on('message', async (msg: any) => {
      if (msg?.type === 'result') {
        console.log('🎉 [MAIN] RAG pipeline result received!');
        // Enrich snippets with full note text
        if (msg.result?.snippets) {
          msg.result.snippets = await Promise.all(msg.result.snippets.map(async (s: any) => {
            if (s.filePath) {
              const noteText = await extractPlainTextFromRtfFile(joinPath(s.filePath, 'TXT.rtf'));
              return { ...s, noteText: await cleanSnippetText(noteText), content: await cleanSnippetText(s.content || '') };
            }
            return { ...s, content: await cleanSnippetText(s.content || '') };
          }));
        }
        mainWindow?.webContents.send('update-ui', msg.result);
        setBusy(false);
      }
    });

    workerProcess.on('exit', (code) => {
      console.log(`🚪 [MAIN] Worker process exited with code: ${code}`);
      if (code !== 0) {
        console.error('❌ [MAIN] Worker crashed. See logs above for details.');
      }
      setBusy(false);
    });
    
    lastParagraph = payload.text;
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

// IPC Handlers
ipcMain.handle('refresh-request', async () => {
  console.log('Refresh request received');
  setBusy(false); // allow new triggers
  console.log('[main] isBusy reset to false via refresh');
  return {
    snippets: [],
    summary: '',
  };
});

// Handle window blur/focus for opacity changes
ipcMain.on('set-inactive', () => {
  console.log('Window set to inactive');
});

ipcMain.handle('run-embeddings', async () => {
  console.log('[main] Run Embeddings triggered via UI');
  try {
    // Dynamically locate chroma-indexer implementation to avoid bundler resolution
    const candidates = [
      // Compiled JS (preferred in prod)
      resolve(__dirname, '../../packages/chroma-indexer/dist/index.js'),
      // Source JS emitted by ts-node in dev
      resolve(__dirname, '../../packages/chroma-indexer/src/index.js'),
    ];

    let chromaIndexer: any = null;
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        chromaIndexer = await import(`file://${p}`);
        break;
      }
    }

    if (!chromaIndexer) {
      throw new Error('Could not locate chroma-indexer implementation');
    }

    const { indexStickies } = chromaIndexer as any;
    const chroma = await import('chromadb');
    const ChromaClientCtor = (chroma as any).ChromaClient;
    const chromaClient = new ChromaClientCtor({ path: process.env.CHROMA_URL });
    const collectionName = process.env.CHROMA_COLLECTION_NAME || 'stickies_rag_v1';
    try {
      await chromaClient.deleteCollection({ name: collectionName });
      console.log('[main] Existing collection deleted');
    } catch {}

    // Determine stickies directory (same logic as watcher)
    const prodFlag = process.argv.includes('--prod');
    const defaultTestDir = join(process.cwd(), 'test-stickies');
    const macStickiesDir = join(process.env.HOME || '', 'Library/Containers/com.apple.Stickies/Data/Library/Stickies');
    const stickiesDir = process.env.STICKIES_DIR || (prodFlag ? macStickiesDir : defaultTestDir);

    console.log('[main] Starting full reindex...');
    await indexStickies({ client: chromaClient, stickiesDir });
    console.log('[main] Reindex finished');
    return { success: true };
  } catch (err) {
    console.error('[main] Reindex failed:', (err as Error).message);
    return { success: false, error: (err as Error).message };
  }
});

function startWorker(): ChildProcess {
  const distPath = join(__dirname, '../../packages/langgraph-worker/dist/index.js');
  const srcPath = join(__dirname, '../../packages/langgraph-worker/src/index.ts');

  // Use TypeScript source in development (not packaged) to pick up latest edits
  const useTsSource = !app.isPackaged || process.env.LANGGRAPH_WORKER_TS === '1';
  const workerPath = useTsSource ? srcPath : distPath;

  console.log('🔵 [MAIN] Forking worker at path:', workerPath);
  const worker = fork(workerPath, ['--child'], {
    stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    execArgv: useTsSource ? ['-r', 'ts-node/register'] : [],
  });

  // Log stdout and stderr from worker
  worker.stdout?.on('data', (data) => console.log(`[WORKER-STDOUT] ${data.toString()}`));
  worker.stderr?.on('data', (data) => console.error(`[WORKER-STDERR] ${data.toString()}`));

  return worker;
}

export {}; 