"use strict";
const require$$1 = require("electron");
const require$$0 = require("path");
const dotenv = require("dotenv");
const fs = require("fs");
const chokidar = require("chokidar");
const require$$5 = require("events");
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
const watcherEvents = new require$$5.EventEmitter();
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
  const globPattern = require$$0.join(stickiesDir, "**/TXT.rtf");
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
    const lastChar = diff.trimEnd().slice(-1);
    console.log("🔚 [WATCHER] Last character:", JSON.stringify(lastChar));
    console.log("✅ [WATCHER] Sentence ending test:", /[.!?\n]/.test(lastChar));
    if (!/[.!?\n]/.test(lastChar)) return;
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
    require$$1.app.quit();
  }
} catch {
}
let mainWindow = null;
const statePath = require$$0.join(require$$1.app.getPath("userData"), "window-state.json");
let workerProcess = null;
const createFloatingWindow = () => {
  mainWindow = new require$$1.BrowserWindow({
    height: 500,
    width: 350,
    webPreferences: {
      preload: require$$0.join(__dirname, "../preload/preload.js"),
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
  if (!require$$1.app.isPackaged && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(require$$0.join(__dirname, "../renderer/index.html"));
  }
  try {
    if (fs.existsSync(statePath)) {
      const state = JSON.parse(fs.readFileSync(statePath, "utf-8"));
      mainWindow.setPosition(state.x, state.y);
    } else {
      const { width: sw } = require$$1.screen.getPrimaryDisplay().workAreaSize;
      mainWindow.setPosition(sw - 350 - 20, 20);
    }
  } catch {
    const { width: sw } = require$$1.screen.getPrimaryDisplay().workAreaSize;
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
require$$1.app.whenReady().then(() => {
  createFloatingWindow();
  const prodFlag = process.argv.includes("--prod");
  const defaultTestDir = require$$0.join(process.cwd(), "test-stickies");
  const macStickiesDir = require$$0.join(process.env.HOME || "", "Library/Containers/com.apple.Stickies/Data/Library/Stickies");
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
  require$$1.app.on("activate", () => {
    if (require$$1.BrowserWindow.getAllWindows().length === 0) {
      createFloatingWindow();
    }
  });
});
require$$1.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    require$$1.app.quit();
  }
});
require$$1.ipcMain.handle("refresh-request", async () => {
  console.log("Refresh request received");
  setBusy(false);
  console.log("[main] isBusy reset to false via refresh");
  return {
    snippets: [],
    summary: ""
  };
});
require$$1.ipcMain.on("set-inactive", () => {
  console.log("Window set to inactive");
});
function startWorker() {
  const workerPath = require$$0.join(__dirname, "../../packages/langgraph-worker/dist/index.js");
  console.log("🔵 [MAIN] Forking worker at path:", workerPath);
  const worker = child_process.fork(workerPath, ["--child"], {
    stdio: ["pipe", "pipe", "pipe", "ipc"]
  });
  worker.stdout?.on("data", (data) => console.log(`[WORKER-STDOUT] ${data.toString()}`));
  worker.stderr?.on("data", (data) => console.error(`[WORKER-STDERR] ${data.toString()}`));
  return worker;
}
