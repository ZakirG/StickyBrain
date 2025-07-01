/**
 * LangGraph Worker - RAG Pipeline
 * Handles embedding, retrieval, filtering, and summarization
 */

import * as dotenv from 'dotenv';
import OpenAI from 'openai';
import { cosineSimilarity } from './util';

// Import chroma client fallback
import {
  InMemoryChromaClient,
  InMemoryCollection,
} from '../../chroma-indexer/src/index';

let ChromaClientCtor: any;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ChromaClientCtor = (await import('chromadb')).ChromaClient;
} catch {}

dotenv.config();

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

function getChromaClient(opts: PipelineOptions): any {
  if (opts.chromaClient) return opts.chromaClient;
  if (ChromaClientCtor) return new ChromaClientCtor({ path: process.env.CHROMA_URL });
  return new InMemoryChromaClient();
}

function getOpenAI(opts: PipelineOptions): OpenAI | undefined {
  return opts.openai || (process.env.OPENAI_API_KEY ? new OpenAI() : undefined);
}

/** Main RAG pipeline */
export async function runRagPipeline(paragraphText: string, opts: PipelineOptions = {}): Promise<PipelineResult> {
  const openai = getOpenAI(opts);
  const chroma = getChromaClient(opts);
  const collection = await chroma.getOrCreateCollection({ name: 'stickies_rag_v1' });

  const state: PipelineState = { paragraphText };

  // Embed
  let embedding: number[];
  if (openai) {
    const resp = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: paragraphText,
    });
    embedding = resp.data[0].embedding as unknown as number[];
  } else {
    // deterministic fallback: simple hash
    embedding = Array.from(paragraphText).map((c) => c.charCodeAt(0) / 255);
  }

  // Retrieve top k
  const k = 5;
  const query = await collection.query({ queryEmbeddings: [embedding], nResults: k });
  const ids = query.ids[0] as string[];
  const metas = query.metadatas[0] as any[];
  const embeddings = query.embeddings?.[0] as number[][] | undefined;

  // Compute similarity if not returned
  const sims: number[] = [];
  if (query.distances) {
    sims.push(...(query.distances[0] as number[]).map((d) => 1 - d));
  } else if (embeddings) {
    embeddings.forEach((emb) => sims.push(cosineSimilarity(embedding, emb)));
  }

  const snippets: Snippet[] = ids.map((id, idx) => ({
    id,
    stickyTitle: metas[idx]?.stickyTitle || metas[idx]?.filePath?.split('/')?.pop() || 'unknown',
    content: metas[idx]?.text || metas[idx]?.content || '',
    similarity: sims[idx] ?? 0,
  }));

  // Filter
  const threshold = opts.similarityThreshold ?? 0.75;
  const filtered = snippets.filter((s) => s.similarity >= threshold);

  // Summarise
  let summary = '';
  if (openai) {
    const sys = 'You are a concise assistant.';
    const prompt = `Summarise the following paragraph in at most 3 sentences.\n\n"""${paragraphText}"""`;
    const resp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      max_tokens: 150,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: prompt },
      ],
    });
    summary = resp.choices[0].message.content ?? '';
  } else {
    summary = 'Mock summary.';
  }

  return { snippets: filtered, summary };
}

// Utility: if executed as worker process, listen for messages
if (process.argv[2] === '--child') {
  process.on('message', async (msg: any) => {
    if (msg?.type === 'run' && msg.paragraph) {
      const result = await runRagPipeline(msg.paragraph);
      process.send?.({ type: 'result', result });
    }
  });
} 