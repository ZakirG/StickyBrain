#!/usr/bin/env node

/**
 * Test script to simulate editing a Stickies file and trigger the RAG pipeline
 * This helps verify that Prompt 5 functionality is working end-to-end
 */

const fs = require('fs');
const path = require('path');

const testStickiesDir = path.join(__dirname, 'test-stickies');
const testStickyPath = path.join(testStickiesDir, 'TEST-RAG-DEMO.rtfd');
const testTxtPath = path.join(testStickyPath, 'TXT.rtf');

// Ensure test directory structure exists
if (!fs.existsSync(testStickyPath)) {
  fs.mkdirSync(testStickyPath, { recursive: true });
}

// Sample RTF content with different test scenarios
const testScenarios = [
  {
    name: "Simple Question",
    content: `{\\rtf1\\ansi\\deff0 {\\fonttbl {\\f0 Times New Roman;}}\\f0\\fs24 What is the meaning of life?}`,
  },
  {
    name: "Technical Query", 
    content: `{\\rtf1\\ansi\\deff0 {\\fonttbl {\\f0 Times New Roman;}}\\f0\\fs24 How do I implement a RAG pipeline with embeddings and vector search?}`,
  },
  {
    name: "Personal Note",
    content: `{\\rtf1\\ansi\\deff0 {\\fonttbl {\\f0 Times New Roman;}}\\f0\\fs24 Remember to buy groceries and call mom this weekend.}`,
  }
];

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runTest() {
  console.log('🧪 [TEST] Starting RAG Pipeline Test');
  console.log('📁 [TEST] Test sticky path:', testStickyPath);
  
  for (let i = 0; i < testScenarios.length; i++) {
    const scenario = testScenarios[i];
    console.log(`\n🔄 [TEST] Running scenario ${i + 1}: ${scenario.name}`);
    
    // Write the RTF content
    fs.writeFileSync(testTxtPath, scenario.content);
    console.log('📝 [TEST] Wrote RTF content to file');
    console.log('⏰ [TEST] Waiting 3 seconds for file watcher to detect...');
    
    // Wait for the system to process
    await sleep(3000);
    
    console.log('✅ [TEST] Scenario complete');
  }
  
  console.log('\n🎉 [TEST] All test scenarios completed!');
  console.log('👀 [TEST] Check the Electron app console for RAG pipeline logs');
  console.log('🖥️  [TEST] Check the UI for updated snippets and summaries');
}

if (require.main === module) {
  runTest().catch(console.error);
} 