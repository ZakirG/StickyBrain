"use strict";
const electron = require("electron");
const path = require("path");
const dotenv = require("dotenv");
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
dotenv__namespace.config();
try {
  if (process.platform === "win32" && require("electron-squirrel-startup")) {
    electron.app.quit();
  }
} catch {
}
let mainWindow = null;
const createFloatingWindow = () => {
  mainWindow = new electron.BrowserWindow({
    height: 500,
    width: 350,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
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
  const { width: screenWidth, height: screenHeight } = require("electron").screen.getPrimaryDisplay().workAreaSize;
  mainWindow.setPosition(screenWidth - 350 - 20, 20);
};
electron.app.whenReady().then(() => {
  createFloatingWindow();
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
  return {
    snippets: [],
    summary: ""
  };
});
electron.ipcMain.on("set-inactive", () => {
  console.log("Window set to inactive");
});
