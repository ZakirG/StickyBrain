#!/usr/bin/env node

/**
 * Chroma Indexer CLI
 * Indexes Stickies into ChromaDB with paragraph-level chunking
 */

import * as dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import os from 'os';
import OpenAI from 'openai';

// Load environment variables
dotenv.config();

// Try to import Chroma client – fallback to undefined if lib not available at runtime
let ChromaClientCtor: any;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ChromaClientCtor = (await import('chromadb')).ChromaClient;
} catch {
  ChromaClientCtor = undefined;
}

/**
 * Minimal in-memory collection used during tests when the real Chroma client is not available.
 */
export class InMemoryCollection {
  private ids: Set<string> = new Set();

  async upsert(params: {
    ids: string[];
    embeddings: number[][];
    metadatas?: Record<string, unknown>[];
  }) {
    params.ids.forEach((id) => this.ids.add(id));
  }

  async count(): Promise<number> {
    return this.ids.size;
  }
}

/**
 * Very small stub that imitates the public surface we require from the JS Chroma client.
 */
export class InMemoryChromaClient {
  private collections: Map<string, InMemoryCollection> = new Map();

  async getOrCreateCollection({ name }: { name: string }) {
    if (!this.collections.has(name)) {
      this.collections.set(name, new InMemoryCollection());
    }
    return this.collections.get(name)!;
  }

  async getCollection({ name }: { name: string }) {
    return this.collections.get(name);
  }

  async deleteCollection({ name }: { name: string }) {
    this.collections.delete(name);
  }
}

/**
 * Extracts plain text from RTFD files by reading TXT.rtf and stripping RTF tags
 * @param rtfdPath Path to the .rtfd bundle
 * @returns Plain text content
 */
export function extractTextFromRtfd(rtfdPath: string): string {
  const rtfFile = path.join(rtfdPath, 'TXT.rtf');
  if (!fs.existsSync(rtfFile)) {
    throw new Error(`TXT.rtf not found inside ${rtfdPath}`);
  }

  const raw = fs.readFileSync(rtfFile, 'utf8');

  // Hex-encoded chars (\'hh)
  let text = raw.replace(/\\'([0-9a-fA-F]{2})/g, (_, hex) => {
    return String.fromCharCode(parseInt(hex, 16));
  });

  // Convert paragraph delimiters to real newlines
  text = text.replace(/\\par[d]?/g, '\n');

  // Remove all other control words
  text = text.replace(/\\[a-zA-Z]+-?\d* ?/g, '');

  // Remove braces
  text = text.replace(/[{}]/g, '');

  // Collapse spaces and tabs (preserve newlines for paragraph detection)
  text = text.replace(/[ \t\r]+/g, ' ').trim();

  return text;
}

/**
 * Splits text into paragraphs on double newlines
 * @param text Input text
 * @returns Array of paragraph strings
 */
export function splitIntoParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/**
 * Generate a deterministic, low-dimension embedding for environments where no
 * OpenAI key is present or network calls are undesirable (e.g. CI).
 */
function mockEmbedding(text: string): number[] {
  // Simple 5-dim hash based on character codes
  const result = new Array(5).fill(0);
  for (let i = 0; i < text.length; i++) {
    result[i % 5] += text.charCodeAt(i);
  }
  return result.map((v) => v % 1_000 / 1_000); // keep numbers small
}

async function embedBatch(texts: string[]): Promise<number[][]> {
  const apiKey = process.env.OPENAI_API_KEY;

  // Use real embeddings when possible and NODE_ENV is not 'test'
  if (apiKey && process.env.NODE_ENV !== 'test') {
    const openai = new OpenAI({ apiKey });
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: texts,
    });
    // The SDK returns { data: [{ embedding: number[] }, ...] }
    return response.data.map((d: any) => d.embedding as number[]);
  }

  // Fallback to local mock embeddings
  return texts.map((t) => mockEmbedding(t));
}

export interface IndexOptions {
  /** Override stickies directory (useful for tests). */
  stickiesDir?: string;
  /** Provide a custom Chroma-compatible client (e.g. in-memory stub). */
  client?: any;
}

export async function indexStickies(opts: IndexOptions = {}) {
  const stickiesDir =
    opts.stickiesDir ||
    path.join(
      os.homedir(),
      'Library/Containers/com.apple.Stickies/Data/Library/Stickies'
    );

  if (!fs.existsSync(stickiesDir)) {
    throw new Error(`Stickies directory not found at ${stickiesDir}`);
  }

  const rtfdPaths: string[] = [];
  for (const entry of fs.readdirSync(stickiesDir)) {
    if (entry.endsWith('.rtfd')) {
      rtfdPaths.push(path.join(stickiesDir, entry));
    }
  }

  console.log(`[index] Found ${rtfdPaths.length} stickies…`);

  const paragraphs: {
    id: string;
    text: string;
    meta: Record<string, unknown>;
  }[] = [];

  rtfdPaths.forEach((p) => {
    const plain = extractTextFromRtfd(p);
    const chunks = splitIntoParagraphs(plain);
    const stickyTitle = path.basename(p, '.rtfd');

    chunks.forEach((chunk, idx) => {
      paragraphs.push({
        id: `${stickyTitle}_${idx}`,
        text: chunk,
        meta: {
          filePath: p,
          stickyTitle,
          paragraphIndex: idx,
        },
      });
    });
  });

  console.log(`[index] Total paragraphs: ${paragraphs.length}`);

  // Chunk into batches of 100
  const batches: typeof paragraphs[] = [];
  for (let i = 0; i < paragraphs.length; i += 100) {
    batches.push(paragraphs.slice(i, i + 100));
  }

  // Decide which Chroma client to use
  const client =
    opts.client ||
    (ChromaClientCtor ? new ChromaClientCtor({ path: process.env.CHROMA_URL }) : new InMemoryChromaClient());

  // In test environment, make the client discoverable for assertions
  if (process.env.NODE_ENV === 'test') {
    (globalThis as any).__chromadbClient = client;
  }

  const collection = await client.getOrCreateCollection({ name: 'stickies_rag_v1' });

  let processed = 0;
  for (const batch of batches) {
    const embeddings = await embedBatch(batch.map((b) => b.text));

    await collection.upsert({
      ids: batch.map((b) => b.id),
      embeddings,
      metadatas: batch.map((b) => b.meta),
    });

    processed += batch.length;
    console.log(`[index] Upserted ${processed}/${paragraphs.length}`);
  }

  console.log('[index] ✅ Done');
}

async function mainCLI() {
  const dirArg = process.argv[2];
  try {
    await indexStickies({ stickiesDir: dirArg });
  } catch (err) {
    console.error('[index] ❌ Error:', (err as Error).message);
    process.exit(1);
  }
}

// Execute when run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  mainCLI();
} 