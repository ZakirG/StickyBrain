/**
 * LangGraph Worker - RAG Pipeline
 * Handles embedding, retrieval, filtering, and summarization using LangGraph StateGraph
 */

import * as dotenv from 'dotenv';
import OpenAI from 'openai';
import { ChromaClient, ChromaClientParams } from 'chromadb';
import * as path from 'path';
import { homedir } from 'os';
import { StateGraph, MessagesAnnotation, Annotation } from '@langchain/langgraph';
import { BaseMessage, HumanMessage } from '@langchain/core/messages';

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
  console.log('🔍 [WORKER] Starting loadChromaIndexer...');
  
  const candidates = [
    // Built JS output (preferred if present)
    path.resolve(__dirname, '../../chroma-indexer/dist/index.js'),
    // JS emitted in dev tree
    path.resolve(__dirname, '../../chroma-indexer/src/index.js'),
    // Raw TS source – will require ts-node
    path.resolve(__dirname, '../../chroma-indexer/src/index.ts'),
  ];

  console.log('🔍 [WORKER] __dirname:', __dirname);
  console.log('🔍 [WORKER] Candidate paths:');
  candidates.forEach((p, idx) => {
    console.log(`  ${idx + 1}. ${p}`);
  });

  for (const p of candidates) {
    console.log(`🔍 [WORKER] Checking candidate: ${p}`);
    
    try {
      const exists = require('fs').existsSync(p);
      console.log(`🔍 [WORKER] File exists: ${exists}`);
      
      if (!exists) {
        console.log(`🔍 [WORKER] Skipping ${p} - file does not exist`);
        continue;
      }

      console.log(`🔍 [WORKER] Attempting to load: ${p}`);

      // Register ts-node on demand so that require() can handle TS files
      if (p.endsWith('.ts')) {
        console.log('🔍 [WORKER] Registering ts-node for TypeScript file');
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        require('ts-node/register');
      }

      let chromaIndexer: any | undefined;

      /*
       * CommonJS (ts-node/register) path
       * ---------------------------------
       * When the worker is executed through ts-node, the module system is CJS.
       * In that case `await import()` is transpiled to `require()` internally,
       * but the generated specifier still contains the `file://` protocol which
       * `require()` cannot resolve. We therefore try a plain `require(p)` first.
       */
      if (typeof require === 'function') {
        console.log('🔍 [WORKER] Trying CommonJS require()...');
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          chromaIndexer = require(p);
          console.log('🔍 [WORKER] CommonJS require() succeeded');
          console.log('🔍 [WORKER] Module keys:', Object.keys(chromaIndexer || {}));
        } catch (err) {
          console.log('🔍 [WORKER] CommonJS require() failed:', (err as Error).message);
          // noop – will attempt dynamic import next
        }
      }

      /*
       * ESM path
       * --------
       * If `require()` failed (or is unavailable because the code was bundled
       * as an ES module) fall back to a native dynamic import with the
       * `file://` prefix.
       */
      if (!chromaIndexer) {
        console.log('🔍 [WORKER] Trying ESM dynamic import...');
        // Use a runtime-evaluated dynamic import to avoid ts-node rewriting it
        // into a CJS require() (which cannot handle file URLs or ESM modules).
        try {
          // Node supports importing either a file URL or absolute path.
          const url = p.startsWith('/') ? `file://${p}` : p;
          console.log('🔍 [WORKER] Import URL:', url);
          // eslint-disable-next-line no-new-func
          chromaIndexer = await (new Function('u', 'return import(u)'))(url);
          console.log('🔍 [WORKER] ESM dynamic import succeeded');
          console.log('🔍 [WORKER] Module keys:', Object.keys(chromaIndexer || {}));
        } catch (err) {
          console.log('🔍 [WORKER] ESM dynamic import failed:', (err as Error).message);
          chromaIndexer = undefined;
        }
      }

      if (chromaIndexer) {
        console.log('🔍 [WORKER] Checking for required exports...');
        console.log('🔍 [WORKER] InMemoryChromaClient available:', !!chromaIndexer.InMemoryChromaClient);
        console.log('🔍 [WORKER] indexStickies available:', !!chromaIndexer.indexStickies);
        
        InMemoryChromaClient = chromaIndexer.InMemoryChromaClient;
        indexStickiesFn = chromaIndexer.indexStickies;
        console.log('[WORKER] Successfully loaded chroma-indexer from', p);
        return;
      } else {
        console.log(`🔍 [WORKER] Failed to load module from ${p} - chromaIndexer is undefined`);
      }
    } catch (err) {
      console.warn('[WORKER] Could not load chroma-indexer from', p, ':', (err as Error).message);
      console.warn('[WORKER] Error stack:', (err as Error).stack);
    }
  }

  // If we reached here, loading failed – fall back to stub
  console.log('🔍 [WORKER] All loading attempts failed, using fallback stub');
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
  filePath?: string;
}

export interface PipelineResult {
  snippets: Snippet[];
  summary: string;
  webSearchPrompt?: string;
  webSearchResults?: WebSearchResult[];
  stickyBrainSynthesis?: string;
}

export interface WebSearchResult {
  query: string;
  title: string;
  url: string;
  description: string;
  scrapedContent?: string;
  scrapingError?: string;
  pageSummary?: string;
  summarizationError?: string;
  selectedForSummarization?: boolean;
  selectedForScraping?: boolean;
}

interface PipelineOptions {
  openai?: OpenAI;
  chromaClient?: any;
  similarityThreshold?: number;
}

/**
 * LangGraph State Interface
 * Defines the state that flows between nodes in the graph
 */
const RagStateAnnotation = Annotation.Root({
  // Input
  paragraphText: Annotation<string>,
  currentFilePath: Annotation<string>,
  userGoals: Annotation<string>,
  
  // Configuration
  openai: Annotation<OpenAI>,
  chromaClient: Annotation<any>,
  similarityThreshold: Annotation<number>,
  
  // Intermediate state
  embedding: Annotation<number[]>,
  retrievedIds: Annotation<string[]>,
  retrievedMetas: Annotation<any[]>,
  retrievedDistances: Annotation<number[]>,
  
  // Filtered results
  filteredSnippets: Annotation<Snippet[]>,
  
  // Web search prompt generation
  webSearchPrompt: Annotation<string>,
  webSearchResults: Annotation<WebSearchResult[]>,
  
  // Final output
  summary: Annotation<string>,
  stickyBrainSynthesis: Annotation<string>,
  result: Annotation<PipelineResult>,
});

type RagState = typeof RagStateAnnotation.State;

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
 * InputNode - Initializes the state with input paragraph and configuration
 */
async function inputNode(state: RagState): Promise<Partial<RagState>> {
  console.log('🚀 [INPUT NODE] Processing input paragraph');
  console.log('📝 [INPUT NODE] Input paragraph:', state.paragraphText.substring(0, 100) + '...');
  console.log('📏 [INPUT NODE] Input length:', state.paragraphText.length, 'characters');
  
  // Ensure chroma-indexer is loaded
  if (!InMemoryChromaClient) {
    await loadChromaIndexer();
  }

  return {
    // State is already populated by the graph initialization
  };
}

/**
 * EmbedNode - Generates embedding for the input paragraph
 */
async function embedNode(state: RagState): Promise<Partial<RagState>> {
  console.log('🧠 [EMBED NODE] Generating embedding...');
  
  const embedding = await generateEmbedding(state.paragraphText, state.openai);
  console.log('✅ [EMBED NODE] Embedding generated, dimensions:', embedding.length);
  
  return {
    embedding,
  };
}

/**
 * RetrieveNode - Queries ChromaDB for similar content
 */
async function retrieveNode(state: RagState): Promise<Partial<RagState>> {
  console.log('🔍 [RETRIEVE NODE] Querying ChromaDB for similar content...');
  
  const collectionName = process.env.CHROMA_COLLECTION_NAME || 'stickies_rag_v1';
  let collection = await state.chromaClient.getOrCreateCollection({ name: collectionName });

  // Debug: print collection stats and first few items
  if (typeof collection.count === 'function') {
    try {
      const total = await collection.count();
      console.log(`[RETRIEVE NODE] Collection contains ${total} vectors`);
    } catch (err) {
      console.warn('[RETRIEVE NODE] Could not count collection size:', (err as Error).message);
    }
  }

  if (typeof collection.get === 'function') {
    try {
      // Many client versions accept { limit, include }
      const previewRes: any = await collection.get({ limit: 5, include: ['metadatas', 'ids'] });
      const idsPreview = previewRes.ids?.[0] || previewRes.ids || [];
      const metaPreview = previewRes.metadatas?.[0] || previewRes.metadatas || [];
      console.log('[RETRIEVE NODE] Preview of first 5 vectors:');
      idsPreview.slice(0, 5).forEach((id: string, idx: number) => {
        const meta = metaPreview[idx] || {};
        console.log(`  ${idx + 1}. id=${id}, stickyTitle=${meta.stickyTitle || 'N/A'}, textPreview="${(meta.text || '').substring(0, 80)}"`);
      });
    } catch (err) {
      console.warn('[RETRIEVE NODE] Could not fetch preview vectors:', (err as Error).message);
    }
  }

  const k = 10;
  console.log('📊 [RETRIEVE NODE] Querying for top', k, 'similar results');
  let queryResult: any;
  try {
    queryResult = await collection.query({ queryEmbeddings: [state.embedding], nResults: k });
  } catch (error: any) {
    const msg = (error as Error).message || '';
    if (msg.includes('dimension')) {
      console.warn('⚠️  [RETRIEVE NODE] Detected embedding dimension mismatch. Re-indexing collection.');
      if (typeof state.chromaClient.deleteCollection === 'function') {
        await state.chromaClient.deleteCollection({ name: collectionName });
      }
      // Ensure chroma-indexer is available
      if (!indexStickiesFn) {
        await loadChromaIndexer();
      }
      if (indexStickiesFn) {
        console.log('🔄 [RETRIEVE NODE] Running indexStickies to rebuild collection...');
        const defaultStickiesDir =
          process.env.STICKIES_DIR ||
          path.join(homedir(), 'Library/Containers/com.apple.Stickies/Data/Library/Stickies');
        await indexStickiesFn({ client: state.chromaClient, stickiesDir: defaultStickiesDir });
        console.log('✅ [RETRIEVE NODE] Re-index completed');
        collection = await state.chromaClient.getOrCreateCollection({ name: collectionName });
        queryResult = await collection.query({ queryEmbeddings: [state.embedding], nResults: k });
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

  console.log('📋 [RETRIEVE NODE] Retrieved', ids.length, 'potential matches');
  if (distances) {
    console.log('📐 [RETRIEVE NODE] Distance range:', Math.min(...distances).toFixed(3), 'to', Math.max(...distances).toFixed(3));
  }

  // Debug: log each retrieved snippet preview before filtering
  ids.forEach((id, idx) => {
    const meta = metas[idx] || {};
    const dist = distances ? distances[idx] : 'N/A';
    const preview = (meta.text || '').substring(0, 120).replace(/\n/g, ' ');
    console.log(`🔎 [RETRIEVE NODE] Raw result ${idx + 1}: id=${id}, dist=${typeof dist === 'number' ? dist.toFixed(3) : dist}, stickyTitle=${meta.stickyTitle || 'N/A'}, preview="${preview}"`);
    console.log(`🔍 [RETRIEVE NODE] Full metadata for result ${idx + 1}:`, {
      isTitle: meta.isTitle,
      text: meta.text ? meta.text.substring(0, 100) : 'NO TEXT',
      preview: meta.preview ? meta.preview.substring(0, 100) : 'NO PREVIEW',
      stickyTitle: meta.stickyTitle || 'NO TITLE'
    });
  });

  return {
    retrievedIds: ids,
    retrievedMetas: metas,
    retrievedDistances: distances || [],
  };
}

/**
 * FilterNode - Filters results by similarity threshold and excludes current sticky
 */
async function filterNode(state: RagState): Promise<Partial<RagState>> {
  console.log('🔬 [FILTER NODE] Filtering by similarity threshold and excluding current sticky...');
  console.log('🚫 [FILTER NODE] Current file path to exclude:', state.currentFilePath);
  
  // Extract the parent directory from the current file path 
  // (e.g., /path/to/sticky.rtfd/TXT.rtf -> /path/to/sticky.rtfd)
  const currentStickyDir = state.currentFilePath ? 
    state.currentFilePath.replace(/\/TXT\.rtf$/, '') : '';
  console.log('🚫 [FILTER NODE] Current sticky directory to exclude:', currentStickyDir);
  
  const filteredSnippets: Snippet[] = [];
  for (let i = 0; i < state.retrievedIds.length; i++) {
    const similarity = state.retrievedDistances.length > 0 ? 1 / (1 + state.retrievedDistances[i]) : 0.5; // Convert distance to similarity (0-1)
    const isTitleVector = state.retrievedMetas[i]?.isTitle === true;
    const resultFilePath = state.retrievedMetas[i]?.filePath || '';
    
    // Check if this result is from the same sticky as the one being edited
    const isFromCurrentSticky = currentStickyDir && resultFilePath === currentStickyDir;
    
    console.log(`📌 [FILTER NODE] Result ${i + 1}: similarity=${similarity.toFixed(3)}, threshold=${state.similarityThreshold}, isTitle=${isTitleVector}, filePath=${resultFilePath}, isFromCurrentSticky=${isFromCurrentSticky}`);
    
    // Skip results from the current sticky
    if (isFromCurrentSticky) {
      console.log(`🚫 [FILTER NODE] Excluding result ${i + 1} - from current sticky (${resultFilePath})`);
      continue;
    }
    
    // Include if passes similarity threshold OR is a title vector
    const passesSimilarity = similarity >= state.similarityThreshold;
    const passesTitleClause = isTitleVector;
    
    if (passesSimilarity || passesTitleClause) {
      console.log(`✅ [FILTER NODE] Including result ${i + 1} (similarity: ${similarity.toFixed(3)}, isTitle: ${isTitleVector})`);
      
      // Use preview content for title vectors, regular text for paragraph chunks
      const content = isTitleVector
        ? state.retrievedMetas[i]?.preview ?? state.retrievedMetas[i]?.text
        : state.retrievedMetas[i]?.text;
      
      console.log(`📝 [FILTER NODE] Content selected for result ${i + 1}:`, {
        isTitle: isTitleVector,
        selectedContent: content ? content.substring(0, 100) : 'NO CONTENT',
        availablePreview: state.retrievedMetas[i]?.preview ? state.retrievedMetas[i].preview.substring(0, 50) : 'NO PREVIEW',
        availableText: state.retrievedMetas[i]?.text ? state.retrievedMetas[i].text.substring(0, 50) : 'NO TEXT'
      });
      
      filteredSnippets.push({
        id: state.retrievedIds[i],
        stickyTitle: state.retrievedMetas[i]?.stickyTitle || 'Unknown',
        content: content || 'No content',
        similarity: parseFloat(similarity.toFixed(3)),
        filePath: state.retrievedMetas[i]?.filePath,
      });
    } else {
      console.log(`❌ [FILTER NODE] Excluding result ${i + 1} (similarity: ${similarity.toFixed(3)} < ${state.similarityThreshold})`);
    }
  }

  console.log('📊 [FILTER NODE] Filtered results:', filteredSnippets.length, 'of', state.retrievedIds.length, 'passed threshold and are not from current sticky');

  return {
    filteredSnippets,
  };
}

/**
 * SummariseNode - Generates AI summary of the filtered snippets
 */
async function summariseNode(state: RagState): Promise<Partial<RagState>> {
  console.log('📝 [SUMMARISE NODE] Generating AI summary...');
  
  const summary = await generateSummary(state.paragraphText, state.filteredSnippets, state.userGoals, state.openai);
  console.log('✅ [SUMMARISE NODE] Summary generated, length:', summary.length, 'characters');
  console.log('📄 [SUMMARISE NODE] Summary preview:', summary.substring(0, 100) + '...');

  // Send incremental update with RAG results
  sendIncrementalUpdate({
    snippets: state.filteredSnippets,
    summary: summary,
  });

  return {
    summary,
  };
}

/**
 * WebSearchPromptGeneratorNode - Generates web search prompts based on user input
 */
async function webSearchPromptGeneratorNode(state: RagState): Promise<Partial<RagState>> {
  console.log('🔍 [WEB SEARCH NODE] Generating web search prompt...');
  
  const webSearchPrompt = await generateWebSearchPrompt(state.paragraphText, state.userGoals, state.openai);
  console.log('✅ [WEB SEARCH NODE] Web search prompt generated:', webSearchPrompt.substring(0, 100) + '...');

  // Send incremental update with web search suggestions
  sendIncrementalUpdate({
    webSearchPrompt: webSearchPrompt,
  });

  return {
    webSearchPrompt,
  };
}

/**
 * WebSearchExecutionNode - Executes actual web searches using Brave API
 */
async function webSearchExecutionNode(state: RagState): Promise<Partial<RagState>> {
  console.log('🌐 [WEB SEARCH EXECUTION NODE] Executing web searches...');
  
  if (!state.webSearchPrompt) {
    console.log('⚠️ [WEB SEARCH EXECUTION NODE] No web search prompt available');
    return { webSearchResults: [] };
  }
  
  const queries = state.webSearchPrompt
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .slice(0, 3); // Limit to 3 queries
  
  console.log('🔍 [WEB SEARCH EXECUTION NODE] Executing queries:', queries);
  
  const results: WebSearchResult[] = [];
  
  for (let i = 0; i < queries.length; i++) {
    const query = queries[i];
    console.log(`🌐 [WEB SEARCH EXECUTION NODE] Executing query ${i + 1}/${queries.length}: "${query}"`);
    
    try {
      const searchResults = await executeWebSearch(query);
      results.push(...searchResults);
      console.log(`✅ [WEB SEARCH EXECUTION NODE] Query ${i + 1} completed, got ${searchResults.length} results`);
    } catch (error) {
      console.error(`❌ [WEB SEARCH EXECUTION NODE] Query ${i + 1} failed:`, error);
    }
    
    // Add delay between queries (except for the last one)
    if (i < queries.length - 1) {
      console.log('⏱️ [WEB SEARCH EXECUTION NODE] Waiting 1.5 seconds before next query...');
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
  }
  
  console.log(`🎉 [WEB SEARCH EXECUTION NODE] Completed all searches, total results: ${results.length}`);

  // Send incremental update with web search results (before scraping)
  sendIncrementalUpdate({
    webSearchPrompt: state.webSearchPrompt,
    webSearchResults: results,
  });
  
  return {
    webSearchResults: results,
  };
}

/**
 * Execute web search using Brave API with DuckDuckGo fallback
 */
async function executeWebSearch(query: string): Promise<WebSearchResult[]> {
  console.log(`🔍 [WEB SEARCH] Attempting search for: "${query}"`);
  
  // Try Brave API first
  const braveResults = await tryBraveSearch(query);
  if (braveResults.length > 0) {
    console.log(`✅ [WEB SEARCH] Brave API successful for "${query}", got ${braveResults.length} results`);
    return braveResults;
  }
  
  // Fallback to DuckDuckGo
  console.log(`🦆 [WEB SEARCH] Falling back to DuckDuckGo for "${query}"`);
  const ddgResults = await tryDuckDuckGoSearch(query);
  if (ddgResults.length > 0) {
    console.log(`✅ [WEB SEARCH] DuckDuckGo successful for "${query}", got ${ddgResults.length} results`);
    return ddgResults;
  }
  
  console.warn(`⚠️ [WEB SEARCH] Both Brave and DuckDuckGo failed for "${query}"`);
  return [];
}

/**
 * Try Brave API search
 */
async function tryBraveSearch(query: string): Promise<WebSearchResult[]> {
  const apiKey = process.env.BRAVE_API_KEY;
  
  if (!apiKey) {
    console.log('⚠️ [BRAVE SEARCH] No Brave API key found, skipping');
    return [];
  }
  
  try {
    // Construct URL with query parameters
    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.append('q', query);
    url.searchParams.append('count', '3'); // Limit to 3 results per query
    url.searchParams.append('search_lang', 'en');
    url.searchParams.append('country', 'US');
    url.searchParams.append('safesearch', 'moderate');
    
    const searchResponse = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': apiKey,
      },
    });
    
    if (!searchResponse.ok) {
      throw new Error(`Brave API error: ${searchResponse.status} ${searchResponse.statusText}`);
    }
    
    const data = await searchResponse.json();
    
    if (!data.web || !data.web.results) {
      console.warn('⚠️ [BRAVE SEARCH] No web results in response');
      return [];
    }
    
    return data.web.results.map((result: any) => ({
      query,
      title: result.title || 'No title',
      url: result.url || '',
      description: result.description || 'No description',
    }));
    
  } catch (error) {
    console.error('❌ [BRAVE SEARCH] Search failed for query:', query, error);
    return [];
  }
}

/**
 * Try DuckDuckGo search using duck-duck-scrape
 */
async function tryDuckDuckGoSearch(query: string): Promise<WebSearchResult[]> {
  try {
    // Dynamic import to avoid compilation issues
    const DDG = await import('duck-duck-scrape');
    
    const searchResults = await DDG.search(query, {
      safeSearch: DDG.SafeSearchType.MODERATE,
      region: 'us-en',
    });
    
    if (!searchResults || searchResults.noResults || !searchResults.results) {
      console.warn('⚠️ [DUCKDUCKGO SEARCH] No results found');
      return [];
    }
    
    // Take first 3 results to match Brave API behavior
    return searchResults.results.slice(0, 3).map((result: any) => ({
      query,
      title: result.title || 'No title',
      url: result.url || '',
      description: result.description || 'No description',
    }));
    
  } catch (error) {
    console.error('❌ [DUCKDUCKGO SEARCH] Search failed for query:', query, error);
    return [];
  }
}

/**
 * OutputNode - Prepares final result
 */
async function outputNode(state: RagState): Promise<Partial<RagState>> {
  console.log('🎉 [OUTPUT NODE] Preparing final result...');
  
  const result: PipelineResult = {
    snippets: state.filteredSnippets,
    summary: state.summary,
    webSearchPrompt: state.webSearchPrompt,
    webSearchResults: state.webSearchResults,
  };

  console.log('📊 [OUTPUT NODE] Final results:');
  console.log('  - Snippets:', result.snippets.length);
  console.log('  - Summary length:', result.summary.length);
  console.log('  - Web search prompt length:', result.webSearchPrompt?.length || 0);
  console.log('  - Web search results:', result.webSearchResults?.length || 0);

  return {
    result,
  };
}

/**
 * Send incremental update to main process
 */
function sendIncrementalUpdate(partialResult: Partial<PipelineResult>) {
  console.log('📤 [WORKER] Sending incremental update:', {
    hasSnippets: !!partialResult.snippets,
    snippetCount: partialResult.snippets?.length || 0,
    hasSummary: !!partialResult.summary,
    summaryLength: partialResult.summary?.length || 0,
    hasWebSearchPrompt: !!partialResult.webSearchPrompt,
    webSearchPromptLength: partialResult.webSearchPrompt?.length || 0,
    hasWebSearchResults: !!partialResult.webSearchResults,
    webSearchResultsCount: partialResult.webSearchResults?.length || 0,
  });
  
  if (process.send) {
    process.send({ 
      type: 'incremental-update', 
      partialResult 
    });
    console.log('✅ [WORKER] Incremental update sent to main process');
  } else {
    console.warn('⚠️ [WORKER] process.send is not available, cannot send incremental update');
  }
}

/**
 * Generate embedding for text using OpenAI or fallback
 */
async function generateEmbedding(text: string, openai: OpenAI): Promise<number[]> {
  // Use OpenAI if we have an API key OR if we're in test mode with a mocked instance
  const shouldUseOpenAI = process.env.OPENAI_API_KEY || process.env.NODE_ENV === 'test';
  
  if (shouldUseOpenAI) {
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
async function generateSummary(paragraph: string, snippets: Snippet[], userGoals: string, openai: OpenAI): Promise<string> {
  // Use OpenAI if we have an API key OR if we're in test mode with a mocked instance
  const shouldUseOpenAI = process.env.OPENAI_API_KEY || process.env.NODE_ENV === 'test';
  
  if (shouldUseOpenAI) {
    try {
      const contextText = snippets.map(s => `- ${s.stickyTitle}: ${s.content}`).join('\n');

      
      const prompt = `You are an assistant in a Mac desktop application. The user is typing in a sticky note. Relevant snippets from their old Sticky notes are being retrieved via RAG and shown to them. You will be summarizing the snippets, starting with the information most valuable to the specific subproblem they are currently solving or the specific subtopic they are currently reflecting on. Omit information that is not related to what the user is currently typing.

      In your summary, do not mention any quotes that might contain sensitive information or curse words or embarrassing personal information because this technology will be shown in a tech demo.
      
      For example, if the user is brainstorming app ideas, the most valuable information that your response must start with is SPECIFIC app ideas that they have written. Another example: If the user is writing 'What kind of song should I make?' then you should be specifically reminding them of old songs ideas they wanted to make in the past. Not sharing unrelated tips and tricks. Specifically address EXACTLY what they're thinking about. Extract ONLY the most useful information from the retrieved snippets and OMIT EVERYTHING ELSE. Put the MOST VALUABLE INFORMATION at the top of your response. This is what the user is currently typing and thinking about:\n\n"${paragraph}"

      When you suggest information that is relevant to what the user has typed, keep in mind that they have entered these personal goals for themselves below:
      ${userGoals.trim()}
      
      
      \n\nThese are the relevant snippets to summarize, retrieved from their old Sticky notes, that are related to what they are currently typing and thinking about: \n${contextText}
      
      \n\nNow summarize the content of the retrieved Stickies in a way that concisely gives them the valuable related information that might help them solve their current problems, help them achieve their overaching personal goals, and assist them in their thought process. Your summary should include specific quotes from the retrieved snippets and should include specific details. Avoid fluff language. If you have nothing useful to say, then be honest that the retrieved snippets might not be relevant. In your response, do not begin with a preface. Go straight into providing the user helpful information related to whatever they're thinking about, formatted with a short title (2-5 words) that summarizes how you interpreted what the user might be looking for, and explicitly references the fact that you are summarizing information from their Sticky notes. 
      
      Your response should be in plain text, do not use markdown. Instead of bullet points, use single dashes "-". Do not add a conclusion line at the end of your response. Do not add fluff on each summary item, just give the related quote `;
      
      const response = await openai.chat.completions.create({
        model: 'gpt-4.1-2025-04-14',
        max_tokens: 512,
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

/**
 * Generate web search prompt using OpenAI or fallback
 */
async function generateWebSearchPrompt(paragraph: string, userGoals: string, openai: OpenAI): Promise<string> {
  // Use OpenAI if we have an API key OR if we're in test mode with a mocked instance
  const shouldUseOpenAI = process.env.OPENAI_API_KEY || process.env.NODE_ENV === 'test';
  
  if (shouldUseOpenAI) {
    try {
      const prompt = `Your task is to suggest informative clever creative rebellious think-outside-the-box web searches that help the user in whatever they're currently typing and thinking about. Your suggestions might explore tangents related to what they're brainstorming in a way that can help inspire them with new ideas or give them information that might benefit them. Your queries will be automatically executed and the results will be shown to the user, helping their brainstorm process.
      Return 3 specific, targeted web search queries.

      All of your web search suggestions should be DIRECTLY relevant to what the user is currently typing.
      Here's what the user is currently typing and thinking about: "${paragraph}"

      And here's the user's larger personal goals, which may or may not be relevant to what they're currently typing. They might inform the ideas you come up with. User goals:
      "${userGoals}"
      
      Reply only with the web searches, no other text. Use single dashes "-", not bullet points nor numbers.
      Use plain text, no markdown.
      Example format:
      - insane mobile apps 2025
      - highest selling iphone apps 2025
      - how to come up with SaaS app ideas?

      The focus of your web searches should be to gather unique information that could help spark the user's creativity based on what he's currently typing. If you can come up with web searches related to both the current thought and some overarching personal goal, that's a bonus, but don't stretch it. Sometimes you'll need to ignore the personal goals and just focus on what the user is currently typing as the source of inspiration. Return 3 web search options. All of your web search suggestions should be DIRECTLY relevant to what he's currently typing.
      Don't search for stupid vague things like "app ideas nobody has thought of yet", because obviously,
      tautologically, that's not gonna return useful information. DUHHHH. So instead, come up with clever ideas that complement what the user has typed and would be immediately useful to him in the moment.
      `;
      
      const response = await openai.chat.completions.create({
        model: 'gpt-4.1-2025-04-14',
        max_tokens: 600,
        messages: [
          { role: 'system', content: 'You are a helpful assistant that generates targeted web search queries.' },
          { role: 'user', content: prompt },
        ],
      });
      
      return response.choices[0].message.content || 'No web search suggestions generated.';
    } catch (error) {
      console.warn('🔄 [WORKER] OpenAI web search prompt generation failed, using fallback:', error);
    }
  }
  
  // Fallback web search prompt
  console.log('🔄 [WORKER] Using fallback web search prompt generation');
  const goalsNote = userGoals.trim() ? `\n\nNote: Consider your goals: ${userGoals.substring(0, 100)}${userGoals.length > 100 ? '...' : ''}` : '';
  
  return `Search suggestions based on: "${paragraph.substring(0, 50)}${paragraph.length > 50 ? '...' : ''}"${goalsNote}

Try searching for:
- ${paragraph.split(' ').slice(0, 3).join(' ')} tutorial
- ${paragraph.split(' ').slice(0, 3).join(' ')} best practices
- ${paragraph.split(' ').slice(0, 3).join(' ')} examples
- ${paragraph.split(' ').slice(0, 3).join(' ')} guide 2024`;
}

/**
 * WebScrapingNode - Scrapes content from selected web search result URLs
 */
async function webScrapingNode(state: RagState): Promise<Partial<RagState>> {
  console.log('🕷️ [WEB SCRAPING NODE] Starting web page scraping...');
  
  if (!state.webSearchResults || state.webSearchResults.length === 0) {
    console.log('⚠️ [WEB SCRAPING NODE] No web search results to scrape');
    return { webSearchResults: [] };
  }
  
  const selectedResults = state.webSearchResults.filter(result => result.selectedForScraping);
  console.log(`🌐 [WEB SCRAPING NODE] Scraping ${selectedResults.length} selected web pages...`);
  
  const scrapedResults: WebSearchResult[] = [];
  
  for (let i = 0; i < state.webSearchResults.length; i++) {
    const result = state.webSearchResults[i];
    
    if (result.selectedForScraping) {
      console.log(`🕷️ [WEB SCRAPING NODE] Scraping selected page: ${result.url}`);
      
      try {
        const scrapedContent = await scrapeWebPage(result.url);
        scrapedResults.push({
          ...result,
          scrapedContent,
        });
        console.log(`✅ [WEB SCRAPING NODE] Successfully scraped ${result.url}, content length: ${scrapedContent.length} chars`);
      } catch (error) {
        console.error(`❌ [WEB SCRAPING NODE] Failed to scrape ${result.url}:`, error);
        scrapedResults.push({
          ...result,
          scrapingError: error instanceof Error ? error.message : 'Unknown scraping error',
        });
      }
      
      // Add small delay between scraping requests to be respectful
      if (i < selectedResults.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } else {
      // Keep non-selected results as-is (without scraping)
      scrapedResults.push(result);
    }
  }
  
  console.log(`🎉 [WEB SCRAPING NODE] Completed scraping, ${scrapedResults.filter(r => r.scrapedContent).length} successful`);
  
  return {
    webSearchResults: scrapedResults,
  };
}

/**
 * Scrape web page content using axios and cheerio, convert to readable text
 */
async function scrapeWebPage(url: string): Promise<string> {
  try {
    // Dynamic imports to avoid compilation issues
    const axios = await import('axios');
    const cheerio = await import('cheerio');
    const { convert } = await import('html-to-text');
    
    // Fetch the HTML content
    const response = await axios.default.get(url, {
      timeout: 10000, // 10 second timeout
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
      },
      maxRedirects: 5,
    });
    
    if (!response.data) {
      throw new Error('No content received');
    }
    
    // Load HTML into cheerio
    const $ = cheerio.load(response.data);
    
    // Remove script and style elements
    $('script, style, nav, header, footer, aside, .ad, .advertisement, .social-share').remove();
    
    // Get the main content - try common content selectors
    let contentHtml = '';
    const contentSelectors = [
      'main',
      'article', 
      '[role="main"]',
      '.content',
      '.main-content',
      '.post-content',
      '.entry-content',
      '#content',
      '#main',
      'body'
    ];
    
    for (const selector of contentSelectors) {
      const element = $(selector);
      if (element.length > 0) {
        contentHtml = element.html() || '';
        break;
      }
    }
    
    if (!contentHtml) {
      contentHtml = $('body').html() || '';
    }
    
    // Convert HTML to readable text
    const textContent = convert(contentHtml, {
      wordwrap: false,
      selectors: [
        { selector: 'h1', options: { uppercase: false } },
        { selector: 'h2', options: { uppercase: false } },
        { selector: 'h3', options: { uppercase: false } },
        { selector: 'a', options: { ignoreHref: true } },
        { selector: 'img', format: 'skip' },
      ],
    });
    
    // Clean up the text
    const cleanedText = textContent
      .replace(/\n{3,}/g, '\n\n') // Remove excessive newlines
      .replace(/\t+/g, ' ') // Replace tabs with spaces
      .replace(/ {2,}/g, ' ') // Replace multiple spaces with single space
      .trim();
    
    // Limit content length to prevent overwhelming the system
    const maxLength = 3000;
    if (cleanedText.length > maxLength) {
      return cleanedText.substring(0, maxLength) + '... [content truncated]';
    }
    
    return cleanedText;
    
  } catch (error) {
    console.error(`❌ [WEB SCRAPING] Failed to scrape ${url}:`, error);
    throw error;
  }
}

/**
 * WebPageSummarizationNode - Summarizes each scraped web page individually
 */
async function webPageSummarizationNode(state: RagState): Promise<Partial<RagState>> {
  console.log('📄 [WEB PAGE SUMMARIZATION NODE] Starting individual page summarization...');
  
  if (!state.webSearchResults || state.webSearchResults.length === 0) {
    console.log('⚠️ [WEB PAGE SUMMARIZATION NODE] No web search results to summarize');
    return { webSearchResults: [] };
  }
  
  const selectedResults = state.webSearchResults.filter(result => 
    result.scrapedContent && result.selectedForScraping
  );
  console.log(`📄 [WEB PAGE SUMMARIZATION NODE] Summarizing ${selectedResults.length} selected pages...`);
  
  const summarizedResults: WebSearchResult[] = [];
  
  for (let i = 0; i < state.webSearchResults.length; i++) {
    const result = state.webSearchResults[i];
    
    if (result.scrapedContent && result.selectedForScraping) {
      console.log(`📄 [WEB PAGE SUMMARIZATION NODE] Summarizing selected page: ${result.title}`);
      
      try {
        const summary = await generateWebPageSummary(
          result.scrapedContent,
          result.title,
          result.url,
          state.paragraphText,
          state.userGoals,
          state.openai
        );
        
        summarizedResults.push({
          ...result,
          pageSummary: summary,
        });
        
        console.log(`✅ [WEB PAGE SUMMARIZATION NODE] Summary generated for ${result.title}, length: ${summary.length} chars`);
      } catch (error) {
        console.error(`❌ [WEB PAGE SUMMARIZATION NODE] Failed to summarize ${result.title}:`, error);
        summarizedResults.push({
          ...result,
          summarizationError: error instanceof Error ? error.message : 'Unknown summarization error',
        });
      }
    } else {
      // Keep results that weren't selected for summarization as-is
      summarizedResults.push(result);
    }
  }
  
  console.log(`🎉 [WEB PAGE SUMMARIZATION NODE] Completed summarization, ${summarizedResults.filter(r => r.pageSummary).length} successful`);
  
  // Send incremental update with summarized results
  sendIncrementalUpdate({
    webSearchPrompt: state.webSearchPrompt,
    webSearchResults: summarizedResults,
  });
  
  return {
    webSearchResults: summarizedResults,
  };
}

/**
 * StickyBrainSynthesisNode - Generates a focused one-sentence synthesis combining RAG and web research
 */
async function stickyBrainSynthesisNode(state: RagState): Promise<Partial<RagState>> {
  console.log('🧠 [STICKY BRAIN SYNTHESIS NODE] Generating focused synthesis...');
  
  // Combine web research summaries into a single string
  const webResearchSummary = state.webSearchResults
    ?.filter(result => result.pageSummary)
    .map(result => result.pageSummary)
    .join(' ') || '';
  
  if (!state.summary && !webResearchSummary) {
    console.log('⚠️ [STICKY BRAIN SYNTHESIS NODE] No summaries available for synthesis');
    return { stickyBrainSynthesis: 'No information available for synthesis.' };
  }
  
  console.log('🧠 [STICKY BRAIN SYNTHESIS NODE] Synthesizing from:');
  console.log('  - RAG summary length:', state.summary.length);
  console.log('  - Web research summary length:', webResearchSummary.length);
  
  try {
    const synthesis = await generateStickyBrainSynthesis(
      state.paragraphText,
      state.summary,
      webResearchSummary,
      state.userGoals,
      state.openai
    );
    
    console.log('✅ [STICKY BRAIN SYNTHESIS NODE] Synthesis generated:', synthesis);
    
    // Send incremental update with synthesis
    sendIncrementalUpdate({
      stickyBrainSynthesis: synthesis,
    });
    
    return {
      stickyBrainSynthesis: synthesis,
    };
  } catch (error) {
    console.error('❌ [STICKY BRAIN SYNTHESIS NODE] Failed to generate synthesis:', error);
    return {
      stickyBrainSynthesis: 'Failed to generate synthesis.',
    };
  }
}

/**
 * Generate web page summary using OpenAI or fallback
 */
async function generateWebPageSummary(
  scrapedContent: string, 
  pageTitle: string, 
  pageUrl: string,
  userParagraph: string,
  userGoals: string, 
  openai: OpenAI
): Promise<string> {
  // Use OpenAI if we have an API key OR if we're in test mode with a mocked instance
  const shouldUseOpenAI = process.env.OPENAI_API_KEY || process.env.NODE_ENV === 'test';
  
  if (shouldUseOpenAI) {
    try {
      const prompt = `You are an AI assistant helping a user brainstorm ideas and obtain information related to what they're currently typing and thinking about. You will see what is on the user's mind, then you will see the contents of a web page, and you will extract ONLY the information from that webpage that might be DIRECTLY relevant to what the user is currently thinking about, in a way that helps them achieve their stated personal goals.
      
      Here is what the user most recently typed and thought about: "${userParagraph}"

    Here are the user's stated personal goals:
    ${userGoals.trim()}

    You will be given the content of this webpage: "${pageTitle}" (${pageUrl}).
    Focus on information most relevant to what the user is currently thinking about.
    Use plain text format, no markdown or special formatting. Keep in mind the user's stated personal goals as far as which information you choose to extract. Write with concise language, DO NOT BE VERBOSE, be EXTREMELY succinct. Every token counts. Instead of saying "The page suggests x" or "The guide emphasizes x" in your summaries, say "One suggestion provided is x" or "One idea is x".

    Here is the full text content from the web page:
    ${scrapedContent}`;
      
      const response = await openai.chat.completions.create({
        model: 'gpt-4.1-2025-04-14',
        max_tokens: 150,
        messages: [
          { role: 'system', content: 'You are a research assistant that creates concise 3-sentence summaries with quotations.' },
          { role: 'user', content: prompt },
        ],
      });
      
      return response.choices[0].message.content || 'Summary generation failed.';
    } catch (error) {
      console.warn('🔄 [WORKER] OpenAI web page summarization failed, using fallback:', error);
    }
  }
  
  // Fallback summary
  console.log('🔄 [WORKER] Using fallback web page summary generation');
  return `This page titled "${pageTitle}" contains ${scrapedContent.length} characters of content. The page was automatically selected for summarization based on its relevance to your current work. A detailed summary is not available due to API limitations.`;
}

/**
 * Generates a focused one-sentence synthesis using GPT-4o-mini
 * @param userInput - The user's current input paragraph
 * @param ragSummary - Summary from related snippets
 * @param webResearchSummary - Combined web research summaries
 * @param userGoals - The user's goals
 * @param openai - OpenAI client instance
 * @returns A single sentence with the most useful information
 */
async function generateStickyBrainSynthesis(
  userInput: string,
  ragSummary: string,
  webResearchSummary: string,
  userGoals: string,
  openai?: OpenAI
): Promise<string> {
  if (!openai) {
    return 'OpenAI client not available for synthesis';
  }

  const prompt = `You are StickyBrain, an AI assistant that extracts critical details from text so that important specific bits of information are extracted and served to the user. You're not writing summaries -- you're extracting the most relevant concrete bit of information that will be relevant to the user.
  The user is currently brainstorming something -- they're in the middle of typing. Here's what they're currently typing: "${userInput}"

  Your task will be to extract the information from the below sources that will be MOST IMMEDIATELY USEFUL
  to the user, based on what you have seen they are currently thinking about. We don't want verbose bullshit.
  We don't want fluff. We don't want vague LLM babble. We just want a tiny bit of EXTREMELY RELEVANT
  INFORMATION that will benefit the user. For example, if the user typed "I'm hungry but I'm not sure what to eat..." and in their old writings they wrote "grocery list // foods i tend to eat: bananas, 3 apples, grapes, 1 sweet potato, celery, dole fruit cups, milk, frozen food, aim healthy, aim chicken" then you should literally just reply with "In your old writings you mention that you like bananas, apples, grapes, sweet potatoes, celery, and chicken." That is an example of an extremely useful and concise sentence. Prefer the user's old writings over web search results whenever possible. Your reply should be extremely, extremely relevant to what the user has most recently typed, which once again is: "${userInput}"
  Remember, the user's old writings may be from a very long time ago, so keep that in mind. If the user is currently thinking about an unnamed app for example, and their old writings also mention that they're working on an app, don't assume that these are the same app. Their old writings are old.

  Below are the two sources you will be extracting information from.
  1) Summary from User's Old Writings:
  "${ragSummary}"

  2) Summary of Web Research Performed on behalf of the user:
  "${webResearchSummary}"
  
  Now please reply with your one concise sentence that delivers USEFUL CONCRETE INFORMATION.
  No fluff. No bs. CONCRETE AND RELEVANT INFORMATION. INFORMATION. INFORMATION. Quote directly
  from the sources if necessary, but don't use quotation marks. INCLUDE USEFUL INFORMATION.
  `;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4.1-2025-04-14',
      messages: [
        { role: 'system', content: 'You are StickyBrain, an AI that synthesizes information to help users with their current writing.' },
        { role: 'user', content: prompt }
      ],
      temperature: 0.2,
      max_tokens: 100,
    });

    const synthesis = response.choices[0]?.message?.content?.trim() || 'Failed to generate synthesis';
    console.log(`🧠 [generateStickyBrainSynthesis] Generated synthesis: ${synthesis}`);
    return synthesis;
  } catch (error) {
    console.error('❌ [generateStickyBrainSynthesis] Error:', error);
    return `Failed to generate synthesis: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}

/**
 * WebPageSelectionNode - Selects the most valuable pages to scrape and summarize
 */
async function webPageSelectionNode(state: RagState): Promise<Partial<RagState>> {
  console.log('🎯 [WEB PAGE SELECTION NODE] Selecting most valuable pages to scrape...');
  
  if (!state.webSearchResults || state.webSearchResults.length === 0) {
    console.log('⚠️ [WEB PAGE SELECTION NODE] No web search results to select from');
    return { webSearchResults: [] };
  }
  
  console.log(`🎯 [WEB PAGE SELECTION NODE] Selecting from ${state.webSearchResults.length} search results...`);
  
  if (state.webSearchResults.length <= 2) {
    console.log('🎯 [WEB PAGE SELECTION NODE] 2 or fewer pages available, selecting all');
    const updatedResults = state.webSearchResults.map(result => ({
      ...result,
      selectedForScraping: true,
    }));
    return { webSearchResults: updatedResults };
  }
  
  try {
    const selectedUrls = await selectMostValuablePages(
      state.webSearchResults,
      state.paragraphText,
      state.userGoals,
      state.openai
    );
    
    // Mark selected pages for scraping
    const updatedResults = state.webSearchResults.map(result => ({
      ...result,
      selectedForScraping: selectedUrls.includes(result.url),
    }));
    
    console.log(`✅ [WEB PAGE SELECTION NODE] Selected ${selectedUrls.length} pages for scraping:`, selectedUrls);
    
    return {
      webSearchResults: updatedResults,
    };
  } catch (error) {
    console.error('❌ [WEB PAGE SELECTION NODE] Failed to select pages:', error);
    // Fallback: select first 2 pages
    const updatedResults = state.webSearchResults.map((result, index) => ({
      ...result,
      selectedForScraping: index < 2,
    }));
    
    return {
      webSearchResults: updatedResults,
    };
  }
}

/**
 * Select most valuable pages for summarization using OpenAI
 */
async function selectMostValuablePages(
  results: WebSearchResult[],
  userParagraph: string,
  userGoals: string,
  openai: OpenAI
): Promise<string[]> {
  // Use OpenAI if we have an API key OR if we're in test mode with a mocked instance
  const shouldUseOpenAI = process.env.OPENAI_API_KEY || process.env.NODE_ENV === 'test';
  
  if (shouldUseOpenAI) {
    try {
      // Create a list of pages with titles and URLs
      const pageList = results.map((result, index) => 
        `${index + 1}. "${result.title}" - ${result.url}`
      ).join('\n');

      const prompt = `You are helping a user research information for what they're currently writing. The user is working on: "${userParagraph}"

The user has these personal goals:
${userGoals.trim()}

Below are web search results with page titles and URLs. Your task is to select exactly 2 pages that would be MOST VALUABLE to read and summarize for the user, considering:
1. What they're currently writing about
2. Their personal goals
3. Which pages are likely to contain the most relevant and actionable information

Available pages:
${pageList}

Instructions:
- Choose exactly 2 URLs that would be most helpful
- Focus on pages that are likely to have detailed, actionable content
- Avoid duplicate or very similar content
- Prioritize authoritative sources when possible

Respond with only the 2 URLs you selected, one per line, like this:
https://example1.com
https://example2.com`;
      
      const response = await openai.chat.completions.create({
        model: 'gpt-4.1-2025-04-14',
        max_tokens: 200,
        messages: [
          { role: 'system', content: 'You are a research assistant that selects the most valuable web pages to read.' },
          { role: 'user', content: prompt },
        ],
      });
      
      const responseText = response.choices[0].message.content || '';
      
      // Extract URLs from the response
      const selectedUrls = responseText
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.startsWith('http'))
        .slice(0, 2); // Ensure we only get 2 URLs
      
      console.log('🎯 [PAGE SELECTION] GPT-4.1 selected URLs:', selectedUrls);
      
      if (selectedUrls.length === 0) {
        throw new Error('No valid URLs selected by GPT-4.1');
      }
      
      return selectedUrls;
    } catch (error) {
      console.warn('🔄 [PAGE SELECTION] OpenAI page selection failed, using fallback:', error);
    }
  }
  
  // Fallback: select first 2 pages
  console.log('🔄 [PAGE SELECTION] Using fallback page selection');
  return results.slice(0, 2).map(r => r.url);
}

/**
 * Main RAG pipeline using LangGraph StateGraph
 */
export async function runRagPipeline(paragraph: string, options?: {
  openai?: OpenAI;
  chromaClient?: any;
  similarityThreshold?: number;
  currentFilePath?: string;
  userGoals?: string;
}): Promise<PipelineResult> {
  console.log('🚀 [WORKER] Starting LangGraph RAG pipeline');
  
  const openai = options?.openai || new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const chromaClient = options?.chromaClient || (await getChromaClient({}));
  const similarityThreshold = options?.similarityThreshold ?? 0.3;
  const currentFilePath = options?.currentFilePath || '';
  const userGoals = options?.userGoals || '';

  console.log('🔧 [WORKER] Configuration:');
  console.log('  - OpenAI available:', !!openai);
  console.log('  - ChromaDB client type:', chromaClient.constructor.name);
  console.log('  - Similarity threshold:', similarityThreshold);
  console.log('  - Current file path:', currentFilePath);
  console.log('  - User goals:', userGoals);

  // Initialize state
  let state: RagState = {
    paragraphText: paragraph,
    currentFilePath,
    userGoals,
    openai,
    chromaClient,
    similarityThreshold,
    embedding: [],
    retrievedIds: [],
    retrievedMetas: [],
    retrievedDistances: [],
    filteredSnippets: [],
    summary: '',
    stickyBrainSynthesis: '',
    result: { snippets: [], summary: '' },
    webSearchPrompt: '',
    webSearchResults: [],
  };

  console.log('🔄 [WORKER] Executing RAG path first...');
  
  // Execute RAG path manually and send incremental updates immediately
  try {
    // Input node
    const inputResult = await inputNode(state);
    state = { ...state, ...inputResult };
    
    // Embed node
    const embedResult = await embedNode(state);
    state = { ...state, ...embedResult };
    
    // Retrieve node
    const retrieveResult = await retrieveNode(state);
    state = { ...state, ...retrieveResult };
    
    // Filter node
    const filterResult = await filterNode(state);
    state = { ...state, ...filterResult };
    
    // Summarise node (this will send incremental update)
    const summariseResult = await summariseNode(state);
    state = { ...state, ...summariseResult };
    
    console.log('✅ [WORKER] RAG path completed, incremental update sent');
  } catch (error) {
    console.error('❌ [WORKER] RAG path failed:', error);
  }

  console.log('🔄 [WORKER] Executing web search path in parallel...');
  
  // Execute web search path separately (this will also send incremental updates)
  try {
    // Web search prompt generation (parallel to RAG)
    const webSearchGenResult = await webSearchPromptGeneratorNode(state);
    state = { ...state, ...webSearchGenResult };
    
    // Web search execution
    const webSearchExecResult = await webSearchExecutionNode(state);
    state = { ...state, ...webSearchExecResult };
    
    // Web page selection (choose 2 most valuable pages)
    const webPageSelectionResult = await webPageSelectionNode(state);
    state = { ...state, ...webPageSelectionResult };
    
    // Web scraping (only for selected pages)
    const webScrapingResult = await webScrapingNode(state);
    state = { ...state, ...webScrapingResult };
    
    // Web page summarization (only for selected pages)
    const webPageSummarizationResult = await webPageSummarizationNode(state);
    state = { ...state, ...webPageSummarizationResult };
    
    console.log('✅ [WORKER] Web search path completed');
  } catch (error) {
    console.error('❌ [WORKER] Web search path failed:', error);
  }

  console.log('🔄 [WORKER] Executing StickyBrain synthesis...');
  
  // Execute synthesis after both RAG and web search paths are complete
  try {
    const synthesisResult = await stickyBrainSynthesisNode(state);
    state = { ...state, ...synthesisResult };
    
    console.log('✅ [WORKER] StickyBrain synthesis completed');
  } catch (error) {
    console.error('❌ [WORKER] StickyBrain synthesis failed:', error);
  }

  // Prepare final result
  const result: PipelineResult = {
    snippets: state.filteredSnippets,
    summary: state.summary,
    webSearchPrompt: state.webSearchPrompt,
    webSearchResults: state.webSearchResults,
    stickyBrainSynthesis: state.stickyBrainSynthesis,
  };

  console.log('🎉 [WORKER] LangGraph RAG pipeline completed successfully!');
  
  return result;
}

// Worker process mode
if (process.argv.includes('--child')) {
  console.log('🔧 [WORKER] Starting in child process mode');
  console.log('🆔 [WORKER] Process PID:', process.pid);

  process.on('message', async (msg: any) => {
    if (msg?.type === 'run') {
      console.log('📨 [WORKER] Received run message');
      console.log('📁 [WORKER] Current file path from message:', msg.currentFilePath);
      try {
        const result = await runRagPipeline(msg.paragraph, {
          currentFilePath: msg.currentFilePath,
          userGoals: msg.userGoals
        });
        process.send?.({ type: 'result', result });
      } catch (error) {
        console.error('❌ [WORKER] Error processing paragraph:', error);
        process.send?.({ type: 'error', error: (error as Error).message });
      }
    }
  });

  console.log('👂 [WORKER] Listening for messages from main process...');
}