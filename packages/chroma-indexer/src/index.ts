#!/usr/bin/env node

/**
 * Chroma Indexer CLI
 * Indexes Stickies into ChromaDB with paragraph-level chunking
 */

import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

/**
 * Extracts plain text from RTFD files by reading TXT.rtf and stripping RTF tags
 * @param rtfdPath Path to the .rtfd bundle
 * @returns Plain text content
 */
export function extractTextFromRtfd(rtfdPath: string): string {
  // TODO: Implement RTF text extraction
  console.log(`Extracting text from ${rtfdPath}`);
  return '';
}

/**
 * Splits text into paragraphs on double newlines
 * @param text Input text
 * @returns Array of paragraph strings
 */
export function splitIntoParagraphs(text: string): string[] {
  return text.split('\n\n').filter(p => p.trim().length > 0);
}

/**
 * Main CLI function
 */
async function main() {
  console.log('StickyRAG Indexer CLI');
  console.log('TODO: Implement indexing functionality');
  
  // Default Stickies directory
  const stickiesDir = process.argv[2] || 
    `${process.env.HOME}/Library/Containers/com.apple.Stickies/Data/Library/Stickies`;
  
  console.log(`Indexing Stickies from: ${stickiesDir}`);
}

// Run CLI if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
} 