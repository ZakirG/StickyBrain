/**
 * LangGraph Worker - RAG Pipeline
 * Handles embedding, retrieval, filtering, and summarization
 */

import * as dotenv from 'dotenv';
import OpenAI from 'openai';
import { ChromaClient, ChromaClientParams } from 'chromadb';
import * as path from 'path';
import { homedir } from 'os';

// Import chroma client fallback
let InMemoryChromaClient: any;
let indexStickiesFn: undefined | ((opts?: any) => Promise<any>);

let ChromaClientCtor: any;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ChromaClientCtor = require('chromadb').ChromaClient;
} catch {}

// Async import of chroma-indexer
async function loadChromaIndexer() {
  const candidates = [
    // Built JS output (preferred if present)
    path.resolve(__dirname, '../../chroma-indexer/dist/index.js'),
    // Source JS compiled by ts (often present in dev tree)
    path.resolve(__dirname, '../../chroma-indexer/src/index.js'),
  ];

  for (const p of candidates) {
    try {
      if (!require('fs').existsSync(p)) continue;
      const chromaIndexer = await import(`file://${p}`);
      InMemoryChromaClient = chromaIndexer.InMemoryChromaClient;
      indexStickiesFn = chromaIndexer.indexStickies;
      console.log('[WORKER] Successfully loaded chroma-indexer from', p);
      return;
    } catch (err) {
      console.warn('[WORKER] Could not load chroma-indexer from', p, ':', (err as Error).message);
    }
  }

  // If we reached here, loading failed – fall back to stub
  InMemoryChromaClient = class {
    async getOrCreateCollection() {
      return {
        async query() {
          return { ids: [[]], metadatas: [[]], distances: [[]] };
        },
      };
    }
  };
  indexStickiesFn = undefined;
  console.log('[WORKER] Using fallback InMemoryChromaClient stub');
}

// Load environment variables from .env.local and .env files
dotenv.config({ path: path.resolve(__dirname, '../../../.env.local') });
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

console.log('[WORKER] Environment check:');
console.log('  - OPENAI_API_KEY present:', !!process.env.OPENAI_API_KEY);
console.log('  - CHROMA_URL:', process.env.CHROMA_URL || 'not set');

export interface Snippet {
  id: string;
  stickyTitle: string;
  content: string;
  similarity: number;
}

export interface PipelineResult {
  snippets: Snippet[];
  summary: string;
}

interface PipelineOptions {
  openai?: OpenAI;
  chromaClient?: any;
  similarityThreshold?: number;
}

interface PipelineState {
  paragraphText: string;
  embedding?: number[];
  retrievedIds?: string[];
  retrievedMetas?: any[];
  retrievedEmbeddings?: number[][];
  similarities?: number[];
  filteredSnippets?: Snippet[];
  summary?: string;
}

async function getChromaClient(opts: PipelineOptions): Promise<any> {
  if (opts.chromaClient) return opts.chromaClient;
  
  // Try to use real ChromaDB if available
  if (ChromaClientCtor) {
    try {
      const client = new ChromaClientCtor({ path: process.env.CHROMA_URL });
      // Test connection
      await client.getOrCreateCollection({ name: 'connection_test' });
      await client.deleteCollection({ name: 'connection_test' });
      console.log('[WORKER] Using ChromaDB server');
      return client;
    } catch (error) {
      console.warn('[WORKER] ChromaDB server not available, falling back to in-memory client:', error.message);
    }
  }
  
  // Fallback to in-memory client
  console.log('[WORKER] Using in-memory ChromaDB client');
  return new InMemoryChromaClient();
}

function getOpenAI(opts: PipelineOptions): OpenAI | undefined {
  return opts.openai || (process.env.OPENAI_API_KEY ? new OpenAI() : undefined);
}

/**
 * Generate embedding for text using OpenAI or fallback
 */
async function generateEmbedding(text: string, openai: OpenAI): Promise<number[]> {
  if (process.env.OPENAI_API_KEY && process.env.NODE_ENV !== 'test') {
    try {
      const response = await openai.embeddings.create({
        model: 'text-embedding-3-small',
        input: text,
      });
      return response.data[0].embedding;
    } catch (error) {
      console.warn('🔄 [WORKER] OpenAI embedding failed, using fallback:', error);
    }
  }
  
  // Fallback: deterministic hash-based embedding
  console.log('🔄 [WORKER] Using fallback embedding generation');
  const result = new Array(1536).fill(0); // Match OpenAI embedding dimensions
  for (let i = 0; i < text.length; i++) {
    result[i % 1536] += text.charCodeAt(i);
  }
  return result.map(v => (v % 1000) / 1000); // Normalize
}

/**
 * Generate summary using OpenAI or fallback
 */
async function generateSummary(paragraph: string, snippets: Snippet[], openai: OpenAI): Promise<string> {
  if (process.env.OPENAI_API_KEY && process.env.NODE_ENV !== 'test') {
    try {
      const contextText = snippets.map(s => `- ${s.stickyTitle}: ${s.content}`).join('\n');
      const prompt = `Summarize the following paragraph in at most 3 sentences:\n\n"${paragraph}"\n\nRelated context:\n${contextText}`;
      
      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        max_tokens: 150,
        messages: [
          { role: 'system', content: 'You are a concise assistant that summarizes text.' },
          { role: 'user', content: prompt },
        ],
      });
      
      return response.choices[0].message.content || 'Summary generation failed.';
    } catch (error) {
      console.warn('🔄 [WORKER] OpenAI summarization failed, using fallback:', error);
    }
  }
  
  // Fallback summary
  console.log('🔄 [WORKER] Using fallback summary generation');
  return `Summary of paragraph (${paragraph.length} chars) with ${snippets.length} related snippets found.`;
}

/** Main RAG pipeline */
export async function runRagPipeline(paragraph: string, options?: {
  openai?: OpenAI;
  chromaClient?: any;
  similarityThreshold?: number;
}): Promise<PipelineResult> {
  console.log('🚀 [WORKER] Starting RAG pipeline');
  console.log('📝 [WORKER] Input paragraph:', paragraph.substring(0, 100) + '...');
  console.log('📏 [WORKER] Input length:', paragraph.length, 'characters');

  // Ensure chroma-indexer is loaded
  if (!InMemoryChromaClient) {
    await loadChromaIndexer();
  }

  const openai = options?.openai || new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const chromaClient = options?.chromaClient || (await getChromaClient({}));
  const similarityThreshold = options?.similarityThreshold || 0.75;
  const collectionName = process.env.CHROMA_COLLECTION_NAME || 'stickies_rag_v1';

  console.log('🔧 [WORKER] Configuration:');
  console.log('  - OpenAI available:', !!openai);
  console.log('  - ChromaDB client type:', chromaClient.constructor.name);
  console.log('  - Similarity threshold:', similarityThreshold);

  // Step 1: Generate embedding
  console.log('🧠 [WORKER] Step 1: Generating embedding...');
  const embedding = await generateEmbedding(paragraph, openai);
  console.log('✅ [WORKER] Embedding generated, dimensions:', embedding.length);

  // Step 2: Retrieve similar content
  console.log('🔍 [WORKER] Step 2: Querying ChromaDB for similar content...');
  let collection = await chromaClient.getOrCreateCollection({ name: collectionName });
  const k = 5;
  console.log('📊 [WORKER] Querying for top', k, 'similar results');
  let queryResult: any;
  try {
    queryResult = await collection.query({ queryEmbeddings: [embedding], nResults: k });
  } catch (error: any) {
    const msg = (error as Error).message || '';
    if (msg.includes('dimension')) {
      console.warn('⚠️  [WORKER] Detected embedding dimension mismatch. Re-indexing collection.');
      if (typeof chromaClient.deleteCollection === 'function') {
        await chromaClient.deleteCollection({ name: collectionName });
      }
      // Ensure chroma-indexer is available
      if (!indexStickiesFn) {
        await loadChromaIndexer();
      }
      if (indexStickiesFn) {
        console.log('🔄 [WORKER] Running indexStickies to rebuild collection...');
        const defaultStickiesDir =
          process.env.STICKIES_DIR ||
          path.join(homedir(), 'Library/Containers/com.apple.Stickies/Data/Library/Stickies');
        await indexStickiesFn({ client: chromaClient, stickiesDir: defaultStickiesDir });
        console.log('✅ [WORKER] Re-index completed');
        collection = await chromaClient.getOrCreateCollection({ name: collectionName });
        queryResult = await collection.query({ queryEmbeddings: [embedding], nResults: k });
      } else {
        throw new Error('Failed to load indexStickies for re-indexing');
      }
    } else {
      throw error;
    }
  }

  const ids = queryResult.ids[0] as string[];
  const metas = queryResult.metadatas[0] as any[];
  const distances = queryResult.distances?.[0] as number[];

  console.log('📋 [WORKER] Retrieved', ids.length, 'potential matches');
  if (distances) {
    console.log('📐 [WORKER] Distance range:', Math.min(...distances).toFixed(3), 'to', Math.max(...distances).toFixed(3));
  }

  // Step 3: Filter by similarity
  console.log('🔬 [WORKER] Step 3: Filtering by similarity threshold...');
  const filteredSnippets: Snippet[] = [];
  for (let i = 0; i < ids.length; i++) {
    const similarity = distances ? 1 - distances[i] : 0.5; // Convert distance to similarity
    console.log(`📌 [WORKER] Result ${i + 1}: similarity=${similarity.toFixed(3)}, threshold=${similarityThreshold}`);
    
    if (similarity >= similarityThreshold) {
      console.log(`✅ [WORKER] Including result ${i + 1} (similarity: ${similarity.toFixed(3)})`);
      filteredSnippets.push({
        id: ids[i],
        stickyTitle: metas[i]?.stickyTitle || 'Unknown',
        content: metas[i]?.text || 'No content',
        similarity: parseFloat(similarity.toFixed(3)),
      });
    } else {
      console.log(`❌ [WORKER] Excluding result ${i + 1} (similarity: ${similarity.toFixed(3)} < ${similarityThreshold})`);
    }
  }

  console.log('📊 [WORKER] Filtered results:', filteredSnippets.length, 'of', ids.length, 'passed threshold');

  // Step 4: Generate summary
  console.log('📝 [WORKER] Step 4: Generating AI summary...');
  const summary = await generateSummary(paragraph, filteredSnippets, openai);
  console.log('✅ [WORKER] Summary generated, length:', summary.length, 'characters');
  console.log('📄 [WORKER] Summary preview:', summary.substring(0, 100) + '...');

  console.log('🎉 [WORKER] RAG pipeline completed successfully!');
  console.log('📊 [WORKER] Final results:');
  console.log('  - Snippets:', filteredSnippets.length);
  console.log('  - Summary length:', summary.length);

  return {
    snippets: filteredSnippets,
    summary,
  };
}

// Worker process mode
if (process.argv.includes('--child')) {
  console.log('🔧 [WORKER] Starting in child process mode');
  console.log('🆔 [WORKER] Process PID:', process.pid);
  
  process.on('message', async (msg: any) => {
    console.log('📨 [WORKER] Received message from main process:', JSON.stringify(msg, null, 2));
    
    if (msg?.type === 'run') {
      console.log('🎯 [WORKER] Processing RAG pipeline request');
      console.log('📝 [WORKER] Input paragraph preview:', msg.paragraph?.substring(0, 100) + '...');
      
      try {
        const result = await runRagPipeline(msg.paragraph);
        console.log('✅ [WORKER] RAG pipeline completed successfully');
        console.log('📤 [WORKER] Sending result back to main process');
        process.send?.({ type: 'result', result });
        console.log('📡 [WORKER] Result sent via IPC');
      } catch (error) {
        console.error('❌ [WORKER] RAG pipeline error:', error);
        console.log('📤 [WORKER] Sending error back to main process');
        process.send?.({ type: 'error', error: (error as Error).message });
      }
    } else {
      console.warn('⚠️  [WORKER] Unknown message type:', msg?.type);
    }
  });
  
  console.log('👂 [WORKER] Listening for messages from main process...');
} 