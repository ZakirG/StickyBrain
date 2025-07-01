import { test, expect, vi } from 'vitest';
import { runRagPipeline } from '../packages/langgraph-worker/src/index';
import { InMemoryChromaClient } from '../packages/chroma-indexer/src/index';
import OpenAI from 'openai';

test('RAG pipeline with mocked OpenAI and in-memory Chroma', async () => {
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
          choices: [{ message: { content: 'Mock summary.' } }],
        }),
      },
    },
  } as unknown as OpenAI;

  // Create in-memory Chroma client and insert test data
  const chromaClient = new InMemoryChromaClient();
  const collection = await chromaClient.getOrCreateCollection({ name: 'stickies_rag_v1' });

  // Insert two fake embeddings with high similarity to mock query
  await collection.upsert({
    ids: ['test1', 'test2'],
    embeddings: [
      [0.1, 0.2, 0.3, 0.4, 0.5], // exact match
      [0.15, 0.25, 0.35, 0.45, 0.55], // similar
    ],
    metadatas: [
      { stickyTitle: 'Test Note 1', text: 'First test content', filePath: '/test1.rtfd' },
      { stickyTitle: 'Test Note 2', text: 'Second test content', filePath: '/test2.rtfd' },
    ],
  });

  // Run pipeline
  const result = await runRagPipeline('test paragraph', {
    openai: mockOpenAI,
    chromaClient,
    similarityThreshold: 0.75,
  });

  // Assertions
  expect(result.snippets.length).toBe(2);
  expect(result.summary.split('.').length - 1).toBeLessThanOrEqual(3);
  expect(result.summary).toBe('Mock summary.');

  // Verify snippets structure
  expect(result.snippets[0]).toMatchObject({
    id: expect.any(String),
    stickyTitle: expect.any(String),
    content: expect.any(String),
    similarity: expect.any(Number),
  });

  // Verify OpenAI was called
  expect(mockOpenAI.embeddings.create).toHaveBeenCalledWith({
    model: 'text-embedding-3-small',
    input: 'test paragraph',
  });

  expect(mockOpenAI.chat.completions.create).toHaveBeenCalledWith(
    expect.objectContaining({
      model: 'gpt-4o-mini',
      max_tokens: 150,
    })
  );
}); 