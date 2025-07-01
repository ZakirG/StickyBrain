import { test, expect } from 'vitest';
import path from 'path';
import fs from 'fs';
import {
  indexStickies,
  extractTextFromRtfd,
  splitIntoParagraphs,
  InMemoryChromaClient,
} from '../packages/chroma-indexer/src/index';

// In-memory stub client is exported inside the module via the IndexOptions but we
// don't need direct access – indexStickies will create one automatically when
// NODE_ENV === 'test'.

test('Indexer CLI indexes all sample stickies into collection', async () => {
  const sampleDir = path.resolve(__dirname, '../test-stickies');

  // Compute expected paragraph count from fixtures
  let expectedCount = 0;
  for (const entry of fs.readdirSync(sampleDir)) {
    if (entry.endsWith('.rtfd')) {
      const full = path.join(sampleDir, entry);
      const text = extractTextFromRtfd(full);
      const paragraphs = splitIntoParagraphs(text);
      expectedCount += paragraphs.length;
    }
  }

  const client = new InMemoryChromaClient();

  // Run the indexer using the injected in-memory client (no external server).
  await indexStickies({ stickiesDir: sampleDir, client });

  const collection = await client.getOrCreateCollection({ name: 'stickies_rag_v1' });
  const count = await collection.count();

  expect(count).toBe(expectedCount);
}); 