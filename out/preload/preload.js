"use strict";
const electron = require("electron");
electron.contextBridge.exposeInMainWorld("electronAPI", {
  refreshRequest: () => electron.ipcRenderer.invoke("refresh-request"),
  setInactive: () => electron.ipcRenderer.send("set-inactive"),
  onUpdate: (callback) => {
    electron.ipcRenderer.on("update-ui", (_event, data) => callback(data));
  },
  onRagStart: (callback) => {
    electron.ipcRenderer.on("rag-started", () => callback());
  },
  runEmbeddings: () => electron.ipcRenderer.invoke("run-embeddings"),
  loadUserGoals: () => electron.ipcRenderer.invoke("load-user-goals"),
  saveUserGoals: (goals) => electron.ipcRenderer.invoke("save-user-goals", goals),
  onIncrementalUpdate: (callback) => {
    electron.ipcRenderer.on("incremental-update", (_event, data) => callback(data));
  }
});
