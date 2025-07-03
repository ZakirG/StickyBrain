MacOS Stickies RAG App

Tech stack:
LangGraph + Electron + React + Tailwind + Vite + Chroma Vector DB

Problem space: I primarily use Mac Stickies to brainstorm. I've been using Mac Stickies for the last 10 years to organize my long-running ideas. My goals for the year, my tasks in my various hobbies, ideas related to various pursuits, and more. The problem is that I have so many good ideas in my Stickies from the past few years that I lose track of them and forget them.

App as solution: While I'm typing my brainstorms in a Mac Sticky, I would like an app that automatically pulls up ideas from my other Stickies using RAG and shows them to me in a floating window.

What the user will see and experience:
- The user is in a Sticky note brainstorming. They might write "App ideas for Gauntlet Assignment 3". Automatically, their other sticky note with a list of app ideas should be caught in the RAG and ideas from that sticky should be shown in a floating window, with the name of the relevant Sticky shown by each chunk. There might also be some commentary from an LLM reacting to what I'm writing and the chunks that were pulled up, summarizing the combined context of what I'm typing in the current Sticky (the most recent paragraph I've typed) and the retrieved RAG chunks.

Implementation:
- We'll use a Chroma Vector DB to store the vectors/embeddings locally and avoid storage costs in Pinecone. Use the OpenAI embedding model text-embedding-3-small with an OpenAI API Key
- Paragraph-level chunking might be ideal, so that the entire relevant paragraph from a Sticky is returned. The split would occur on double newlines probably \n\n
- We'll use Gauntlet's OpenAI API key to access the OpenAI text embeddings model, saving money, since there might be ~200 pages worth of Stickies. I have access to that through my class.
- There should be an initial onboarding flow where we make embeddings for all the Stickies in a UI and we can choose to exclude certain Stickies. That onboarding flow will show you which Stickies have already been embedded and which ones have not.
- Stickies are stored in .rtfd files in /Users/zakirgowani/Library/Containers/com.apple.Stickies/Data/Library/Stickies/
- Electron can watch the Stickies folder for newly created Stickies using chokidar
- I want the main app to be in a floating window that is movable but by default appears in the top right, and is perhaps translucent when not in focus, perhaps, if that's easy to implement.

LangGraph Implementation Discussion:
- The state machine will keep track of what sticky the user is currently in and has access to the file path of the current sticky, which another node will need to retrieve.

## 🧠 LangGraph Node Overview

### 1. `InputMonitor` (Event-Triggered Node)

**What it does**:
Detects when the user types new content in a Sticky.

**How**:

* Watches a synced `.txt` or `.md` version of your Stickies (via file watcher)
* Triggers when there’s meaningful new content (e.g., after a pause or a diff)

**Output**:
Current Sticky text + metadata (title, timestamp, etc.)

---

### 2. `EmbedderNode`

**What it does**:
Generates a vector embedding for the current Sticky text.

**How**:

* Calls OpenAI’s `text-embedding-3-small` or similar
* Embeds the most recently typed paragraph in the Sticky

**Output**:
A vector representation of the Sticky (e.g., 1536-dim array)

---

### 3. `RetrieverNode`

**What it does**:
Queries a local vector DB (Chroma or FAISS) to find relevant past Stickies.

**How**:

* Takes the new embedding and performs k-NN search
* Returns top-N matching Stickies (with similarity scores and their text)

**Output**:
List of retrieved Stickies with metadata

---

### 4. `FilterNode` (optional, but smart)

**What it does**:
Filters out irrelevant or low-quality matches before surfacing.

**How**:

* Can check similarity threshold (e.g., cosine similarity > 0.8)
* Optionally call an LLM: *"Does this match help the user?"*

**Output**:
Filtered list of meaningful prior notes

---

### 5. `ResponseNode`

**What it does**:
Uses an LLM to generate a useful reflection or suggestion.

**Prompt example**:

> The user is writing:
> "*I want to make a cinematic beat that feels like rising tension.*"
> In the past, they wrote:
> "*Loved the strings from Interstellar OST — maybe sample that build-up.*"
> 👉 Summarize the past idea, explain the connection, and suggest what the user might explore next.

**Output**:
Natural-language response (1–3 sentences)

---

### 6. `DisplayNode`

**What it does**:
Sends the final LLM response to your Electron frontend.

**How**:

* Uses IPC (inter-process communication) or writes to a file
* Electron renders it in a sidebar next to your Sticky or as a tooltip/notification

---

### 🔁 Optional: Add LangGraph Features

| Feature              | How to Implement                                                                |
| -------------------- | ------------------------------------------------------------------------------- |
| **Memory**           | Add a memory store node (to keep session context or user preferences)           |
| **Multi-step loops** | LangGraph can re-enter the graph from any node to recheck relevance             |
| **Feedback loop**    | Let user click “👍/👎” to give feedback and fine-tune prompts or add embeddings |

---

## 🧱 Example Graph Flow (Visual)

```text
          ┌─────────────┐
          │ InputMonitor│
          └─────┬───────┘
                ↓
        ┌───────▼────────┐
        │  EmbedderNode  │
        └───────┬────────┘
                ↓
        ┌───────▼────────┐
        │ RetrieverNode  │
        └───────┬────────┘
                ↓
        ┌───────▼────────┐
        │  FilterNode    │
        └───────┬────────┘
                ↓
        ┌───────▼────────┐
        │  ResponseNode  │
        └───────┬────────┘
                ↓
        ┌───────▼────────┐
        │  DisplayNode   │
        └────────────────┘
```

---

## 🧪 LangGraph Benefits for StickyBrain

* **Stateful**: remembers what it’s seen, when it last surfaced something
* **Composable**: easy to swap in a local LLM, different vector DB, or custom filters
* **Modular**: lets you iterate and tune each step independently
* **Efficient**: only fires when input changes in meaningful ways (diff-based triggers)






Below is a zero-code implementation plan that walks through **what needs to happen, where it lives in the stack, and why each choice keeps the first version fast to ship**.  I keep every step tightly scoped to your five clarifications; anything marked “(later)” is optional polish you can postpone.

---

## 1.  High-Level Data Flow

```
File-watcher → Trigger logic → LangGraph (Embed ➜ Retrieve ➜ Summarise*) → IPC → Floating Window
```

*The summarise step is flagged “optional” for v1 because you asked to show raw snippets only; leaving the node in the graph keeps the option open without extra wiring.*

---

## 2.  Project Skeleton

| Layer                 | Tech / Role                       | Key Points                                                                                                               |
| --------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Electron main**     | Node + `chokidar`                 | Watches the Stickies folder; runs light text-diff logic; holds a single in-flight-request flag.                          |
| **LangGraph worker**  | Node side-car (spawned from main) | Stateless pipeline functions; communicates results back through an in-memory message channel (e.g. Node `EventEmitter`). |
| **Electron renderer** | React + Tailwind + Vite           | Renders the floating window; exposes “Refresh” button; listens for incoming snippet batches over IPC.                    |
| **Local vector DB**   | Chroma in-process                 | Embeddings cached to disk in `~/Library/Application Support/StickyBrain/chroma`; no server to run.                         |

All of this fits in a single monorepo using `pnpm workspaces` or `bun install` for speed.

---

## 3.  Onboarding & Indexing Flow

1. **Slug a small CLI script** (`npm run index`) that:

   * Enumerates every `.rtfd` file in the Stickies container.
   * Extracts plaintext (macOS stores the body in `TXT.rtf` inside the `.rtfd` bundle—you can pipe it through `rtf-to-text` or strip tags manually).
   * Splits on **double newline** (`\n\n`) into paragraphs.
   * Sends each paragraph to OpenAI `text-embedding-3-small`, batching 100 chunks/request to minimise round-trips.
   * Inserts them into Chroma with metadata: `{filePath, stickyTitle, paragraphIndex}`.

2. **React Onboarding Screen** (renderer):

   * Lists every Sticky with a checkbox; default all on.
   * A “Build Index” button fires the CLI script behind the scenes and streams progress back via IPC.
   * Indexed Stickies are greyed-out on subsequent launches, allowing incremental catch-up.

*(Later: add a “re-index” button per Sticky to capture edits.)*

---

## 4.  Real-Time Trigger Logic

### 4.1 Detecting “current” Sticky without native helpers

*Constraint: pure JS.*

* **Assumption**: macOS Stickies rewrites the file on every keypress (it usually does).
* Strategy:

  1. Attach `chokidar.watch(stickiesDir, { ignoreInitial: true })`.
  2. On each `change` event, debounce per file for \~200 ms.
  3. Read the file, strip RTF, diff against last cached version.
  4. If the diff’s **last character** is `.`, `!`, `?`, or `\n`, and no request is currently in progress, raise a “QueryNeeded” event.

*Trade-off*: We don’t know for sure the user’s *frontmost* Sticky, but the file being modified most recently is almost always the one they’re typing in. Good enough for v1; native `AXObserver` can perfect this later.

### 4.2  Concurrency Gate

* Single boolean `isBusy`.
* If `QueryNeeded` fires while `isBusy === true`, discard the signal.
* Manual **Refresh** button in UI always bypasses the discard logic: sets `isBusy = false` first, then runs a query.

---

## 5.  LangGraph Pipeline (server-side worker)

| Node                         | Purpose                                           | Config                                                                                      |
| ---------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **InputNode**                | Receives `{paragraphText, stickyMeta}` from main. | No extra logic.                                                                             |
| **EmbedNode**                | Calls OpenAI embeddings (single paragraph).       | Model: `text-embedding-3-small`; returns vector.                                            |
| **RetrieveNode**             | `k=5` nearest neighbours from Chroma.             | Cosine similarity; fetch metadata + full paragraph.                                         |
| **FilterNode**               | Quick JS similarity threshold (`> 0.75`).         | Can be removed if results are good enough.                                                  |
| **SummariseNode (optional)** | Uses GPT-4o-mini to weave a one-liner.            | Prompt: “Given current paragraph: … and these snippets: … produce a 2-sentence reflection.” |
| **OutputNode**               | Emits `{snippets, summary?}` back to Electron.    | Emits an array sorted by similarity DESC.                                                   |

Implementation tip: LangGraph lets you annotate nodes as **concurrent** or **sequential**; your graph is purely sequential, so the default is fine.  Because the worker runs in the same process space, there’s no network overhead.

---

## 6.  IPC Contract

| Channel           | Direction       | Payload                  |
| ----------------- | --------------- | ------------------------ |
| `refresh-request` | Renderer → Main | User clicked button.     |
| `query-run`       | Main → Worker   | `{paragraphText, meta}`  |
| `query-result`    | Worker → Main   | `{snippets, summary}`    |
| `update-ui`       | Main → Renderer | Forwards `query-result`. |

Use Electron’s **context-isolated IPC** (`ipcMain`, `ipcRenderer`, and a `preload.js` exposing `window.api`) to keep the renderer sandboxed.

---

## 7.  Floating Window UX

* **Create** a frameless BrowserWindow with `alwaysOnTop: true`, `transparent: true`, default 70 % opacity.
* Tailwind class `transition-opacity duration-200` to fade to 40 % opacity on `blur`.
* Tailwind flex column list:

  * Each snippet: small badge = Sticky title, paragraph text truncated to \~160 chars, similarity in subtle grey.
  * (Later) “Open Sticky” click handler calling `open -a Stickies <filePath>` via main process.

---

## 8.  Configuration & Secrets

* Store the OpenAI key in **Electron’s secure storage** (`keytar`) on first launch.
* Collection name in Chroma = `"stickies_rag_v1"`.
* App config JSON (`~/Library/Application Support/StickyBrain/config.json`) for tweakables: `similarityThreshold`, `k`, `opacityInactive`, etc.

---

## 9.  Packaging & Distribution

* Use **electron-forge** or **electron-vite** for one-command `npm run make` producing a signed `.dmg` (Mac only).
* Code-signing: use a free Developer ID if you have one; otherwise GateKeeper will show the usual unsigned-app prompt.

---

## 10.  Rough Timeline

| Day | Milestone                                                               |
| --- | ----------------------------------------------------------------------- |
| 1   | Repo scaffold, Electron shell, floating window placeholder.             |
| 2   | Chokidar watcher + diff logic + manual Refresh wired to console output. |
| 3   | Chroma indexing CLI + onboarding screen.                                |
| 4   | LangGraph worker, embeddings, retrieval returning to UI.                |
| 5   | Concurrency gate, opacity polish, test on 200-page data set.            |
| 6   | QA pass, notarise build, ship v0.1.                                     |

*A single dev week gets you usable value; later you can swap in a native helper, add summarisation, feedback buttons, and richer attachment handling.*

