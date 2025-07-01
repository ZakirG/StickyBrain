"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
const electron = require("electron");
const path = require("path");
const dotenv = require("dotenv");
const fs = require("fs");
const chokidar = require("chokidar");
const events = require("events");
const child_process = require("child_process");
function _interopNamespaceDefault(e) {
  const n = Object.create(null, { [Symbol.toStringTag]: { value: "Module" } });
  if (e) {
    for (const k in e) {
      if (k !== "default") {
        const d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: () => e[k]
        });
      }
    }
  }
  n.default = e;
  return Object.freeze(n);
}
const dotenv__namespace = /* @__PURE__ */ _interopNamespaceDefault(dotenv);
const watcherEvents = new events.EventEmitter();
let isBusy = false;
function setBusy(val) {
  isBusy = val;
  console.log("[watcher] setBusy", val);
}
const lastContent = {};
const debounceTimers = {};
function basicExtractPlainText(rtf) {
  let text = rtf.replace(/\\'([0-9a-fA-F]{2})/g, (_, hex) => {
    return String.fromCharCode(parseInt(hex, 16));
  });
  const contentMatch = text.match(/\\f\d+\\fs\d+\s*\\cf\d+\s*(.+?)(?:\}|$)/s);
  if (contentMatch) {
    text = contentMatch[1];
  } else {
    const parts = text.split("}");
    if (parts.length > 1) {
      text = parts[parts.length - 2] || parts[parts.length - 1];
    }
  }
  text = text.replace(/\\\\/g, "\n");
  text = text.replace(/\\par\b/g, "\n");
  text = text.replace(/\\line\b/g, "\n");
  text = text.replace(/\\[a-zA-Z]+\d*/g, "");
  text = text.replace(/\\./g, "");
  text = text.replace(/[{}]/g, "");
  text = text.replace(/\s+/g, " ");
  text = text.replace(/^\s+|\s+$/g, "");
  text = text.replace(/%\s*$/, "");
  return text;
}
function startStickiesWatcher(opts) {
  const { stickiesDir } = opts;
  console.log("[watcher] Starting watcher for:", stickiesDir);
  const globPattern = path.join(stickiesDir, "**/TXT.rtf");
  const watcher = chokidar.watch(globPattern, {
    // watch for new files, changes, deletions
    ignoreInitial: true,
    depth: 2,
    // only the package dir and its immediate children
    usePolling: true,
    interval: 500
  });
  console.log("[watcher] Chokidar watching pattern:", globPattern);
  watcher.on("all", (ev, p) => {
    console.log("[watcher] fs event", ev, p);
    if (ev === "change" || ev === "add") {
      if (debounceTimers[p]) clearTimeout(debounceTimers[p]);
      debounceTimers[p] = setTimeout(() => handleChange(p), 200);
    }
  });
  return watcher;
}
function handleChange(rtfFilePath) {
  try {
    console.log("👀 [WATCHER] File change detected:", rtfFilePath);
    console.log("⏰ [WATCHER] Change timestamp:", (/* @__PURE__ */ new Date()).toISOString());
    console.log("📝 [WATCHER] Starting file change processing");
    const raw = fs.readFileSync(rtfFilePath, "utf8");
    let plain = basicExtractPlainText(raw);
    plain = plain.replace(/\\+/g, "");
    console.log("📄 [WATCHER] Extracted plain text length:", plain.length, "characters");
    console.log("📄 [WATCHER] Content preview:", plain.substring(0, 100) + "...");
    const prev = lastContent[rtfFilePath] || "";
    lastContent[rtfFilePath] = plain;
    const diff = plain.slice(prev.length);
    console.log("🔄 [WATCHER] Content diff:", JSON.stringify(diff));
    console.log("📏 [WATCHER] Previous length:", prev.length, "| New length:", plain.length);
    if (!diff) return;
    const lastChar = plain.trim().slice(-1);
    console.log("🔚 [WATCHER] Last character (overall note):", JSON.stringify(lastChar));
    const sentenceEnded = /[.!?\n]/.test(lastChar);
    console.log("✅ [WATCHER] Sentence ending test:", sentenceEnded);
    if (!sentenceEnded) return;
    console.log("✅ [WATCHER] Complete sentence detected! Last char:", JSON.stringify(lastChar));
    console.log("🔄 [WATCHER] Checking if system is busy:", isBusy);
    if (isBusy) return;
    console.log("📤 [WATCHER] Emitting input-paragraph event");
    isBusy = true;
    const lastParagraph = getLastParagraph(plain);
    console.log("📝 [WATCHER] Last paragraph length:", lastParagraph.length);
    console.log("📝 [WATCHER] Last paragraph preview:", lastParagraph.substring(0, 100) + "...");
    watcherEvents.emit("input-paragraph", {
      text: lastParagraph,
      filePath: rtfFilePath
    });
    console.log("🎉 [WATCHER] Event emitted successfully!");
  } catch (err) {
    console.error("❌ [WATCHER] Error processing file change:", err);
  }
}
function getLastParagraph(text) {
  const sanitized = text.replace(/\\+/g, "").trim();
  const parts = sanitized.split(/\n{2,}/).filter((p) => p.trim().length > 0);
  return parts[parts.length - 1] || text;
}
dotenv__namespace.config();
try {
  if (process.platform === "win32" && require("electron-squirrel-startup")) {
    electron.app.quit();
  }
} catch {
}
let mainWindow = null;
const statePath = path.join(electron.app.getPath("userData"), "window-state.json");
let workerProcess = null;
const createFloatingWindow = () => {
  mainWindow = new electron.BrowserWindow({
    height: 500,
    width: 350,
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      nodeIntegration: false,
      contextIsolation: true
    },
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    title: "StickyRAG"
  });
  if (!electron.app.isPackaged && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
  try {
    if (fs.existsSync(statePath)) {
      const state = JSON.parse(fs.readFileSync(statePath, "utf-8"));
      mainWindow.setPosition(state.x, state.y);
    } else {
      const { width: sw } = electron.screen.getPrimaryDisplay().workAreaSize;
      mainWindow.setPosition(sw - 350 - 20, 20);
    }
  } catch {
    const { width: sw } = electron.screen.getPrimaryDisplay().workAreaSize;
    mainWindow.setPosition(sw - 350 - 20, 20);
  }
  mainWindow.on("move", () => {
    if (!mainWindow) return;
    const [x, y] = mainWindow.getPosition();
    fs.writeFileSync(statePath, JSON.stringify({ x, y }));
  });
  mainWindow.on("blur", () => {
    mainWindow?.webContents.send("update-ui", { snippets: [], summary: "", inactive: true });
  });
};
electron.app.whenReady().then(() => {
  createFloatingWindow();
  const prodFlag = process.argv.includes("--prod");
  const defaultTestDir = path.join(process.cwd(), "test-stickies");
  const macStickiesDir = path.join(process.env.HOME || "", "Library/Containers/com.apple.Stickies/Data/Library/Stickies");
  const stickiesDir = process.env.STICKIES_DIR || (prodFlag ? macStickiesDir : defaultTestDir);
  console.log("[main] Starting watcher on Stickies dir:", stickiesDir);
  console.log("[main] Directory exists:", fs.existsSync(stickiesDir));
  startStickiesWatcher({ stickiesDir });
  watcherEvents.on("input-paragraph", (payload) => {
    mainWindow?.webContents.send("rag-started");
    setBusy(true);
    if (workerProcess?.killed === false) {
      workerProcess.kill();
    }
    workerProcess = startWorker();
    workerProcess.on("message", (msg) => {
      if (msg?.type === "result") {
        console.log("🎉 [MAIN] RAG pipeline result received!");
        mainWindow?.webContents.send("update-ui", msg.result);
        setBusy(false);
      }
    });
    workerProcess.on("exit", (code) => {
      console.log(`🚪 [MAIN] Worker process exited with code: ${code}`);
      if (code !== 0) {
        console.error("❌ [MAIN] Worker crashed. See logs above for details.");
      }
      setBusy(false);
    });
    payload.text;
    workerProcess.send({ type: "run", paragraph: payload.text });
  });
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) {
      createFloatingWindow();
    }
  });
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    electron.app.quit();
  }
});
electron.ipcMain.handle("refresh-request", async () => {
  console.log("Refresh request received");
  setBusy(false);
  console.log("[main] isBusy reset to false via refresh");
  return {
    snippets: [],
    summary: ""
  };
});
electron.ipcMain.on("set-inactive", () => {
  console.log("Window set to inactive");
});
electron.ipcMain.handle("run-embeddings", async () => {
  console.log("[main] Run Embeddings triggered via UI");
  try {
    const candidates = [
      // Compiled JS (preferred in prod)
      path.resolve(__dirname, "../../packages/chroma-indexer/dist/index.js"),
      // Source JS emitted by ts-node in dev
      path.resolve(__dirname, "../../packages/chroma-indexer/src/index.js")
    ];
    let chromaIndexer = null;
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        chromaIndexer = await import(`file://${p}`);
        break;
      }
    }
    if (!chromaIndexer) {
      throw new Error("Could not locate chroma-indexer implementation");
    }
    const { indexStickies } = chromaIndexer;
    const chroma = await import("chromadb");
    const ChromaClientCtor = chroma.ChromaClient;
    const chromaClient = new ChromaClientCtor({ path: process.env.CHROMA_URL });
    const collectionName = process.env.CHROMA_COLLECTION_NAME || "stickies_rag_v1";
    try {
      await chromaClient.deleteCollection({ name: collectionName });
      console.log("[main] Existing collection deleted");
    } catch {
    }
    const prodFlag = process.argv.includes("--prod");
    const defaultTestDir = path.join(process.cwd(), "test-stickies");
    const macStickiesDir = path.join(process.env.HOME || "", "Library/Containers/com.apple.Stickies/Data/Library/Stickies");
    const stickiesDir = process.env.STICKIES_DIR || (prodFlag ? macStickiesDir : defaultTestDir);
    console.log("[main] Starting full reindex...");
    await indexStickies({ client: chromaClient, stickiesDir });
    console.log("[main] Reindex finished");
    return { success: true };
  } catch (err) {
    console.error("[main] Reindex failed:", err.message);
    return { success: false, error: err.message };
  }
});
function startWorker() {
  const distPath = path.join(__dirname, "../../packages/langgraph-worker/dist/index.js");
  const srcPath = path.join(__dirname, "../../packages/langgraph-worker/src/index.ts");
  const useTsSource = !electron.app.isPackaged || process.env.LANGGRAPH_WORKER_TS === "1";
  const workerPath = useTsSource ? srcPath : distPath;
  console.log("🔵 [MAIN] Forking worker at path:", workerPath);
  const worker = child_process.fork(workerPath, ["--child"], {
    stdio: ["pipe", "pipe", "pipe", "ipc"],
    execArgv: useTsSource ? ["-r", "ts-node/register"] : []
  });
  worker.stdout?.on("data", (data) => console.log(`[WORKER-STDOUT] ${data.toString()}`));
  worker.stderr?.on("data", (data) => console.error(`[WORKER-STDERR] ${data.toString()}`));
  return worker;
}
