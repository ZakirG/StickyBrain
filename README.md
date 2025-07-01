# StickyRAG

A macOS application that provides AI-powered context from your Stickies notes while you write. StickyRAG uses RAG (Retrieval-Augmented Generation) to surface relevant content from your existing Stickies notes in a floating window as you type.

## Quick Setup for macOS Stickies

### 1. Start ChromaDB Server

For persistent vector storage and optimal performance with large Stickies collections:

```bash
# Start ChromaDB server using Docker
docker run -d -p 8000:8000 --name chromadb chromadb/chroma

# Verify server is running
curl http://localhost:8000/api/v1/version
```

### 2. Configure Environment

Add to your `.env.local` file in the project root:

```bash
# Required: OpenAI API key for embeddings and summaries
OPENAI_API_KEY=sk-your-key-here

# Optional: ChromaDB server URL (uses in-memory storage if not set)
CHROMA_URL=http://localhost:8000
```

### 3. Index Your Stickies

Index your existing macOS Stickies for RAG retrieval:

```bash
# Index your actual macOS Stickies (recommended)
pnpm index-stickies "/Users/$(whoami)/Library/Containers/com.apple.Stickies/Data/Library/Stickies"

# Or use test stickies for development
pnpm index-stickies
```

This will process all your `.rtfd` Stickies files, extract text, generate OpenAI embeddings, and store them in ChromaDB. Large collections (1000+ stickies) may take several minutes.

### 4. Run the App

```bash
# Start development mode
pnpm dev
```

The app will watch your Stickies directory and provide AI-powered context as you type!

## Features

- **Floating Window**: Translucent window that stays on top while you work
- **Real-time Analysis**: Automatically processes your Stickies content as you type
- **Vector Search**: Uses ChromaDB for semantic similarity search
- **AI Summarization**: GPT-powered summaries connecting your current thoughts with past notes
- **Privacy-First**: All processing happens locally with ChromaDB

## Requirements

- macOS (tested on macOS 12+)
- Node.js 18+
- pnpm package manager
- OpenAI API key
- Docker (for ChromaDB server)

## Install

```bash
# Clone the repository
git clone <repository-url>
cd FlowGenius

# Install dependencies
pnpm install

# Set up environment variables
cp .env.example .env
# Edit .env and add your OpenAI API key
```

## Index Stickies

Before using the app, you need to index your existing Stickies:

```bash
# Index all Stickies notes
pnpm index-stickies

# Or index from a custom directory
pnpm index-stickies /path/to/stickies
```

This will:
- Extract text from your .rtfd Stickies files
- Split content into paragraphs
- Generate embeddings using OpenAI's text-embedding-3-small model
- Store everything in a local ChromaDB collection

## Run Dev

```bash
# Start the development server
pnpm dev

# Or use electron-forge
pnpm start
```

## Package

```bash
# Build the application
pnpm build

# Create distributable packages
pnpm make
```

This will create a .dmg file in the `out` directory.

## How It Works

1. **File Watching**: Monitors your Stickies directory for changes
2. **Text Processing**: Extracts and processes new content when you type
3. **Embedding**: Creates vector embeddings of your paragraph text
4. **Retrieval**: Searches your indexed Stickies for similar content
5. **Summarization**: GPT analyzes connections between current and past content
6. **Display**: Shows relevant snippets and insights in the floating window

## Troubleshooting

### GateKeeper Warning
If you see a security warning when running the app:
1. Right-click the app and select "Open"
2. Click "Open" in the dialog
3. The app will remember this choice for future launches

### Missing OpenAI Key
Make sure your `.env` file contains a valid OpenAI API key:
```
OPENAI_API_KEY=sk-your-key-here
```

### No Results Showing
1. Ensure you've run the indexing command for your actual Stickies:
   ```bash
   pnpm index-stickies "/Users/$(whoami)/Library/Containers/com.apple.Stickies/Data/Library/Stickies"
   ```
2. Check that ChromaDB server is running: `docker ps | grep chromadb`
3. Verify your `.env.local` contains `CHROMA_URL=http://localhost:8000`
4. Check that your Stickies directory exists and contains .rtfd files
5. Try the manual Refresh button in the app

### ChromaDB Connection Issues
If you see "ChromaDB server not available" errors:
1. Start the server: `docker run -d -p 8000:8000 --name chromadb chromadb/chroma`
2. If container exists: `docker start chromadb`
3. Check server status: `curl http://localhost:8000/api/v1/version`

### Performance with Large Collections
For 1000+ stickies:
- Indexing may take 10-30 minutes depending on content size
- Consider running ChromaDB server for better performance
- Monitor OpenAI API usage during indexing

## Development

This is a monorepo with the following structure:

- `apps/main-electron/` - Electron main process
- `apps/renderer/` - React frontend
- `packages/chroma-indexer/` - Stickies indexing CLI
- `packages/langgraph-worker/` - RAG pipeline worker

### Architecture

- **Electron**: Provides the floating window and file system access
- **React + Tailwind**: Modern UI components and styling
- **ChromaDB**: Local vector database for embeddings
- **LangGraph**: Orchestrates the RAG pipeline
- **OpenAI**: Embeddings and text generation

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests: `pnpm test`
5. Submit a pull request

## License

MIT License - see LICENSE file for details # FlowGenius
