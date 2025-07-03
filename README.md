# StickyBrain

A macOS application that provides AI-powered context from your Stickies notes while you write. StickyBrain uses RAG (Retrieval-Augmented Generation) combined with intelligent web research to surface relevant content from your existing Stickies notes in a floating window as you type.

## LangGraph Implementation

![LangGraph Flow Diagram](langgraph-flow-diagram-v4.png)

StickyBrain's core intelligence is powered by a sophisticated LangGraph implementation that orchestrates an 11-node pipeline combining local RAG retrieval with intelligent web research. When you type in a Sticky note, the system triggers a dual-path execution model: the RAG pipeline processes your input through embedding generation, ChromaDB similarity search, and content filtering, while simultaneously generating targeted web search queries that are executed through Brave API and DuckDuckGo.

The pipeline features real-time incremental updates, sending results to the UI after each major processing stage to provide immediate feedback. Advanced filtering excludes content from your currently active sticky while intelligently including title vectors regardless of similarity thresholds. The system culminates in a "StickyBrain Synthesis" node that combines insights from both your historical notes and live web research into a single, focused insight delivered to your floating window. This architecture ensures comprehensive context awareness while maintaining responsive performance through parallel processing and robust fallback mechanisms for all external API dependencies.

## Quick Setup for macOS Stickies

### 1. Start ChromaDB Server (Optional)

For persistent vector storage and optimal performance with large Stickies collections:

```bash
# Start ChromaDB server using Docker
docker run -d -p 8000:8000 --name chromadb chromadb/chroma

# Verify server is running
curl http://localhost:8000/api/v1/version
```

### 2. Configure Environment

Create `.env.local` file in the project root:

```bash
# Required: OpenAI API key for embeddings and summaries
OPENAI_API_KEY=sk-your-key-here

# Optional: ChromaDB server URL (uses in-memory storage if not set)
CHROMA_URL=http://localhost:8000

# Optional: Brave API key for enhanced web search (fallback to DuckDuckGo)
BRAVE_API_KEY=your-brave-api-key
```

### 3. Index Your Stickies

Index your existing macOS Stickies for RAG retrieval:

```bash
# Install dependencies
pnpm install

# Index your actual macOS Stickies (recommended)
pnpm index-stickies "/Users/$(whoami)/Library/Containers/com.apple.Stickies/Data/Library/Stickies"

# Or use test stickies for development
pnpm index-stickies
```

This will process all your `.rtfd` Stickies files, extract text, generate OpenAI embeddings, and store them in ChromaDB. Large collections (1000+ stickies) may take several minutes.

### 4. Run the App

```bash
# Start development mode with full rebuild (recommended)
pnpm dev:full

# Or start regular development mode
pnpm dev
```

The app will watch your Stickies directory and provide AI-powered context as you type!

## Features

### Core Features
- **Floating Window**: Frameless black window that stays positioned where you place it
- **Two-Column Layout**: RAG results on the left, web search suggestions and results on the right
- **Real-time Analysis**: Automatically processes your Stickies content as you type with incremental updates
- **Vector Search**: Uses ChromaDB for semantic similarity search with 0.3 similarity threshold
- **Smart Filtering**: Excludes content from your currently active sticky to avoid redundancy

### AI-Powered Intelligence
- **RAG Summarization**: GPT-4.1 creates focused summaries connecting your current thoughts with past notes
- **Web Research**: Automatically generates and executes 3 targeted web search queries
- **Page Selection**: AI chooses the 2 most valuable web pages for detailed analysis
- **Content Scraping**: Extracts readable text from selected web pages
- **StickyBrain Synthesis**: Combines RAG insights with web research into a single focused insight

### User Experience
- **User Goals**: Collapsible panel to set personal goals that influence AI suggestions
- **Incremental Updates**: See results appear in real-time as each processing stage completes
- **Manual Controls**: Refresh button, Run Embeddings button, and Clear button for manual control
- **Expandable Content**: Click to expand/collapse snippet content and web page details
- **Position Memory**: Window remembers its last position on screen

### Technical Features
- **Dual-Path Processing**: RAG and web search pipelines run in parallel for faster results
- **Robust Fallbacks**: Graceful degradation when APIs are unavailable
- **Privacy-First**: All RAG processing happens locally with your ChromaDB instance

## Requirements

- macOS (tested on macOS 12+)
- Node.js 18+
- pnpm package manager
- OpenAI API key
- Docker (optional, for ChromaDB server)
- Brave API key (optional, for enhanced web search)

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd FlowGenius

# Install dependencies
pnpm install

# Set up environment variables
cp .env.example .env.local
# Edit .env.local and add your API keys
```

## Index Stickies

Before using the app, you need to index your existing Stickies:

```bash
# Index all Stickies notes from default macOS location
pnpm index-stickies "/Users/$(whoami)/Library/Containers/com.apple.Stickies/Data/Library/Stickies"

# Or index from a custom directory
pnpm index-stickies /path/to/stickies

# Or use test stickies for development
pnpm index-stickies
```

This will:
- Extract text from your .rtfd Stickies files using RTF parsing
- Split content into paragraphs and extract titles
- Generate embeddings using OpenAI's text-embedding-3-small model
- Store everything in a ChromaDB collection named 'stickies_rag_v1'

## Development

```bash
# Full development mode (recommended) - rebuilds everything
pnpm dev:full

# Regular development mode
pnpm dev

# Production development mode
pnpm dev:prod
```

The `dev:full` command performs a complete rebuild of all packages and starts the development server, ensuring all TypeScript code changes propagate properly.

## Building and Packaging

```bash
# Build the application
pnpm build

# Create distributable packages
pnpm make
```

This will create a .dmg file in the `out` directory for macOS distribution.

## How It Works

### File Watching and Triggering
1. **File Monitoring**: Monitors your Stickies directory using chokidar for changes
2. **Debounced Processing**: Waits 200ms after changes, then diffs content
3. **Smart Triggering**: Only processes when sentences end (., !, ?, or newline)
4. **Concurrency Control**: Prevents overlapping requests with busy state management

### LangGraph Pipeline
1. **Input Processing**: Loads paragraph text, user goals, and current file path
2. **Embedding Generation**: Creates vector embeddings using OpenAI
3. **Vector Retrieval**: Searches ChromaDB for top 10 similar content pieces
4. **Smart Filtering**: Excludes current sticky, applies similarity threshold (0.3)
5. **RAG Summarization**: GPT-4.1 creates focused summary of related snippets
6. **Web Query Generation**: Creates 3 targeted web search queries in parallel
7. **Web Search Execution**: Searches via Brave API with DuckDuckGo fallback
8. **Page Selection**: AI selects 2 most valuable pages for detailed analysis
9. **Content Scraping**: Extracts readable text using axios and cheerio
10. **Page Summarization**: Creates focused summaries of scraped content
11. **Final Synthesis**: Combines RAG and web insights into single recommendation

### Real-time UI Updates
- **Incremental Display**: Results appear as each pipeline stage completes
- **Two-Column Layout**: RAG results (left) and web research (right)
- **Expandable Sections**: Click to view full content, scraped pages, etc.

## Troubleshooting

### GateKeeper Warning
If you see a security warning when running the app:
1. Right-click the app and select "Open"
2. Click "Open" in the dialog
3. The app will remember this choice for future launches

### Missing OpenAI Key
Make sure your `.env.local` file contains a valid OpenAI API key:
```
OPENAI_API_KEY=sk-your-key-here
```

### No Results Showing
1. Ensure you've run the indexing command for your actual Stickies:
   ```bash
   pnpm index-stickies "/Users/$(whoami)/Library/Containers/com.apple.Stickies/Data/Library/Stickies"
   ```
2. Check that ChromaDB is available (server running or in-memory mode working)
3. Verify your Stickies directory exists and contains .rtfd files
4. Try the manual Refresh button in the app
5. Check the Run Embeddings button to reindex if needed

### ChromaDB Connection Issues
If you see ChromaDB errors:
1. Start the server: `docker run -d -p 8000:8000 --name chromadb chromadb/chroma`
2. If container exists: `docker start chromadb`
3. Check server status: `curl http://localhost:8000/api/v1/version`
4. Or remove CHROMA_URL from .env.local to use in-memory mode

### Web Search Not Working
1. Add BRAVE_API_KEY to .env.local for best results
2. DuckDuckGo fallback should work without API key
3. Check console logs for API rate limiting or errors

### Performance with Large Collections
For 1000+ stickies:
- Indexing may take 10-30 minutes depending on content size
- Consider using ChromaDB server for better performance
- Monitor OpenAI API usage during indexing

## Development Architecture

This is a monorepo with the following structure:

- `apps/main-electron/` - Electron main process with file watching and IPC
- `apps/renderer/` - React frontend with two-column layout and real-time updates
- `packages/chroma-indexer/` - Stickies indexing CLI with RTF parsing
- `packages/langgraph-worker/` - RAG pipeline worker with 11-node LangGraph implementation

### Tech Stack

- **Electron**: Provides the floating window and file system access
- **React + Tailwind**: Modern UI components with responsive two-column layout
- **ChromaDB**: Local or remote vector database for embeddings
- **LangGraph**: Orchestrates the sophisticated RAG + web research pipeline
- **OpenAI**: GPT-4.1 for embeddings, summarization, and synthesis
- **Brave API + DuckDuckGo**: Web search with intelligent fallbacks
- **Chokidar**: File system watching with debouncing
- **TypeScript**: Type safety across the entire monorepo

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests: `pnpm test`
5. Submit a pull request

## License

MIT License - see LICENSE file for details
