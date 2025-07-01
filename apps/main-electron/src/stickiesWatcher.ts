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
  // Handle hex-encoded characters first
  let text = rtf.replace(/\\'([0-9a-fA-F]{2})/g, (_, hex) => {
    return String.fromCharCode(parseInt(hex, 16));
  });
  
  // Find the actual text content after RTF headers
  // Look for the pattern that starts actual content (after font/color tables)
  const contentMatch = text.match(/\\f\d+\\fs\d+\s*\\cf\d+\s*(.+?)(?:\}|$)/s);
  if (contentMatch) {
    text = contentMatch[1];
  } else {
    // Fallback: try to find content after the last }
    const parts = text.split('}');
    if (parts.length > 1) {
      text = parts[parts.length - 2] || parts[parts.length - 1];
    }
  }
  
  // Convert RTF line breaks to actual line breaks
  text = text.replace(/\\\\/g, '\n'); // Double backslash = line break
  text = text.replace(/\\par\b/g, '\n'); // Paragraph break
  text = text.replace(/\\line\b/g, '\n'); // Line break
  
  // Remove remaining RTF control words
  text = text.replace(/\\[a-zA-Z]+\d*/g, '');
  
  // Remove RTF control symbols
  text = text.replace(/\\./g, '');
  
  // Remove any remaining braces
  text = text.replace(/[{}]/g, '');
  
  // Clean up whitespace
  text = text.replace(/\s+/g, ' ');
  text = text.replace(/^\s+|\s+$/g, '');
  
  // Remove any trailing percent signs or other RTF artifacts
  text = text.replace(/%\s*$/, '');
  
  return text;
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
    console.log('👀 [WATCHER] File change detected:', rtfFilePath);
    console.log('⏰ [WATCHER] Change timestamp:', new Date().toISOString());
    console.log('📝 [WATCHER] Starting file change processing');
    const raw = fs.readFileSync(rtfFilePath, 'utf8');
    let plain = basicExtractPlainText(raw);
    // Remove stray backslashes inserted by macOS Stickies line-break markers
    plain = plain.replace(/\\+/g, '');

    console.log('📄 [WATCHER] Extracted plain text length:', plain.length, 'characters');
    console.log('📄 [WATCHER] Content preview:', plain.substring(0, 100) + '...');

    const prev = lastContent[rtfFilePath] || '';
    lastContent[rtfFilePath] = plain;

    // diff: new chars = plain.slice(prev.length)
    const diff = plain.slice(prev.length);
    console.log('🔄 [WATCHER] Content diff:', JSON.stringify(diff));
    console.log('📏 [WATCHER] Previous length:', prev.length, '| New length:', plain.length);
    if (!diff) return;

    // Determine last meaningful character of the entire note to avoid diff quirks
    const lastChar = plain.trim().slice(-1);
    console.log('🔚 [WATCHER] Last character (overall note):', JSON.stringify(lastChar));
    const sentenceEnded = /[.!?\n]/.test(lastChar);
    console.log('✅ [WATCHER] Sentence ending test:', sentenceEnded);
    if (!sentenceEnded) return;

    console.log('✅ [WATCHER] Complete sentence detected! Last char:', JSON.stringify(lastChar));

    console.log('🔄 [WATCHER] Checking if system is busy:', isBusy);
    if (isBusy) return;

    console.log('📤 [WATCHER] Emitting input-paragraph event');
    isBusy = true;
    const lastParagraph = getLastParagraph(plain);
    console.log('📝 [WATCHER] Last paragraph length:', lastParagraph.length);
    console.log('📝 [WATCHER] Last paragraph preview:', lastParagraph.substring(0, 100) + '...');
    
    watcherEvents.emit('input-paragraph', {
      text: lastParagraph,
      filePath: rtfFilePath,
    });
    console.log('🎉 [WATCHER] Event emitted successfully!');
  } catch (err) {
    console.error('❌ [WATCHER] Error processing file change:', err);
  }
}

function getLastParagraph(text: string): string {
  // Remove stray backslashes before splitting
  const sanitized = text.replace(/\\+/g, '').trim();
  const parts = sanitized.split(/\n{2,}/).filter((p) => p.trim().length > 0);
  return parts[parts.length - 1] || text;
} 