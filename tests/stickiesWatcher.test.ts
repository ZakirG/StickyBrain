import { test, expect } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { startStickiesWatcher, watcherEvents, getBusy } from '../apps/main-electron/src/stickiesWatcher';

function createRtfd(dir: string, name: string, content: string) {
  const rtfdPath = path.join(dir, `${name}.rtfd`);
  fs.mkdirSync(rtfdPath, { recursive: true });
  fs.writeFileSync(path.join(rtfdPath, 'TXT.rtf'), content, 'utf8');
  return rtfdPath;
}

test('watcher emits input-paragraph and sets isBusy', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sticky-test-'));
  const initialRtf = '{\\rtf1\nHello}';
  createRtfd(tmp, 'note', initialRtf);

  const watcher = startStickiesWatcher({ stickiesDir: tmp });

  const eventPromise = new Promise<{ text: string; filePath: string }>((resolve) => {
    watcherEvents.once('input-paragraph', (payload) => resolve(payload));
  });

  // Append text ending with period.
  const rtfFile = path.join(tmp, 'note.rtfd', 'TXT.rtf');
  fs.appendFileSync(rtfFile, ' New sentence.');

  const payload = await eventPromise;

  expect(payload.text.includes('New sentence')).toBe(true);
  expect(getBusy()).toBe(true);

  await watcher.close();
}); 