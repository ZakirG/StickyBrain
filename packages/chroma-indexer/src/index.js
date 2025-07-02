#!/usr/bin/env node
/**
 * Chroma Indexer CLI
 * Indexes Stickies into ChromaDB with paragraph-level chunking
 */
import dotenv from 'dotenv';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, basename } from 'path';
import { homedir } from 'os';
import OpenAI from 'openai';
// Load environment variables
dotenv.config();
// Try to import Chroma client – fallback to undefined if lib not available at runtime
let ChromaClientCtor;
try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ChromaClientCtor = (await import('chromadb')).ChromaClient;
}
catch {
    ChromaClientCtor = undefined;
}
/**
 * Minimal in-memory collection used during tests when the real Chroma client is not available.
 */
export class InMemoryCollection {
    ids = new Set();
    embeddings = [];
    metadatas = [];
    async upsert(params) {
        params.ids.forEach((id) => this.ids.add(id));
        params.embeddings.forEach((embedding) => this.embeddings.push(embedding));
        if (params.metadatas) {
            params.metadatas.forEach((metadata) => this.metadatas.push(metadata));
        }
    }
    async count() {
        return this.ids.size;
    }
    async query(params) {
        const queryEmb = params.queryEmbeddings[0];
        const k = Math.min(params.nResults, this.ids.size);
        // Get all stored data
        const allIds = Array.from(this.ids);
        const allEmbeddings = Array.from(this.embeddings);
        const allMetadatas = Array.from(this.metadatas);
        // Compute distances and sort
        const results = allIds
            .map((id, idx) => ({
            id,
            metadata: allMetadatas[idx],
            embedding: allEmbeddings[idx],
            distance: this.cosineDist(queryEmb, allEmbeddings[idx]),
        }))
            .sort((a, b) => a.distance - b.distance)
            .slice(0, k);
        return {
            ids: [results.map(r => r.id)],
            metadatas: [results.map(r => r.metadata)],
            embeddings: [results.map(r => r.embedding)],
            distances: [results.map(r => r.distance)],
        };
    }
    cosineDist(a, b) {
        const len = Math.min(a.length, b.length);
        let dot = 0;
        let magA = 0;
        let magB = 0;
        for (let i = 0; i < len; i++) {
            dot += a[i] * b[i];
            magA += a[i] * a[i];
            magB += b[i] * b[i];
        }
        if (magA === 0 || magB === 0)
            return 1;
        return 1 - (dot / (Math.sqrt(magA) * Math.sqrt(magB)));
    }
}
/**
 * Very small stub that imitates the public surface we require from the JS Chroma client.
 */
export class InMemoryChromaClient {
    collections = new Map();
    async getOrCreateCollection({ name }) {
        if (!this.collections.has(name)) {
            this.collections.set(name, new InMemoryCollection());
        }
        return this.collections.get(name);
    }
    async getCollection({ name }) {
        return this.collections.get(name);
    }
    async deleteCollection({ name }) {
        this.collections.delete(name);
    }
}
/**
 * Strip RTF tags from RTF content
 * @param rtfContent - Raw RTF content
 * @returns Plain text content
 */
function stripRtfTags(rtfContent) {
    // Hex-encoded chars (\'hh)
    let text = rtfContent.replace(/\\'([0-9a-fA-F]{2})/g, (_, hex) => {
        return String.fromCharCode(parseInt(hex, 16));
    });
    // Convert paragraph delimiters to real newlines
    text = text.replace(/\\par[d]?/g, '\n');
    // Remove all other control words
    text = text.replace(/\\[a-zA-Z]+-?\d* ?/g, '');
    // Remove braces
    text = text.replace(/[{}]/g, '');
    // Collapse spaces and tabs (preserve newlines for paragraph detection)
    text = text.replace(/[ \t\r]+/g, ' ').trim();
    return text;
}
/**
 * Optional: high-quality RTF → text converter (falls back to regex stripper if unavailable)
 */
let rtfToText;
try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    rtfToText = (await import('rtf-to-text')).default;
    console.log('[index] Using rtf-to-text library for clean extraction');
} catch {
    rtfToText = undefined;
}
/**
 * Extracts plain text from RTFD files by reading TXT.rtf and stripping RTF tags
 * @param rtfdPath Path to the .rtfd bundle
 * @returns Plain text content
 */
export function extractTextFromRtfd(rtfdPath) {
    const txtPath = join(rtfdPath, 'TXT.rtf');
    try {
        const rtfContent = readFileSync(txtPath, 'utf-8');
        const plainText = rtfToText ? rtfToText(rtfContent) : stripRtfTags(rtfContent);
        const title = basename(rtfdPath, '.rtfd');
        return { text: plainText, title };
    }
    catch (error) {
        console.warn(`[index] Could not read ${txtPath}:`, error);
        const title = basename(rtfdPath, '.rtfd');
        return { text: '', title };
    }
}
/**
 * Splits text into paragraphs on double newlines
 * @param text Input text
 * @returns Array of paragraph strings
 */
export function splitIntoParagraphs(text) {
    return text
        .split(/\n{2,}/)
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
}
/**
 * Generate a deterministic, low-dimension embedding for environments where no
 * OpenAI key is present or network calls are undesirable (e.g. CI).
 */
function mockEmbedding(text) {
    // Simple 5-dim hash based on character codes
    const result = new Array(5).fill(0);
    for (let i = 0; i < text.length; i++) {
        result[i % 5] += text.charCodeAt(i);
    }
    return result.map((v) => v % 1_000 / 1_000); // keep numbers small
}
async function embedBatch(texts) {
    const apiKey = process.env.OPENAI_API_KEY;
    // Use real embeddings when possible and NODE_ENV is not 'test'
    if (apiKey && process.env.NODE_ENV !== 'test') {
        const openai = new OpenAI({ apiKey });
        const response = await openai.embeddings.create({
            model: 'text-embedding-3-small',
            input: texts,
        });
        // The SDK returns { data: [{ embedding: number[] }, ...] }
        return response.data.map((d) => d.embedding);
    }
    // Fallback to local mock embeddings
    return texts.map((t) => mockEmbedding(t));
}
export async function indexStickies(opts = {}) {
    const stickiesDir = opts.stickiesDir ||
        getStickiesDir();
    if (!existsSync(stickiesDir)) {
        throw new Error(`Stickies directory not found: ${stickiesDir}`);
    }
    console.log(`[index] Scanning: ${stickiesDir}`);
    const rtfdPaths = findStickiesPaths(stickiesDir);
    console.log(`[index] Found ${rtfdPaths.length} stickies…`);
    const paragraphs = [];
    rtfdPaths.forEach((p) => {
        const plain = extractTextFromRtfd(p);
        const chunks = splitIntoParagraphs(plain.text);
        // Derive title from first non-empty line, fallback to file basename
        let stickyTitle = plain.text.split(/\n+/).map(l => l.trim()).find(l => l.length > 0) || plain.title;
        if (stickyTitle.length > 120) stickyTitle = stickyTitle.slice(0, 117) + '...';
        console.log(`[index] Processed sticky "${stickyTitle}" – ${chunks.length} paragraphs, ${plain.text.length} chars total`);
        const fullText = plain.text;
        // Add a title vector so that searches by note-name work
        const truncatedTitle = stickyTitle.length > 100 ? stickyTitle.slice(0, 100) : stickyTitle;
        paragraphs.push({
            id: `${stickyTitle}_title`,
            text: `${truncatedTitle} (title)`,
            meta: {
                filePath: p,
                stickyTitle,
                isTitle: true,
                preview: fullText.slice(0, 1000),
                text: `${truncatedTitle} (title)`,
            },
        });
        // Regular paragraph chunks
        chunks.forEach((chunk, idx) => {
            paragraphs.push({
                id: `${stickyTitle}_${idx}`,
                text: chunk,
                meta: {
                    filePath: p,
                    stickyTitle,
                    paragraphIndex: idx,
                    text: chunk,
                },
            });
        });
    });
    console.log(`[index] Total paragraphs: ${paragraphs.length}`);
    // Chunk into batches of 100
    const batches = [];
    for (let i = 0; i < paragraphs.length; i += 100) {
        batches.push(paragraphs.slice(i, i + 100));
    }
    // Decide which Chroma client to use
    let client = opts.client;
    if (!client) {
        if (ChromaClientCtor) {
            try {
                client = new ChromaClientCtor({ path: process.env.CHROMA_URL });
                // Test the connection by trying to get a collection
                await client.getOrCreateCollection({ name: 'connection_test' });
                await client.deleteCollection({ name: 'connection_test' });
                console.log('[index] Using ChromaDB server');
            }
            catch (error) {
                console.warn('[index] ChromaDB server not available, falling back to in-memory client');
                client = new InMemoryChromaClient();
            }
        }
        else {
            console.log('[index] ChromaDB library not available, using in-memory client');
            client = new InMemoryChromaClient();
        }
    }
    // In test environment, make the client discoverable for assertions
    if (process.env.NODE_ENV === 'test') {
        globalThis.__chromadbClient = client;
    }
    const collection = await client.getOrCreateCollection({ name: 'stickies_rag_v1' });
    let processed = 0;
    for (const batch of batches) {
        const embeddings = await embedBatch(batch.map((b) => b.text));
        await collection.upsert({
            ids: batch.map((b) => b.id),
            embeddings,
            metadatas: batch.map((b) => b.meta),
        });
        processed += batch.length;
        console.log(`[index] Upserted ${processed}/${paragraphs.length}`);
    }
    console.log('[index] ✅ Done');
}
function getStickiesDir(useProd = false) {
    if (useProd) {
        return join(homedir(), 'Library/Containers/com.apple.Stickies/Data/Library/Stickies');
    }
    else {
        // Find the workspace root by looking for package.json with workspaces
        let currentDir = process.cwd();
        while (currentDir !== '/') {
            try {
                const pkgPath = join(currentDir, 'package.json');
                const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
                if (pkg.workspaces) {
                    return join(currentDir, 'test-stickies');
                }
            }
            catch {
                // Continue searching
            }
            currentDir = join(currentDir, '..');
        }
        // Fallback to current directory
        return join(process.cwd(), 'test-stickies');
    }
}
function findStickiesPaths(baseDir) {
    const paths = [];
    try {
        const entries = readdirSync(baseDir);
        for (const entry of entries) {
            const fullPath = join(baseDir, entry);
            try {
                const stat = statSync(fullPath);
                if (stat.isDirectory() && (entry.endsWith('.rtfd') || entry.includes('.rtfd.sb-'))) {
                    paths.push(fullPath);
                }
            }
            catch (error) {
                console.warn(`[index] Could not stat ${fullPath}:`, error);
            }
        }
    }
    catch (error) {
        console.warn(`[index] Could not read directory ${baseDir}:`, error);
    }
    return paths;
}
async function mainCLI() {
    const dirArg = process.argv[2];
    try {
        await indexStickies({ stickiesDir: dirArg });
    }
    catch (err) {
        console.error('[index] ❌ Error:', err.message);
        process.exit(1);
    }
}
// CLI detection for ES modules
const isMainModule = process.argv[1] && process.argv[1].endsWith('index.js');
if (isMainModule) {
    mainCLI().catch(console.error);
}
