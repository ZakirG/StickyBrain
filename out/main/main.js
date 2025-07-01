"use strict";
const electron = require("electron");
const path = require("path");
const dotenv = require("dotenv");
const fs = require("fs");
const chokidar = require("chokidar");
const events = require("events");
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
  return rtf.replace(/\\'([0-9a-fA-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))).replace(/\\par[d]?/g, "\n").replace(/\\[^\s]+ ?/g, "").replace(/[{}]/g, "").trim();
}
function startStickiesWatcher(opts) {
  const { stickiesDir } = opts;
  console.log("[watcher] Starting watcher for:", stickiesDir);
  const watcher = chokidar.watch(path.join(stickiesDir, "*.rtfd/TXT.rtf"), {
    ignoreInitial: true
  });
  console.log("[watcher] Chokidar watching pattern:", path.join(stickiesDir, "*.rtfd/TXT.rtf"));
  watcher.on("change", (filePath) => {
    console.log("[watcher] change event", filePath);
    if (debounceTimers[filePath]) clearTimeout(debounceTimers[filePath]);
    debounceTimers[filePath] = setTimeout(() => handleChange(filePath), 200);
  });
  return watcher;
}
function handleChange(rtfFilePath) {
  try {
    console.log("[watcher] handleChange reading file:", rtfFilePath);
    const raw = fs.readFileSync(rtfFilePath, "utf8");
    const plain = basicExtractPlainText(raw);
    console.log("[watcher] extracted plain text length:", plain.length);
    const prev = lastContent[rtfFilePath] || "";
    lastContent[rtfFilePath] = plain;
    const diff = plain.slice(prev.length);
    console.log("[watcher] diff:", JSON.stringify(diff));
    if (!diff) return;
    const lastChar = diff.slice(-1);
    console.log("[watcher] lastChar test:", lastChar, "matches:", /[.!?\n]/.test(lastChar));
    if (!/[.!?\n]/.test(lastChar)) return;
    console.log("[watcher] diff triggers emit lastChar", lastChar);
    console.log("[watcher] isBusy check:", isBusy);
    if (isBusy) return;
    isBusy = true;
    watcherEvents.emit("input-paragraph", {
      text: getLastParagraph(plain),
      filePath: rtfFilePath
    });
    console.log("[watcher] emitted input-paragraph");
  } catch (err) {
    console.error("[stickiesWatcher] Error processing change:", err);
  }
}
function getLastParagraph(text) {
  const parts = text.split(/\n{2,}/).filter((p) => p.trim().length > 0);
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
  const stickiesDir = process.env.STICKIES_DIR || path.join(process.cwd(), "test-stickies");
  console.log("[main] Starting watcher on Stickies dir:", stickiesDir);
  console.log("[main] Directory exists:", fs.existsSync(stickiesDir));
  startStickiesWatcher({ stickiesDir });
  watcherEvents.on("input-paragraph", (payload) => {
    console.log("[main] input-paragraph event", payload.filePath);
    console.log("[main] forwarding to renderer");
    console.log("[main] mainWindow exists:", !!mainWindow);
    console.log("[main] mainWindow destroyed:", mainWindow?.isDestroyed());
    mainWindow?.webContents.send("update-ui", { snippets: [], summary: "", paragraph: payload.text });
    console.log("[main] IPC message sent");
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
