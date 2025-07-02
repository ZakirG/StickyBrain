import { test, expect, vi } from 'vitest';
import { runRagPipeline } from '../packages/langgraph-worker/src/index';
import { InMemoryChromaClient } from '../packages/chroma-indexer/src/index';
import OpenAI from 'openai';

test('RAG pipeline with mocked OpenAI and in-memory Chroma using LangGraph', async () => {
  // Mock OpenAI
  const mockOpenAI = {
    embeddings: {
      create: vi.fn().mockResolvedValue({
        data: [{ embedding: [0.1, 0.2, 0.3, 0.4, 0.5] }],
      }),
    },
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          choices: [{ message: { content: 'Mock summary from LangGraph nodes.' } }],
        }),
      },
    },
  } as unknown as OpenAI;

  // Create in-memory Chroma client and insert test data
  const chromaClient = new InMemoryChromaClient();
  const collection = await chromaClient.getOrCreateCollection({ name: 'stickies_rag_v1' });

  // Insert test embeddings including title vectors
  await collection.upsert({
    ids: ['test1', 'test2', 'app_ideas_title'],
    embeddings: [
      [0.1, 0.2, 0.3, 0.4, 0.5], // exact match
      [0.15, 0.25, 0.35, 0.45, 0.55], // similar
      [0.12, 0.22, 0.32, 0.42, 0.52], // title vector - very similar to query
    ],
    metadatas: [
      { stickyTitle: 'Test Note 1', text: 'First test content', filePath: '/test1.rtfd' },
      { stickyTitle: 'Test Note 2', text: 'Second test content', filePath: '/test2.rtfd' },
      { 
        stickyTitle: 'App Ideas', 
        text: 'App Ideas (title)', 
        isTitle: true,
        preview: 'Social media app for pet owners. A marketplace for local services. Fitness tracking app with AI coaching.',
        filePath: '/app_ideas.rtfd' 
      },
    ],
  });

  // Run LangGraph pipeline
  const result = await runRagPipeline('test paragraph', {
    openai: mockOpenAI,
    chromaClient,
    similarityThreshold: 0.75,
  });

  // Assertions
  expect(result.snippets.length).toBe(3); // Now expecting 3 results including title vector
  expect(result.summary.split('.').length - 1).toBeLessThanOrEqual(3);
  expect(result.summary).toBe('Mock summary from LangGraph nodes.');

  // Verify that title vector is included
  const titleSnippet = result.snippets.find(s => s.id === 'app_ideas_title');
  expect(titleSnippet).toBeDefined();
  expect(titleSnippet?.content).toContain('Social media app for pet owners');

  // Verify snippets structure
  expect(result.snippets[0]).toMatchObject({
    id: expect.any(String),
    stickyTitle: expect.any(String),
    content: expect.any(String),
    similarity: expect.any(Number),
  });

  // Verify that OpenAI embedding was called
  expect(mockOpenAI.embeddings.create).toHaveBeenCalledWith({
    model: 'text-embedding-3-small',
    input: 'test paragraph',
  });

  // Verify that OpenAI chat completion was called for summarization
  expect(mockOpenAI.chat.completions.create).toHaveBeenCalledWith({
    model: 'gpt-4.1-2025-04-14',
    max_tokens: 512,
    messages: expect.arrayContaining([
      { role: 'system', content: 'You are a concise assistant that summarizes text.' },
      { role: 'user', content: expect.stringContaining('test paragraph') },
    ]),
  });

  console.log('✅ LangGraph RAG pipeline test passed!');
  console.log('📊 Results:', { 
    snippetsCount: result.snippets.length, 
    summaryLength: result.summary.length 
  });
}); 