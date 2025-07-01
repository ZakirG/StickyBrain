import chokidar from 'chokidar';
import path from 'path';
import fs from 'fs';
import { EventEmitter } from 'events';

/**
 * Events emitted by the Stickies watcher
 * - input-paragraph: { text: string; filePath: string }
 */
export const watcherEvents = new EventEmitter();

let isBusy = false;
export function setBusy(val: boolean) {
  isBusy = val;
  console.log('[watcher] setBusy', val);
}
export function getBusy() {
  return isBusy;
}

interface WatcherOptions {
  stickiesDir: string;
}

// Cache last content of each sticky
const lastContent: Record<string, string> = {};
// Debounce handles
const debounceTimers: Record<string, NodeJS.Timeout> = {};

function basicExtractPlainText(rtf: string): string {
  return rtf
    .replace(/\\'([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\par[d]?/g, '\n')
    .replace(/\\[^\s]+ ?/g, '')
    .replace(/[{}]/g, '')
    .trim();
}

export function startStickiesWatcher(opts: WatcherOptions) {
  const { stickiesDir } = opts;
  console.log('[watcher] Starting watcher for:', stickiesDir);
  // Some sticky note packages are named *.rtfd or *.rtfd.sb-<hash>; watch any immediate subdir then TXT.rtf file.
  const globPattern = path.join(stickiesDir, '**/TXT.rtf');
  const watcher = chokidar.watch(globPattern, {
    // watch for new files, changes, deletions
    ignoreInitial: true,
    depth: 2, // only the package dir and its immediate children
    usePolling: true,
    interval: 500,
  });
  console.log('[watcher] Chokidar watching pattern:', globPattern);

  watcher.on('all', (ev, p) => {
    console.log('[watcher] fs event', ev, p);
    if (ev === 'change' || ev === 'add') {
      if (debounceTimers[p]) clearTimeout(debounceTimers[p]);
      debounceTimers[p] = setTimeout(() => handleChange(p), 200);
    }
  });

  return watcher;
}

function handleChange(rtfFilePath: string) {
  try {
    console.log('[watcher] handleChange reading file:', rtfFilePath);
    const raw = fs.readFileSync(rtfFilePath, 'utf8');
    const plain = basicExtractPlainText(raw);
    console.log('[watcher] extracted plain text length:', plain.length);

    const prev = lastContent[rtfFilePath] || '';
    lastContent[rtfFilePath] = plain;

    // diff: new chars = plain.slice(prev.length)
    const diff = plain.slice(prev.length);
    console.log('[watcher] diff:', JSON.stringify(diff));
    if (!diff) return;

    const lastChar = diff.slice(-1);
    console.log('[watcher] lastChar test:', lastChar, 'matches:', /[.!?\n]/.test(lastChar));
    if (!/[.!?\n]/.test(lastChar)) return;

    console.log('[watcher] diff triggers emit lastChar', lastChar);

    console.log('[watcher] isBusy check:', isBusy);
    if (isBusy) return;

    isBusy = true;
    watcherEvents.emit('input-paragraph', {
      text: getLastParagraph(plain),
      filePath: rtfFilePath,
    });
    console.log('[watcher] emitted input-paragraph');
  } catch (err) {
    console.error('[stickiesWatcher] Error processing change:', err);
  }
}

function getLastParagraph(text: string): string {
  const parts = text.split(/\n{2,}/).filter((p) => p.trim().length > 0);
  return parts[parts.length - 1] || text;
} 