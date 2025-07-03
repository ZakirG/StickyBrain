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
  
  console.log('🧹 [MAIN] Input to cleanSnippetText:', JSON.stringify(text.substring(0, 100)));
  
  // Check if this looks like RTF content (starts with {\rtf or contains RTF control words)
  const isRtfContent = text.startsWith('{\\rtf') || /\\[a-zA-Z]+\d*/.test(text);
  
  if (isRtfContent) {
    console.log('🧹 [MAIN] Detected RTF content, parsing...');
    // This is RTF content, parse it
    try {
      const doc = await parseRtfAsync(raw);
      if (doc && doc.content) {
        text = doc.content
          .map((para: any) => (para.content || [])
            .map((span: any) => span.value || '')
            .join(''))
          .join('\n');
        console.log('🧹 [MAIN] RTF parsed successfully');
      }
    } catch (error) {
      console.log('🧹 [MAIN] RTF parsing failed, using raw content');
      // If RTF parsing fails, use raw content
    }
  } else {
    console.log('🧹 [MAIN] Plain text content detected, skipping RTF parsing');
    // This is already plain text from the vector database, no RTF parsing needed
  }
  
  // Light cleaning for display (remove any remaining artifacts)
  let cleaned = text;
  
  // Remove any hex escape sequences that might have survived
  cleaned = cleaned.replace(/\\x[0-9a-fA-F]{2}/g, '');
  
  // Remove any remaining backslash sequences
  cleaned = cleaned.replace(/\\[a-zA-Z]+\d*/g, '');
  cleaned = cleaned.replace(/\\/g, '');
  
  // Remove braces
  cleaned = cleaned.replace(/[{}]/g, '');
  
  // Clean up whitespace but preserve newlines
  // Replace multiple spaces/tabs with single space, but keep newlines
  cleaned = cleaned.replace(/[ \t]+/g, ' ');
  // Clean up excessive newlines (more than 2 consecutive)
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');
  // Trim whitespace from start and end
  cleaned = cleaned.trim();
  
  console.log('🧹 [MAIN] Cleaned snippet content:', JSON.stringify(cleaned.substring(0, 100)));
  return cleaned;
}

/**
 * Creates the main floating window
 */
const createFloatingWindow = (): void => {
  // Create the browser window with floating properties
  mainWindow = new BrowserWindow({
    height: 800,
    width: 900,
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
      mainWindow.setPosition(sw - 1100 - 20, 20);
    }
  } catch {
    // If parsing fails, fall back safely
    const { width: sw } = screen.getPrimaryDisplay().workAreaSize;
    mainWindow.setPosition(sw - 1100 - 20, 20);
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

  watcherEvents.on('input-paragraph', async (payload) => {
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
      } else if (msg?.type === 'incremental-update') {
        console.log('📊 [MAIN] Incremental update received');
        console.log('📊 [MAIN] Incremental update data:', {
          hasSnippets: !!msg.partialResult?.snippets,
          snippetCount: msg.partialResult?.snippets?.length || 0,
          hasSummary: !!msg.partialResult?.summary,
          summaryLength: msg.partialResult?.summary?.length || 0,
          hasWebSearchPrompt: !!msg.partialResult?.webSearchPrompt,
          webSearchPromptLength: msg.partialResult?.webSearchPrompt?.length || 0,
          hasWebSearchResults: !!msg.partialResult?.webSearchResults,
          webSearchResultsCount: msg.partialResult?.webSearchResults?.length || 0,
        });
        // Enrich snippets if they exist in the incremental update
        if (msg.partialResult?.snippets) {
          msg.partialResult.snippets = await Promise.all(msg.partialResult.snippets.map(async (s: any) => {
            if (s.filePath) {
              const noteText = await extractPlainTextFromRtfFile(joinPath(s.filePath, 'TXT.rtf'));
              return { ...s, noteText: await cleanSnippetText(noteText), content: await cleanSnippetText(s.content || '') };
            }
            return { ...s, content: await cleanSnippetText(s.content || '') };
          }));
        }
        console.log('📊 [MAIN] Sending incremental update to renderer');
        mainWindow?.webContents.send('incremental-update', msg.partialResult);
        console.log('✅ [MAIN] Incremental update sent to renderer');
      }
    });

    workerProcess.on('exit', (code) => {
      console.log(`🚪 [MAIN] Worker process exited with code: ${code}`);
      if (code !== 0) {
        console.error('❌ [MAIN] Worker crashed. See logs above for details.');
      }
      setBusy(false);
    });
    
    // Load user goals to pass to the worker
    let userGoals = '';
    try {
      if (fs.existsSync(userGoalsPath)) {
        userGoals = fs.readFileSync(userGoalsPath, 'utf-8');
        console.log('[MAIN] Loaded user goals for RAG pipeline:', userGoals.substring(0, 100));
      }
    } catch (error) {
      console.warn('[MAIN] Failed to load user goals for RAG pipeline:', error);
    }
    
    lastParagraph = payload.text;
    console.log('📁 [MAIN] Current sticky file path:', payload.filePath);
    console.log('🎯 [MAIN] User goals being sent to worker:', userGoals.substring(0, 100));
    workerProcess.send({ 
      type: 'run', 
      paragraph: payload.text, 
      currentFilePath: payload.filePath,
      userGoals: userGoals
    });
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

// User Goals persistence
const userGoalsPath = join(app.getPath('userData'), 'user-goals.txt');

ipcMain.handle('load-user-goals', async () => {
  try {
    if (fs.existsSync(userGoalsPath)) {
      const goals = fs.readFileSync(userGoalsPath, 'utf-8');
      console.log('[main] User goals loaded from:', userGoalsPath);
      return goals;
    }
    return '';
  } catch (error) {
    console.error('[main] Failed to load user goals:', error);
    return '';
  }
});

ipcMain.handle('save-user-goals', async (_, goals: string) => {
  try {
    fs.writeFileSync(userGoalsPath, goals, 'utf-8');
    console.log('[main] User goals saved to:', userGoalsPath);
    return { success: true };
  } catch (error) {
    console.error('[main] Failed to save user goals:', error);
    throw error;
  }
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

    console.log('🔍 [MAIN] Looking for chroma-indexer in candidates:');
    candidates.forEach((p, idx) => {
      const exists = fs.existsSync(p);
      console.log(`  ${idx + 1}. ${p} - exists: ${exists}`);
    });

    let chromaIndexer: any = null;
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        console.log('🔍 [MAIN] Attempting to import:', p);
        try {
          // Try CommonJS require first since we changed to CommonJS output
          delete require.cache[require.resolve(p)];
          chromaIndexer = require(p);
          console.log('🔍 [MAIN] CommonJS require succeeded');
          console.log('🔍 [MAIN] Module keys:', Object.keys(chromaIndexer || {}));
          break;
        } catch (requireErr) {
          console.log('🔍 [MAIN] CommonJS require failed:', (requireErr as Error).message);
          try {
            // Fallback to ES module import
            chromaIndexer = await import(`file://${p}`);
            console.log('🔍 [MAIN] ES module import succeeded');
            console.log('🔍 [MAIN] Module keys:', Object.keys(chromaIndexer || {}));
            break;
          } catch (importErr) {
            console.log('🔍 [MAIN] ES module import failed:', (importErr as Error).message);
          }
        }
      }
    }

    if (!chromaIndexer) {
      throw new Error('Could not locate chroma-indexer implementation');
    }

    console.log('🔍 [MAIN] Checking for indexStickies function:', !!chromaIndexer.indexStickies);
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
    console.error('[main] Reindex error stack:', (err as Error).stack);
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