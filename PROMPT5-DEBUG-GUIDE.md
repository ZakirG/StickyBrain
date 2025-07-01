# Prompt 5 RAG Pipeline - Debug & Testing Guide

## 🎯 What to Test

This guide helps you verify that **Prompt 5** (LangGraph Worker Pipeline) is working correctly with comprehensive debugging logs and UI feedback.

## 🚀 How to Test

### Method 1: Automated Test Script

```bash
# 1. Start the Electron app (keep it running)
pnpm dev

# 2. In a new terminal, run the test script
node test-rag-pipeline.js
```

### Method 2: Manual Testing

1. **Start the app**: `pnpm dev`
2. **Open Stickies.app** on macOS
3. **Create/edit a note** ending with `.` `!` `?` or newline
4. **Watch the logs and UI update**

## 📊 What You Should See

### 1. Console Logs (Main Process)

When you edit a Stickies file, you should see this flow:

```
👀 [WATCHER] File change detected: /path/to/file.rtf
⏰ [WATCHER] Change timestamp: 2024-01-01T12:00:00.000Z
📝 [WATCHER] Starting file change processing
📄 [WATCHER] Extracted plain text length: 42 characters
📄 [WATCHER] Content preview: What is the meaning of life?...
🔄 [WATCHER] Content diff: "What is the meaning of life?"
📏 [WATCHER] Previous length: 0 | New length: 42
🔚 [WATCHER] Last character: "?"
✅ [WATCHER] Sentence ending test: true
✅ [WATCHER] Complete sentence detected! Last char: "?"
🔄 [WATCHER] Checking if system is busy: false
📤 [WATCHER] Emitting input-paragraph event
📝 [WATCHER] Last paragraph length: 42
📝 [WATCHER] Last paragraph preview: What is the meaning of life?...
🎉 [WATCHER] Event emitted successfully!

🔥 [MAIN] input-paragraph event received
📄 [MAIN] File: /path/to/file.rtf
📝 [MAIN] Paragraph text: What is the meaning of life?...
⏰ [MAIN] Timestamp: 2024-01-01T12:00:00.000Z
🚀 [MAIN] Starting new worker process...
🛠️  [MAIN] Worker path: /path/to/worker/index.ts
✅ [MAIN] Worker process forked with PID: 12345
📤 [MAIN] Sending paragraph to worker process
🔄 [MAIN] isBusy set to TRUE
```

### 2. Worker Process Logs

```
🔧 [WORKER] Starting in child process mode
🆔 [WORKER] Process PID: 12345
👂 [WORKER] Listening for messages from main process...

📨 [WORKER] Received message from main process: {
  "type": "run",
  "paragraph": "What is the meaning of life?"
}
🎯 [WORKER] Processing RAG pipeline request
📝 [WORKER] Input paragraph preview: What is the meaning of life?...

🚀 [WORKER] Starting RAG pipeline
📝 [WORKER] Input paragraph: What is the meaning of life?...
📏 [WORKER] Input length: 42 characters
🔧 [WORKER] Configuration:
  - OpenAI available: true
  - ChromaDB client type: InMemoryChromaClient
  - Similarity threshold: 0.75

🧠 [WORKER] Step 1: Generating embedding...
🔄 [WORKER] Using fallback embedding generation
✅ [WORKER] Embedding generated, dimensions: 1536

🔍 [WORKER] Step 2: Querying ChromaDB for similar content...
📊 [WORKER] Querying for top 5 similar results
📋 [WORKER] Retrieved 3 potential matches
📐 [WORKER] Distance range: 0.123 to 0.456

🔬 [WORKER] Step 3: Filtering by similarity threshold...
📌 [WORKER] Result 1: similarity=0.877, threshold=0.75
✅ [WORKER] Including result 1 (similarity: 0.877)
📌 [WORKER] Result 2: similarity=0.823, threshold=0.75
✅ [WORKER] Including result 2 (similarity: 0.823)
📌 [WORKER] Result 3: similarity=0.654, threshold=0.75
❌ [WORKER] Excluding result 3 (similarity: 0.654 < 0.75)
📊 [WORKER] Filtered results: 2 of 3 passed threshold

📝 [WORKER] Step 4: Generating AI summary...
🔄 [WORKER] Using fallback summary generation
✅ [WORKER] Summary generated, length: 87 characters
📄 [WORKER] Summary preview: Summary of paragraph (42 chars) with 2 related snippets found...

🎉 [WORKER] RAG pipeline completed successfully!
📊 [WORKER] Final results:
  - Snippets: 2
  - Summary length: 87

✅ [WORKER] RAG pipeline completed successfully
📤 [WORKER] Sending result back to main process
📡 [WORKER] Result sent via IPC
```

### 3. Main Process Result Handling

```
📨 [MAIN] Received message from worker: {
  "type": "result",
  "result": {
    "snippets": [...],
    "summary": "..."
  }
}
🎉 [MAIN] RAG pipeline result received!
📊 [MAIN] Snippets count: 2
📄 [MAIN] Summary length: 87
🔄 [MAIN] Setting isBusy to FALSE
📡 [MAIN] Forwarding result to renderer via IPC
✅ [MAIN] Result forwarded to UI successfully
```

### 4. UI Updates (Renderer Process)

```
🎨 [RENDERER] App component mounted
🔌 [RENDERER] Setting up IPC listeners...
👂 [RENDERER] IPC listeners ready

📨 [RENDERER] Received update from main process: {...}
📊 [RENDERER] Snippets received: 2
📄 [RENDERER] Summary length: 87
✅ [RENDERER] UI state updated successfully
```

### 5. Visual UI Changes

The floating window should show:

1. **Debug Info Bar**: 
   ```
   🕐 Updated: 12:00:00 PM | 📊 Snippets: 2 | 📄 Summary: 87 chars | 🎯 Top similarity: 0.877
   ```

2. **AI Summary Section**:
   ```
   📄 AI Summary (87 chars)
   Summary of paragraph (42 chars) with 2 related snippets found.
   ```

3. **Related Snippets**:
   ```
   🔍 Related Snippets [2]
   
   📌 Test Note 1                    #1  87.7% match
   Content of the first matching snippet...
   ID: test1_0 | Length: 45 chars
   
   📌 Test Note 2                    #2  82.3% match  
   Content of the second matching snippet...
   ID: test2_1 | Length: 38 chars
   ```

4. **Footer Debug**:
   ```
   🔧 RAG Pipeline Debug Mode | Last Update: 12:00:00 PM
   ```

## 🔄 Manual Refresh Testing

Click the "🔄 Refresh" button and you should see:

```
🔄 [RENDERER] Manual refresh button clicked
📤 [RENDERER] Sending refresh request to main process...
🔄 [MAIN] Manual refresh request received
📝 [MAIN] Re-running RAG pipeline with last paragraph
📄 [MAIN] Last paragraph preview: What is the meaning of life?...
🚀 [MAIN] Starting new worker for manual refresh
📤 [MAIN] Sending last paragraph to worker (manual refresh)
🔄 [MAIN] isBusy set to TRUE for manual refresh
```

## ❌ Error Cases to Test

1. **No OpenAI Key**: Should use fallback embeddings and summaries
2. **No ChromaDB Server**: Should use in-memory client  
3. **Invalid File**: Should log errors gracefully
4. **Concurrent Requests**: Should skip while busy

## 🎯 Success Criteria

✅ **File Watcher**: Detects changes and extracts text  
✅ **Worker Process**: Spawns and communicates via IPC  
✅ **RAG Pipeline**: Embeds → Retrieves → Filters → Summarizes  
✅ **UI Updates**: Shows results with debug info  
✅ **Manual Refresh**: Re-runs last paragraph  
✅ **Error Handling**: Graceful fallbacks  
✅ **Logging**: Comprehensive debug output  

## 🐛 Troubleshooting

- **No logs**: Check if Electron dev tools console is open
- **No UI updates**: Verify IPC communication in logs  
- **Worker errors**: Check worker process logs for details
- **File not detected**: Ensure file ends with `.` `!` `?` or `\n`

## 📋 Test Checklist

- [ ] Automated test script runs without errors
- [ ] Manual Stickies editing triggers pipeline  
- [ ] Console shows all expected log messages
- [ ] UI updates with snippets and summary
- [ ] Debug info bar shows correct data
- [ ] Manual refresh button works
- [ ] Error cases handle gracefully
- [ ] Performance is acceptable (<5 seconds)

---

**🎉 If you see all these logs and UI updates, Prompt 5 is working perfectly!** 